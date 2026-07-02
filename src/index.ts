#!/usr/bin/env node
/**
 * Entry point.
 *   spotify-mcp init   → guided setup: client ID prompt + OAuth
 *   spotify-mcp auth   → re-run the OAuth flow only
 *   spotify-mcp        → serve MCP over stdio (what AI clients spawn)
 *
 * stdio discipline: in server mode stdout carries JSON-RPC only — all human
 * output goes to stderr.
 */
import readline from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAccessToken, getClientId, runAuthFlow, saveClientId } from "./auth.js";
import { createServer } from "./server.js";
import { getMe } from "./spotify.js";

const CLIENT_CONFIG_SNIPPET = `{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@xavifabregat/spotify-mcp"]
    }
  }
}`;

async function init(): Promise<void> {
  console.log(`
Spotify MCP setup
─────────────────
You need a (free) Spotify developer app. Your Spotify account must have Premium.

  1. Open https://developer.spotify.com/dashboard and create an app
     (if you already have one, open it — Spotify allows 1 dev-mode app).
  2. In the app settings, add this exact Redirect URI:
       http://127.0.0.1:8888/callback
  3. Enable the Web API for the app, then copy its Client ID.
`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let clientId = "";
  while (!/^[a-f0-9]{32}$/i.test(clientId)) {
    if (clientId) console.log("That doesn't look like a Client ID (32 hex characters) — try again.");
    clientId = (await rl.question("Client ID: ")).trim();
  }
  rl.close();
  saveClientId(clientId);
  process.env.SPOTIFY_CLIENT_ID = clientId; // make this run use it immediately

  // Skip the browser dance if stored tokens already work for this app.
  const connected = await getAccessToken()
    .then(() => true)
    .catch(() => false);
  if (!connected) await runAuthFlow();
  const me = await getMe().catch(() => null);
  console.log(`
✅ Connected to Spotify${me?.display_name ? ` as ${me.display_name}` : ""}.

Add the server to your MCP client:

Claude Code:
  claude mcp add -s user spotify -- npx -y @xavifabregat/spotify-mcp

Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json)
or Cursor (~/.cursor/mcp.json):

${CLIENT_CONFIG_SNIPPET}

Then restart the client and say "play some Bill Evans".
`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "init") {
    await init();
    return;
  }
  if (cmd === "auth") {
    getClientId(); // fail fast with setup instructions if unconfigured
    await runAuthFlow();
    const me = await getMe().catch(() => null);
    console.error(`✅ Connected to Spotify${me?.display_name ? ` as ${me.display_name}` : ""}.`);
    return;
  }
  if (cmd || process.stdin.isTTY) {
    // A human ran this directly (or typo'd a command) — don't sit silent
    // waiting for JSON-RPC that will never come.
    console.error(
      (cmd ? `Unknown command: ${cmd}\n\n` : "") +
        "spotify-mcp — MCP server for Spotify (speaks stdio; AI clients spawn it for you)\n\n" +
        "  npx -y @xavifabregat/spotify-mcp init   guided setup (Spotify app + login)\n" +
        "  npx -y @xavifabregat/spotify-mcp auth   re-run the Spotify login only\n"
    );
    process.exit(cmd ? 1 : 0);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("spotify-mcp ready (stdio)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
