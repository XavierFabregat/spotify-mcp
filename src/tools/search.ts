import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { albumLine, artistLine, numbered, playlistLine, trackLine } from "../format.js";
import * as spotify from "../spotify.js";
import { run } from "./util.js";

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "search",
    {
      title: "Search Spotify",
      description:
        "Searches the Spotify catalog. Use when the user wants options to choose from; " +
        "for a direct 'play X' request, prefer the play tool. Results include URIs usable " +
        "with play, queue, playlists, and library. Max 10 results per type (API limit).",
      inputSchema: {
        query: z.string().describe("Search text"),
        types: z
          .array(z.enum(["track", "album", "artist", "playlist"]))
          .optional()
          .describe("Result types to include (default: track)"),
        limit: z.number().int().min(1).max(10).optional().describe("Results per type, 1-10 (default 5)"),
      },
      annotations: { readOnlyHint: true },
    },
    run(async (args: { query: string; types?: string[]; limit?: number }) => {
      const types = args.types?.length ? args.types : ["track"];
      const results = await spotify.search(args.query, types, args.limit ?? 5);
      const sections: string[] = [];
      const tracks = results.tracks?.items ?? [];
      if (tracks.length) sections.push("Tracks:\n" + numbered(tracks.map(trackLine)));
      const albums = results.albums?.items ?? [];
      if (albums.length) sections.push("Albums:\n" + numbered(albums.map(albumLine)));
      const artists = results.artists?.items ?? [];
      if (artists.length) sections.push("Artists:\n" + numbered(artists.map(artistLine)));
      const playlists = (results.playlists?.items ?? []).filter((p) => p != null);
      if (playlists.length) sections.push("Playlists:\n" + numbered(playlists.map(playlistLine)));
      return sections.length ? sections.join("\n\n") : `No results for "${args.query}".`;
    })
  );
}
