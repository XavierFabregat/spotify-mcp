/**
 * Drives the BUILT server (dist/) over real stdio JSON-RPC with the SDK
 * client — `npm test` builds first. HOME points at an empty directory so the
 * server sees no config/tokens regardless of the machine it runs on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DIST = join(process.cwd(), "dist", "index.js");

const EXPECTED_TOOLS = [
  "authenticate",
  "play",
  "playback",
  "now_playing",
  "queue",
  "devices",
  "search",
  "get_playlists",
  "get_playlist_items",
  "modify_playlist",
  "library",
];

describe("stdio server (built dist)", () => {
  it("registers all tools and degrades gracefully when unconfigured", async () => {
    expect(existsSync(DIST), "dist/index.js missing — npm test runs the build first").toBe(true);

    const emptyHome = mkdtempSync(join(tmpdir(), "spotify-mcp-home-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: { PATH: process.env.PATH ?? "", HOME: emptyHome },
    });
    const client = new Client({ name: "integration-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());

      const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
      expect(readOnly.sort()).toEqual(["get_playlist_items", "get_playlists", "now_playing", "search"]);

      // Unconfigured call → actionable setup message, not a stack trace.
      const res = (await client.callTool({ name: "now_playing", arguments: {} })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/init|SPOTIFY_CLIENT_ID/);

      // Missing-argument call → guidance, no error flag needed.
      const res2 = (await client.callTool({ name: "play", arguments: {} })) as {
        content: { type: string; text: string }[];
      };
      expect(res2.content[0].text).toMatch(/query|URI/);
    } finally {
      await client.close();
    }
  });
});
