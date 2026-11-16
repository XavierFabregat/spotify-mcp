/**
 * Drives the BUILT server (dist/) over real stdio JSON-RPC with the SDK
 * client — `npm test` builds first. HOME points at an empty directory so the
 * server sees no config/tokens regardless of the machine it runs on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DIST = join(process.cwd(), "dist", "index.js");
const PKG_VERSION = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;

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
      // Server identity: version tracks package.json, and an icon is advertised.
      const info = client.getServerVersion();
      expect(info?.version).toBe(PKG_VERSION);
      expect(info?.title).toBe("Spotify");
      expect(info?.icons?.[0]?.mimeType).toBe("image/png");
      expect(info?.icons?.[0]?.src).toMatch(/^data:image\/png;base64,iVBOR/);
      expect(client.getInstructions()).toMatch(/authenticate/);

      const { tools } = await client.listTools();

      // The Desktop extension manifest must describe the same server.
      const manifest = JSON.parse(readFileSync(join(process.cwd(), "manifest.json"), "utf8"));
      expect(manifest.version).toBe(PKG_VERSION);
      expect(manifest.tools.map((t: { name: string }) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
      // Every tool declares whether it can destroy data, so clients can gate approvals.
      for (const t of tools) {
        expect(t.annotations?.readOnlyHint || t.annotations?.destructiveHint !== undefined, t.name).toBe(true);
      }
      expect(tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)).toEqual(["library"]);
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

      // Missing-argument call → guidance, flagged as an error so clients don't report success.
      const res2 = (await client.callTool({ name: "play", arguments: {} })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(res2.isError).toBe(true);
      expect(res2.content[0].text).toMatch(/query|URI/);

      // Shuffle without a value must not silently switch shuffle off.
      const res3 = (await client.callTool({ name: "playback", arguments: { action: "shuffle" } })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(res3.isError).toBe(true);
      expect(res3.content[0].text).toMatch(/on or off/);
    } finally {
      await client.close();
    }
  });
});
