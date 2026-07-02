import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// auth.ts derives its storage paths from homedir() at import time — point it
// at a throwaway directory and reload the module per test (it caches tokens).
const { TEST_HOME } = vi.hoisted(() => ({
  TEST_HOME: `${process.env.TMPDIR ?? "/tmp"}/spotify-mcp-auth-test-${process.pid}`,
}));

vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:os")>();
  return { ...orig, homedir: () => TEST_HOME };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const DIR = join(TEST_HOME, ".spotify-mcp");
const TOKENS = join(DIR, "tokens.json");
const CONFIG = join(DIR, "config.json");

async function freshAuth() {
  vi.resetModules();
  return import("../src/auth.js");
}

function writeTokens(tokens: object) {
  writeFileSync(TOKENS, JSON.stringify(tokens));
}

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  fetchMock.mockReset();
  delete process.env.SPOTIFY_CLIENT_ID;
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("getClientId()", () => {
  it("prefers the environment variable", async () => {
    const auth = await freshAuth();
    process.env.SPOTIFY_CLIENT_ID = "env-id";
    writeFileSync(CONFIG, JSON.stringify({ client_id: "file-id" }));
    expect(auth.getClientId()).toBe("env-id");
  });

  it("falls back to config.json", async () => {
    const auth = await freshAuth();
    writeFileSync(CONFIG, JSON.stringify({ client_id: "file-id" }));
    expect(auth.getClientId()).toBe("file-id");
  });

  it("throws setup instructions when unconfigured", async () => {
    const auth = await freshAuth();
    expect(() => auth.getClientId()).toThrow(/init/);
  });

  it("round-trips through saveClientId", async () => {
    const auth = await freshAuth();
    auth.saveClientId("abc123");
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toEqual({ client_id: "abc123" });
    expect(auth.getClientId()).toBe("abc123");
  });
});

describe("getAccessToken()", () => {
  it("returns the stored token while fresh, without network calls", async () => {
    const auth = await freshAuth();
    writeTokens({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000 });
    await expect(auth.getAccessToken()).resolves.toBe("at");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes inside the 60s expiry window and keeps the old refresh token when omitted", async () => {
    const auth = await freshAuth();
    process.env.SPOTIFY_CLIENT_ID = "cid";
    writeTokens({ access_token: "stale", refresh_token: "rt-old", expires_at: Date.now() + 30_000 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 })
    );
    await expect(auth.getAccessToken()).resolves.toBe("fresh");
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt-old");
    const saved = JSON.parse(readFileSync(TOKENS, "utf8"));
    expect(saved.refresh_token).toBe("rt-old");
    expect(saved.access_token).toBe("fresh");
  });

  it("surfaces a re-auth error when the refresh is rejected", async () => {
    const auth = await freshAuth();
    process.env.SPOTIFY_CLIENT_ID = "cid";
    writeTokens({ access_token: "stale", refresh_token: "revoked", expires_at: 0 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token revoked" }), {
        status: 400,
      })
    );
    const err = await auth.getAccessToken().catch((e) => e);
    expect(err.name).toBe("NotAuthenticatedError");
    expect(err.message).toContain("Refresh token revoked");
  });

  it("demands authentication when configured but not logged in", async () => {
    const auth = await freshAuth();
    process.env.SPOTIFY_CLIENT_ID = "cid";
    const err = await auth.getAccessToken().catch((e) => e);
    expect(err.name).toBe("NotAuthenticatedError");
    expect(err.message).toContain("authenticate");
  });

  it("points fully-unconfigured users at init, not at authenticate", async () => {
    const auth = await freshAuth();
    const err = await auth.getAccessToken().catch((e) => e);
    expect(err.name).toBe("NotConfiguredError");
    expect(err.message).toContain("init");
  });

  it("force-refreshes even when the token looks fresh", async () => {
    const auth = await freshAuth();
    process.env.SPOTIFY_CLIENT_ID = "cid";
    writeTokens({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "forced", expires_in: 3600 }), { status: 200 })
    );
    await expect(auth.getAccessToken(true)).resolves.toBe("forced");
  });
});
