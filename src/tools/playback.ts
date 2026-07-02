import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAuthFlow } from "../auth.js";
import { deviceLine, nowPlayingText, numbered, trackLine } from "../format.js";
import * as spotify from "../spotify.js";
import { run, withDeviceFallback } from "./util.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type PlayableKind = "track" | "album" | "artist" | "playlist";

/** Search and pick the top match, returning a URI plus a human label. */
export async function resolvePlayable(
  query: string,
  kind: PlayableKind
): Promise<{ uri: string; label: string } | null> {
  const results = await spotify.search(query, [kind], 3);
  switch (kind) {
    case "track": {
      const t = results.tracks?.items?.[0];
      return t ? { uri: t.uri, label: trackLine(t) } : null;
    }
    case "album": {
      const a = results.albums?.items?.[0];
      return a ? { uri: a.uri, label: `album "${a.name}" — ${a.artists?.map((x) => x.name).join(", ")}` } : null;
    }
    case "artist": {
      const a = results.artists?.items?.[0];
      return a ? { uri: a.uri, label: `artist ${a.name}` } : null;
    }
    case "playlist": {
      const p = results.playlists?.items?.find(Boolean);
      return p ? { uri: p.uri, label: `playlist "${p.name}"` } : null;
    }
  }
}

export function registerPlaybackTools(server: McpServer): void {
  server.registerTool(
    "authenticate",
    {
      title: "Connect Spotify account",
      description:
        "Connects the user's Spotify account via OAuth. Opens a browser on this machine for " +
        "approval and stores tokens locally. Use when other tools report you are not " +
        "authenticated, or to switch accounts.",
    },
    run(async () => {
      await runAuthFlow();
      const me = await spotify.getMe().catch(() => null);
      return `✅ Connected to Spotify${me?.display_name ? ` as ${me.display_name}` : ""}.`;
    })
  );

  server.registerTool(
    "play",
    {
      title: "Play music",
      description:
        "Plays music by free-text query (searches and starts the best match) or by Spotify URI. " +
        'Handles "play some Radiohead", "play the album Kind of Blue", "play my Discover Weekly". ' +
        "Reports what it picked — relay that to the user so they can correct it.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('What to play, e.g. "Bill Evans" or "Kind of Blue". Required unless uri is given.'),
        type: z
          .enum(["track", "album", "artist", "playlist"])
          .optional()
          .describe("What the query refers to (default: track)"),
        uri: z
          .string()
          .optional()
          .describe("Spotify URI to play directly, e.g. from a previous search result"),
        device_id: z.string().optional().describe("Target device id (see the devices tool)"),
      },
    },
    run(async (args: { query?: string; type?: PlayableKind; uri?: string; device_id?: string }) => {
      let uri = args.uri;
      let label = uri ?? "";
      if (!uri) {
        if (!args.query) return "Provide either a query (what to play) or a Spotify URI.";
        const kind = args.type ?? "track";
        const match = await resolvePlayable(args.query, kind);
        if (!match) {
          return `No ${kind} results for "${args.query}". Try the search tool or a different wording.`;
        }
        uri = match.uri;
        label = match.label;
      }
      const kind = uri.split(":")[1] as PlayableKind;
      const body = kind === "track" ? { uris: [uri] } : { context_uri: uri };
      const { deviceNote } = await withDeviceFallback((dev) =>
        spotify.startPlayback(body, args.device_id ?? dev)
      );
      return `▶ Now playing${deviceNote}: ${label}`;
    })
  );

  server.registerTool(
    "playback",
    {
      title: "Control playback",
      description:
        "Transport controls for the active playback: pause, resume, next, previous, " +
        "seek (value = seconds), volume (value = 0-100), shuffle (value = on/off), " +
        "repeat (value = off/context/track).",
      inputSchema: {
        action: z.enum(["pause", "resume", "next", "previous", "seek", "volume", "shuffle", "repeat"]),
        value: z
          .union([z.number(), z.string()])
          .optional()
          .describe("seek: seconds · volume: 0-100 · shuffle: on/off · repeat: off/context/track"),
      },
    },
    run(async (args: { action: string; value?: number | string }) => {
      const { action, value } = args;
      const exec = async (fn: (dev?: string) => Promise<unknown>, done: string) => {
        const { deviceNote } = await withDeviceFallback(fn);
        return done + deviceNote;
      };
      switch (action) {
        case "pause":
          return exec((dev) => spotify.pause(dev), "⏸ Paused");
        case "resume":
          return exec((dev) => spotify.startPlayback(undefined, dev), "▶ Resumed");
        case "next":
        case "previous": {
          const msg = await exec(
            (dev) => (action === "next" ? spotify.skipNext(dev) : spotify.skipPrevious(dev)),
            action === "next" ? "⏭ Skipped" : "⏮ Went back"
          );
          await sleep(500); // give Spotify a beat to switch tracks
          const state = await spotify.getPlaybackState().catch(() => null);
          return state?.item ? `${msg}. Now playing: ${trackLine(state.item)}` : msg;
        }
        case "seek": {
          const seconds = Number(value);
          if (!Number.isFinite(seconds) || seconds < 0) return "seek needs value = seconds (number ≥ 0).";
          return exec((dev) => spotify.seek(Math.round(seconds * 1000), dev), `⏩ Seeked to ${seconds}s`);
        }
        case "volume": {
          const pct = Math.round(Number(value));
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "volume needs value = 0-100.";
          return exec((dev) => spotify.setVolume(pct, dev), `🔊 Volume set to ${pct}%`);
        }
        case "shuffle": {
          const on = String(value).toLowerCase() === "on" || value === "true";
          return exec((dev) => spotify.setShuffle(on, dev), `🔀 Shuffle ${on ? "on" : "off"}`);
        }
        case "repeat": {
          const mode = String(value) as "off" | "context" | "track";
          if (!["off", "context", "track"].includes(mode)) return "repeat needs value = off, context, or track.";
          return exec((dev) => spotify.setRepeat(mode, dev), `🔁 Repeat set to ${mode}`);
        }
        default:
          return `Unknown action: ${action}`;
      }
    })
  );

  server.registerTool(
    "now_playing",
    {
      title: "What's playing",
      description: "Current track, artist, album, progress, device, and shuffle/repeat state.",
      annotations: { readOnlyHint: true },
    },
    run(async () => nowPlayingText(await spotify.getPlaybackState()))
  );

  server.registerTool(
    "queue",
    {
      title: "Playback queue",
      description:
        "action=add queues a track by query or URI; action=list shows what's playing and up next.",
      inputSchema: {
        action: z.enum(["add", "list"]),
        query: z.string().optional().describe("Track to queue by name (action=add)"),
        uri: z.string().optional().describe("Track URI to queue (action=add)"),
      },
    },
    run(async (args: { action: "add" | "list"; query?: string; uri?: string }) => {
      if (args.action === "list") {
        const q = await spotify.getQueue();
        const lines: string[] = [];
        lines.push(q.currently_playing ? `Now: ${trackLine(q.currently_playing)}` : "Nothing playing.");
        if (q.queue?.length) {
          lines.push("Up next:");
          lines.push(numbered(q.queue.slice(0, 10).map(trackLine)));
          if (q.queue.length > 10) lines.push(`…and ${q.queue.length - 10} more.`);
        }
        return lines.join("\n");
      }
      let uri = args.uri;
      let label = uri ?? "";
      if (!uri) {
        if (!args.query) return "Provide a track query or uri to add to the queue.";
        const match = await resolvePlayable(args.query, "track");
        if (!match) return `No track results for "${args.query}".`;
        uri = match.uri;
        label = match.label;
      }
      const { deviceNote } = await withDeviceFallback((dev) => spotify.addToQueue(uri!, dev));
      return `➕ Queued${deviceNote}: ${label}`;
    })
  );

  server.registerTool(
    "devices",
    {
      title: "Spotify devices",
      description:
        "action=list shows available Spotify devices; action=transfer moves playback to a device " +
        "by name or id.",
      inputSchema: {
        action: z.enum(["list", "transfer"]),
        device: z.string().optional().describe("Device name (fuzzy) or id (action=transfer)"),
      },
    },
    run(async (args: { action: "list" | "transfer"; device?: string }) => {
      const devices = await spotify.getDevices();
      if (args.action === "list") {
        if (!devices.length) {
          return "No devices found. Open Spotify on a device (it may need a play/pause tap to wake up).";
        }
        return "Available devices:\n" + numbered(devices.map(deviceLine));
      }
      if (!args.device) return "Provide the device to transfer to (name or id).";
      const needle = args.device.toLowerCase();
      const matches = devices.filter(
        (d) => d.id === args.device || d.name.toLowerCase().includes(needle)
      );
      if (matches.length !== 1 || !matches[0].id) {
        return (
          (matches.length === 0 ? `No device matches "${args.device}".` : `"${args.device}" is ambiguous.`) +
          (devices.length ? "\nAvailable:\n" + numbered(devices.map(deviceLine)) : " No devices online.")
        );
      }
      await spotify.transferPlayback(matches[0].id, true);
      return `📱 Playback transferred to ${matches[0].name}.`;
    })
  );
}
