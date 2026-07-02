import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { numbered, playlistLine, trackLine } from "../format.js";
import * as spotify from "../spotify.js";
import { normalizePlaylistId, run } from "./util.js";

export function registerPlaylistTools(server: McpServer): void {
  server.registerTool(
    "get_playlists",
    {
      title: "List my playlists",
      description: "Lists the user's playlists with item counts and URIs.",
      annotations: { readOnlyHint: true },
    },
    run(async () => {
      const { items, total } = await spotify.getMyPlaylists();
      if (!items.length) return "No playlists found.";
      const lines = numbered(items.map(playlistLine));
      return total > items.length
        ? `${lines}\n…showing ${items.length} of ${total}.`
        : lines;
    })
  );

  server.registerTool(
    "get_playlist_items",
    {
      title: "Show playlist contents",
      description:
        "Lists the tracks in one of the user's own or collaborative playlists " +
        "(Spotify no longer exposes other users' playlist contents). Accepts a playlist " +
        "id, URI, or URL.",
      inputSchema: {
        playlist: z.string().describe("Playlist id, spotify:playlist:… URI, or open.spotify.com URL"),
        offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
      },
      annotations: { readOnlyHint: true },
    },
    run(async (args: { playlist: string; offset?: number }) => {
      const id = normalizePlaylistId(args.playlist);
      const offset = args.offset ?? 0;
      const { items, total } = await spotify.getPlaylistItems(id, 50, offset);
      const tracks = items.map((e) => e.item ?? e.track).filter((t) => t != null);
      if (!tracks.length) return "Playlist is empty (or its contents are not visible to this account).";
      const shownTo = offset + tracks.length;
      const header = total > tracks.length ? `Items ${offset + 1}-${shownTo} of ${total}:\n` : "";
      return header + numbered(tracks.map(trackLine));
    })
  );

  server.registerTool(
    "modify_playlist",
    {
      title: "Create playlist / add tracks",
      description:
        "action=create makes a new playlist (private by default); action=add_items appends " +
        "track URIs to an existing playlist. Does not delete or remove anything.",
      inputSchema: {
        action: z.enum(["create", "add_items"]),
        name: z.string().optional().describe("New playlist name (action=create)"),
        description: z.string().optional().describe("New playlist description (action=create)"),
        public: z.boolean().optional().describe("Make the new playlist public (default false)"),
        playlist: z.string().optional().describe("Target playlist id/URI/URL (action=add_items)"),
        uris: z.array(z.string()).optional().describe("Track URIs to add (action=add_items)"),
      },
    },
    run(
      async (args: {
        action: "create" | "add_items";
        name?: string;
        description?: string;
        public?: boolean;
        playlist?: string;
        uris?: string[];
      }) => {
        if (args.action === "create") {
          if (!args.name) return "Provide a name for the new playlist.";
          const p = await spotify.createPlaylist(args.name, args.description, args.public ?? false);
          const link = p.external_urls?.spotify ? ` — ${p.external_urls.spotify}` : "";
          return `✅ Created playlist "${p.name}" [${p.uri}]${link}. Use action=add_items to fill it.`;
        }
        if (!args.playlist || !args.uris?.length) {
          return "action=add_items needs a playlist (id/URI/URL) and a non-empty uris array.";
        }
        await spotify.addPlaylistItems(normalizePlaylistId(args.playlist), args.uris);
        return `✅ Added ${args.uris.length} item(s) to the playlist.`;
      }
    )
  );
}
