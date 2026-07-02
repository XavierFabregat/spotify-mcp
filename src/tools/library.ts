import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as spotify from "../spotify.js";
import { run } from "./util.js";

export function registerLibraryTools(server: McpServer): void {
  server.registerTool(
    "library",
    {
      title: "Manage library",
      description:
        "Saves, removes, or checks items in the user's Spotify library ('liked'). Works with any " +
        "content URI: tracks, albums, artists (follow), shows, episodes. To save the current " +
        "song, get its URI from now_playing first.",
      inputSchema: {
        action: z.enum(["save", "remove", "check"]),
        uris: z.array(z.string()).min(1).max(20).describe("Spotify URIs to act on"),
      },
    },
    run(async (args: { action: "save" | "remove" | "check"; uris: string[] }) => {
      switch (args.action) {
        case "save":
          await spotify.librarySave(args.uris);
          return `❤️ Saved ${args.uris.length} item(s) to the library.`;
        case "remove":
          await spotify.libraryRemove(args.uris);
          return `Removed ${args.uris.length} item(s) from the library.`;
        case "check": {
          const flags = await spotify.libraryContains(args.uris);
          return args.uris
            .map((uri, i) => `${uri}: ${flags[i] ? "in library" : "not in library"}`)
            .join("\n");
        }
      }
    })
  );
}
