import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, isAuthorized, loadOrCreateSecret, parseServeArgs } from "../src/http.js";

const SECRET = "test-secret-0123456789abcdefghijklmnopqrstuv";

describe("isAuthorized()", () => {
  it("accepts the secret as the path segment", () => {
    expect(isAuthorized(`/mcp/${SECRET}`, undefined, SECRET)).toBe(true);
  });

  it("accepts the secret as a bearer token on /mcp", () => {
    expect(isAuthorized("/mcp", `Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["/mcp", undefined],
    ["/mcp", "Bearer wrong"],
    ["/mcp/", undefined],
    ["/mcp/wrong", undefined],
    [`/mcp/${SECRET}/extra`, undefined],
    [`/mcp/${SECRET.slice(0, -1)}`, undefined],
    [`/other/${SECRET}`, undefined],
    ["/", `Bearer ${SECRET}`],
  ])("rejects %s (authorization: %s)", (path, auth) => {
    expect(isAuthorized(path, auth, SECRET)).toBe(false);
  });
});

describe("parseServeArgs()", () => {
  it("defaults to loopback on 8787", () => {
    expect(parseServeArgs([], {})).toEqual({ port: 8787, host: "127.0.0.1" });
  });

  it("reads flags in both forms, taking precedence over env", () => {
    expect(parseServeArgs(["--port", "9000", "--host=0.0.0.0"], { PORT: "1234" })).toEqual({
      port: 9000,
      host: "0.0.0.0",
    });
  });

  it("falls back to PORT, as injected by container hosts", () => {
    expect(parseServeArgs([], { PORT: "1234" }).port).toBe(1234);
  });

  it("rejects a bad port", () => {
    expect(() => parseServeArgs(["--port", "nope"], {})).toThrow(/--port/);
  });
});

describe("loadOrCreateSecret()", () => {
  it("refuses a short secret from the environment", () => {
    process.env.SPOTIFY_MCP_HTTP_SECRET = "too-short";
    try {
      expect(() => loadOrCreateSecret()).toThrow(/at least 32/);
    } finally {
      delete process.env.SPOTIFY_MCP_HTTP_SECRET;
    }
  });
});

describe("HTTP server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createHttpServer(SECRET);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  };
  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(initialize),
    });

  it("serves the full tool list to an MCP client using the secret URL", async () => {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${SECRET}`)));
    try {
      expect(client.getServerVersion()?.name).toBe("spotify");
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(11);
    } finally {
      await client.close();
    }
  });

  it("accepts the secret as a bearer header", async () => {
    const res = await post("/mcp", { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect((await res.json()).result.serverInfo.name).toBe("spotify");
  });

  it("answers 404 without the secret, revealing nothing", async () => {
    for (const path of ["/mcp", "/mcp/wrong-secret", "/"]) {
      const res = await post(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toMatch(/secret|token|auth/i);
    }
  });

  it("only allows POST on the endpoint", async () => {
    const res = await fetch(`${base}/mcp/${SECRET}`);
    expect(res.status).toBe(405);
  });

  it("exposes an unauthenticated health check", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
  });
});
