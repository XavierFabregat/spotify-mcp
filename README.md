# spotify-mcp

[![npm](https://img.shields.io/npm/v/%40xavifabregat%2Fspotify-mcp)](https://www.npmjs.com/package/@xavifabregat/spotify-mcp)
[![CI](https://github.com/XavierFabregat/spotify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/XavierFabregat/spotify-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)

Control Spotify by talking to your AI. An MCP server for Claude Desktop, Claude Code,
Cursor, and any other MCP client.

> **You:** play something like early Bill Evans
> **AI:** ▶ Now playing: *"Peace Piece" — Bill Evans · Everybody Digs Bill Evans*
>
> **You:** perfect, queue the whole album and save this one
> **AI:** ➕ Queued *Everybody Digs Bill Evans* · ❤️ Saved "Peace Piece" to your library

Built against the **current (post-February-2026) Spotify Web API** — many older
Spotify MCP servers predate those changes and are partially broken.

## Requirements

- **Spotify Premium** — Spotify requires it for playback control and (since Feb 2026)
  for creating the developer app you'll use.
- **Node.js ≥ 20**

## Quick start

```sh
npx -y @xavifabregat/spotify-mcp init
```

The wizard walks you through creating your own (free) Spotify developer app, asks for
its Client ID, and opens a browser to connect your account — about 2 minutes total.

Why your own app? Spotify caps third-party apps at a handful of users, so every user
brings their own; the wizard makes that painless. No client secret is involved (PKCE).
Tokens stay in `~/.spotify-mcp/` on your machine and refresh silently.

The one detail that must be exact — your app's Redirect URI:

```
http://127.0.0.1:8888/callback
```

### Add to your MCP client

**Claude Code**

```sh
claude mcp add -s user spotify -- npx -y @xavifabregat/spotify-mcp
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`)
or **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@xavifabregat/spotify-mcp"]
    }
  }
}
```

Restart the client and start talking.

## Tools

| Tool | What it does |
|---|---|
| `play` | Play by free-text query (search → best match → play) or Spotify URI |
| `playback` | pause / resume / next / previous / seek / volume / shuffle / repeat |
| `now_playing` | Current track, progress, device, mode |
| `queue` | Add a track to the queue; show up next |
| `devices` | List devices; transfer playback |
| `search` | Browse tracks/albums/artists/playlists (max 10 per type — API cap) |
| `get_playlists` | List your playlists |
| `get_playlist_items` | Show a playlist's tracks (own/collaborative only — API restriction) |
| `modify_playlist` | Create a playlist; add tracks |
| `library` | Save / remove / check items in your library |
| `authenticate` | Run the Spotify login from inside a conversation |

## Design

- **Tools are intents, not endpoints.** "Play some Radiohead" is one tool call —
  the server searches, picks the best match, starts playback, and reports what it
  chose so you can correct it. No search → choose → play round trips.
- **Small surface.** 11 tools instead of one per API endpoint keeps tool selection
  accurate across different AI clients and context lean.
- **Responses are compact text with Spotify URIs**, so follow-ups ("queue that")
  chain without re-searching. Raw API payloads never reach the model.
- **Errors are instructions.** No active device? The response lists your devices and
  says how to pick one. Not logged in? It points at the `authenticate` tool. The
  model relays the fix instead of a stack trace.

## Troubleshooting

- **"No active Spotify device"** — Spotify's API can only steer a running app. Open
  Spotify anywhere; if it just woke up, tap play/pause once. With exactly one device
  online, the tools target it automatically.
- **`INVALID_CLIENT: Invalid redirect URI` during login** — the Redirect URI in your
  app settings isn't exactly `http://127.0.0.1:8888/callback` (`localhost` is
  rejected by Spotify).
- **Port 8888 in use during login** — set `SPOTIFY_REDIRECT_PORT` to a free port and
  register the matching redirect URI.
- **"Token refresh failed"** — run `npx -y @xavifabregat/spotify-mcp auth` to log in
  again (e.g. after changing the Client ID).
- **Config precedence** — the `SPOTIFY_CLIENT_ID` env var overrides
  `~/.spotify-mcp/config.json` (written by `init`).

## Development

```sh
git clone https://github.com/XavierFabregat/spotify-mcp.git
cd spotify-mcp
npm install
npm run build
npm run inspect   # MCP Inspector against the local build
```

Layout: `src/auth.ts` (OAuth PKCE + token store) · `src/spotify.ts` (typed API
client) · `src/tools/` (tool implementations) · `src/format.ts` (compact output).

## License

MIT © Xavi Fabregat
