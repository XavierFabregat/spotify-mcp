/**
 * HTTP mode — `spotify-mcp serve`. Serves the same tools over MCP Streamable
 * HTTP so clients that only accept a URL can reach the server, typically via
 * an https tunnel or reverse proxy in front of this plain-http listener.
 *
 * This is a single-user deployment: every caller acts as the one Spotify
 * account stored on this machine. The endpoint is therefore gated by a long
 * random secret, accepted either as the last path segment (`/mcp/<secret>`,
 * for clients that only take a URL) or as `Authorization: Bearer <secret>` on
 * `/mcp`. Anything else gets a bare 404 so the endpoint is not discoverable.
 *
 * Requests are handled statelessly — a fresh server + transport per request —
 * so there is no session table to leak or expire.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const MIN_SECRET_LENGTH = 32;
const MAX_BODY_BYTES = 1_000_000;

function secretFile(): string {
  return join(homedir(), ".spotify-mcp", "http-secret");
}

/**
 * The endpoint secret: SPOTIFY_MCP_HTTP_SECRET if set, otherwise one generated
 * on first run and kept in ~/.spotify-mcp/http-secret so the URL stays stable
 * across restarts.
 */
export function loadOrCreateSecret(): string {
  const fromEnv = process.env.SPOTIFY_MCP_HTTP_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH || !/^[A-Za-z0-9_-]+$/.test(fromEnv)) {
      throw new Error(
        `SPOTIFY_MCP_HTTP_SECRET must be at least ${MIN_SECRET_LENGTH} characters of A-Z a-z 0-9 _ - ` +
          "(it is the only thing protecting the endpoint)."
      );
    }
    return fromEnv;
  }
  try {
    const stored = readFileSync(secretFile(), "utf8").trim();
    if (stored.length >= MIN_SECRET_LENGTH) return stored;
  } catch {
    /* first run — generate below */
  }
  const secret = randomBytes(32).toString("base64url");
  mkdirSync(join(homedir(), ".spotify-mcp"), { recursive: true, mode: 0o700 });
  writeFileSync(secretFile(), secret + "\n", { mode: 0o600 });
  return secret;
}

function sameSecret(candidate: string, secret: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/** True when the request carries the secret in its path or bearer header. */
export function isAuthorized(path: string, authorization: string | undefined, secret: string): boolean {
  if (path.startsWith("/mcp/")) return sameSecret(path.slice("/mcp/".length), secret);
  if (path === "/mcp") {
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return bearer !== undefined && sameSecret(bearer, secret);
  }
  return false;
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, secret: string): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/healthz") return send(res, 200, "ok\n");
  if (!isAuthorized(path, req.headers.authorization, secret)) return send(res, 404, "Not found\n");
  if (req.method !== "POST") return send(res, 405, "Method not allowed\n", { allow: "POST" });
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return send(res, 413, "Payload too large\n");

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON replies survive proxies and tunnels better than SSE
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function createHttpServer(secret: string): Server {
  return createNodeServer((req, res) => {
    handle(req, res, secret).catch((e) => {
      console.error("request failed:", e instanceof Error ? e.message : String(e));
      if (!res.headersSent) send(res, 500, "Internal error\n");
      else res.end();
    });
  });
}

export interface ServeOptions {
  port: number;
  host: string;
}

/** Parses `serve` flags, falling back to env (PORT is what most hosts inject). */
export function parseServeArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ServeOptions {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i !== -1) return argv[i + 1];
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const port = Number(flag("port") ?? env.SPOTIFY_MCP_PORT ?? env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  return { port, host: flag("host") ?? env.SPOTIFY_MCP_HOST ?? "127.0.0.1" };
}

export async function serveHttp(opts: ServeOptions): Promise<void> {
  const secret = loadOrCreateSecret();
  const server = createHttpServer(secret);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, resolve);
  });
  console.error(
    `spotify-mcp ready (http) on ${opts.host}:${opts.port}\n\n` +
      `  MCP endpoint (local):  http://${opts.host}:${opts.port}/mcp/${secret}\n` +
      `  Behind your tunnel:    https://<your-host>/mcp/${secret}\n\n` +
      "Anyone with that URL can control this Spotify account — treat it like a password.\n" +
      "This listener speaks plain http; put an https tunnel or reverse proxy in front of it."
  );
}
