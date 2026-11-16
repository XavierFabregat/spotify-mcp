import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICON_DATA_URI, ICON_SIZE } from "./icon.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerPlaybackTools } from "./tools/playback.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerSearchTools } from "./tools/search.js";

// package.json sits one level above both src/ and dist/, so the reported
// version can never drift from the published one.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string; homepage?: string };

const INSTRUCTIONS = [
  "Controls the user's Spotify: playback, queue, devices, playlists, and library.",
  "For a direct request to hear something, call `play` with a query — it searches and starts " +
    "the best match itself. Use `search` only when the user wants options to choose from.",
  "Every result line ends with a Spotify URI in [brackets]. Reuse those URIs in follow-up " +
    "calls (play, queue, library, modify_playlist) instead of searching again.",
  "Playback needs an open Spotify app. With one device online it is targeted automatically; " +
    "with several, the error lists them — ask the user which one, then pass device_id or use " +
    "`devices` with action=transfer.",
  "If a tool reports the account is not connected, run `authenticate`.",
].join("\n");

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "spotify",
      title: "Spotify",
      version: pkg.version,
      websiteUrl: pkg.homepage,
      // Embedded as a data URI so stdio clients can render it offline.
      icons: [{ src: ICON_DATA_URI, mimeType: "image/png", sizes: [ICON_SIZE] }],
    },
    { instructions: INSTRUCTIONS }
  );
  registerPlaybackTools(server);
  registerSearchTools(server);
  registerPlaylistTools(server);
  registerLibraryTools(server);
  return server;
}
