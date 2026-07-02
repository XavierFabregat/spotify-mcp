import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerPlaybackTools } from "./tools/playback.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerSearchTools } from "./tools/search.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "spotify", version: "0.1.0" });
  registerPlaybackTools(server);
  registerSearchTools(server);
  registerPlaylistTools(server);
  registerLibraryTools(server);
  return server;
}
