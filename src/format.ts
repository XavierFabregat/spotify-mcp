/**
 * Compact, model-friendly formatting. Every entity line carries its Spotify
 * URI so follow-up tool calls ("queue that") can chain without re-searching.
 * Raw API payloads are never returned to the client.
 */
import type { Album, Artist, Device, PlaybackState, Playlist, Track } from "./spotify.js";

export function msToClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function trackLine(t: Track): string {
  const artists = t.artists?.map((a) => a.name).join(", ");
  const album = t.album?.name ? ` · ${t.album.name}` : "";
  return `"${t.name}"${artists ? ` — ${artists}` : ""}${album} [${t.uri}]`;
}

export function albumLine(a: Album): string {
  const artists = a.artists?.map((x) => x.name).join(", ");
  const year = a.release_date?.slice(0, 4);
  return `"${a.name}"${artists ? ` — ${artists}` : ""}${year ? ` (${year})` : ""} [${a.uri}]`;
}

export function artistLine(a: Artist): string {
  return `${a.name} [${a.uri}]`;
}

export function playlistLine(p: Playlist): string {
  const count = p.items?.total ?? p.tracks?.total;
  const owner = p.owner?.display_name;
  return (
    `"${p.name}"` +
    (count !== undefined ? ` — ${count} items` : "") +
    (owner ? ` (by ${owner})` : "") +
    ` [${p.uri}]`
  );
}

export function deviceLine(d: Device): string {
  return (
    `${d.name} (${d.type.toLowerCase()})` +
    (d.is_active ? " — active" : "") +
    (d.volume_percent != null ? `, volume ${d.volume_percent}%` : "") +
    ` [id: ${d.id ?? "unavailable"}]`
  );
}

export function nowPlayingText(state: PlaybackState | null): string {
  if (!state?.item) return "Nothing is playing right now.";
  const lines = [
    `${state.is_playing ? "▶ Playing" : "⏸ Paused"}: ${trackLine(state.item)}`,
  ];
  if (state.progress_ms != null && state.item.duration_ms != null) {
    lines.push(`Position: ${msToClock(state.progress_ms)} / ${msToClock(state.item.duration_ms)}`);
  }
  if (state.device) lines.push(`Device: ${state.device.name} (${state.device.type.toLowerCase()})`);
  const modes = [
    state.shuffle_state ? "shuffle on" : null,
    state.repeat_state && state.repeat_state !== "off" ? `repeat ${state.repeat_state}` : null,
  ].filter(Boolean);
  if (modes.length) lines.push(`Mode: ${modes.join(", ")}`);
  return lines.join("\n");
}

export function deviceChoiceMessage(devices: Device[]): string {
  if (devices.length === 0) {
    return (
      "No Spotify devices are available. Open the Spotify app on any device " +
      "(phone, desktop, speaker) — it may need a play/pause tap to wake up — then try again."
    );
  }
  return (
    "No active Spotify device. Available devices:\n" +
    devices.map((d) => `- ${deviceLine(d)}`).join("\n") +
    "\nAsk the user which device to use, then retry with that device_id (or use the devices tool to transfer)."
  );
}

export function numbered(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}
