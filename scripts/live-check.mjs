#!/usr/bin/env node
/**
 * Read-only checks against the real Spotify account configured on this
 * machine. Catches API drift that mocked tests can't. Local use only — not
 * run in CI (needs ~/.spotify-mcp tokens).
 *
 *   npm run test:live
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  env: process.env,
});
const client = new Client({ name: "live-check", version: "0.0.0" });
await client.connect(transport);

const checks = [
  ["now_playing", {}],
  ["devices", { action: "list" }],
  ["search", { query: "Bill Evans", types: ["track"], limit: 3 }],
  ["get_playlists", {}],
  ["queue", { action: "list" }],
];

let failures = 0;
for (const [name, args] of checks) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) {
    failures++;
    console.log(`✗ ${name}: ${text}`);
  } else {
    console.log(`✓ ${name}: ${text.split("\n")[0]}`);
  }
}

await client.close();
if (failures) {
  console.error(`\n${failures} live check(s) failed`);
  process.exit(1);
}
console.log("\nAll live checks passed.");
