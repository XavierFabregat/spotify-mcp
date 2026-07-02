/**
 * OAuth 2.0 Authorization Code + PKCE against accounts.spotify.com.
 *
 * No client secret involved: the user only supplies SPOTIFY_CLIENT_ID.
 * Spotify prohibits `localhost` in redirect URIs — the loopback literal
 * 127.0.0.1 is required, and must match what is registered in the dashboard.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import open from "open";
import { NotAuthenticatedError, NotConfiguredError } from "./errors.js";

const ACCOUNTS_BASE = "https://accounts.spotify.com";
const TOKEN_DIR = join(homedir(), ".spotify-mcp");
const TOKEN_FILE = join(TOKEN_DIR, "tokens.json");
const CONFIG_FILE = join(TOKEN_DIR, "config.json");
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-library-modify",
].join(" ");

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms after which access_token is stale. */
  expires_at: number;
}

let cached: StoredTokens | null = null;

export function getClientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (id) return id;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as { client_id?: string };
    if (cfg.client_id) return cfg.client_id;
  } catch {
    /* no config file — fall through to the setup error */
  }
  throw new NotConfiguredError();
}

export function saveClientId(clientId: string): void {
  mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify({ client_id: clientId }, null, 2) + "\n", {
    mode: 0o600,
  });
}

function redirectPort(): number {
  return Number(process.env.SPOTIFY_REDIRECT_PORT ?? 8888);
}

function loadTokens(): StoredTokens | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as StoredTokens;
    return cached;
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokens): void {
  mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  cached = tokens;
}

export function clearTokens(): void {
  cached = null;
  rmSync(TOKEN_FILE, { force: true });
}

async function tokenRequest(params: Record<string, string>): Promise<StoredTokens> {
  const res = await fetch(`${ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (body.error_description as string) ?? (body.error as string) ?? res.statusText;
    throw new Error(`Token request failed: ${detail}`);
  }
  const prev = loadTokens();
  return {
    access_token: body.access_token as string,
    // Spotify may omit refresh_token on refresh responses; keep the old one.
    refresh_token: (body.refresh_token as string) ?? prev?.refresh_token ?? "",
    expires_at: Date.now() + (body.expires_in as number) * 1000,
  };
}

/**
 * Runs the interactive PKCE flow: ephemeral loopback HTTP server, browser
 * consent, code exchange. Resolves once tokens are persisted.
 */
export async function runAuthFlow(): Promise<void> {
  const clientId = getClientId();
  const port = redirectPort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL(`${ACCOUNTS_BASE}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES,
  }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (ok: boolean, message: string) => {
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html" });
        res.end(
          `<html><body style="font-family:system-ui;margin:4rem auto;max-width:30rem;text-align:center">` +
            `<h2>${ok ? "✅ Spotify connected" : "❌ Authorization failed"}</h2>` +
            `<p>${message}</p></body></html>`
        );
        server.close();
        clearTimeout(timer);
      };
      const err = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const authCode = url.searchParams.get("code");
      if (err) {
        finish(false, err);
        reject(new Error(`Authorization denied: ${err}`));
      } else if (returnedState !== state || !authCode) {
        finish(false, "State mismatch — try again.");
        reject(new Error("OAuth state mismatch"));
      } else {
        finish(true, "You can close this tab and return to your conversation.");
        resolve(authCode);
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization (5 minutes)."));
    }, AUTH_TIMEOUT_MS);
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not listen on 127.0.0.1:${port} (${(e as NodeJS.ErrnoException).code}). ` +
            `Set SPOTIFY_REDIRECT_PORT to a free port and register the matching redirect URI.`
        )
      );
    });
    server.listen(port, "127.0.0.1", () => {
      console.error(`Opening browser for Spotify authorization…`);
      console.error(`If it doesn't open, visit:\n${authorizeUrl.toString()}`);
      open(authorizeUrl.toString()).catch(() => {
        /* URL already printed to stderr as fallback */
      });
    });
  });

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  saveTokens(tokens);
  console.error("Spotify tokens saved to " + TOKEN_FILE);
}

/** Returns a valid access token, silently refreshing when stale. */
export async function getAccessToken(force = false): Promise<string> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new NotAuthenticatedError();
  if (!force && Date.now() < tokens.expires_at - 60_000) return tokens.access_token;

  try {
    const refreshed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: getClientId(),
    });
    saveTokens(refreshed);
    return refreshed.access_token;
  } catch (e) {
    // Refresh token revoked or client ID changed — a full re-auth is needed.
    throw new NotAuthenticatedError(`Token refresh failed (${(e as Error).message}).`);
  }
}
