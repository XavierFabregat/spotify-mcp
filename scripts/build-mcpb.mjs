/**
 * Builds the Claude Desktop extension bundle — `npm run bundle`.
 *
 * Stages a self-contained copy of the server (compiled dist/, production
 * node_modules, manifest, icon) under build/mcpb and packs it into
 * build/spotify-mcp.mcpb. Run after `npm run build` (the npm script does).
 *
 * The staged manifest takes its version from package.json so the bundle can
 * never disagree with the published package.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "build", "mcpb");
const OUT = join(ROOT, "build", "spotify-mcp.mcpb");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

if (!existsSync(join(ROOT, "dist", "index.js"))) {
  console.error("dist/index.js missing — run `npm run build` first.");
  process.exit(1);
}

rmSync(join(ROOT, "build"), { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(STAGE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

cpSync(join(ROOT, "dist"), join(STAGE, "dist"), { recursive: true });
cpSync(join(ROOT, "assets", "icon.png"), join(STAGE, "icon.png"));
for (const f of ["package.json", "package-lock.json", "LICENSE", "README.md"]) {
  cpSync(join(ROOT, f), join(STAGE, f));
}

// Runtime dependencies only, exactly as locked.
run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], STAGE);

const mcpb = join(ROOT, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
run(process.execPath, [mcpb, "validate", join(STAGE, "manifest.json")], ROOT);
run(process.execPath, [mcpb, "pack", STAGE, OUT], ROOT);
console.log(`\nBundle: ${OUT}`);
