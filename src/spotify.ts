/**
 * Thin typed client for the Spotify Web API (post-February-2026 surface):
 * playlist items live at /playlists/{id}/items, library is the unified
 * /me/library, search limit is capped at 10, no batch catalog fetches.
 */
import { getAccessToken } from "./auth.js";
import { NoActiveDeviceError, PremiumRequiredError, SpotifyApiError } from "./errors.js";

const API_BASE = "https://api.spotify.com/v1";

// --- Minimal payload types (only the fields we render) ---

export interface Artist {
  name: string;
  uri: string;
}

export interface Track {
  name: string;
  uri: string;
  duration_ms?: number;
  artists?: Artist[];
  album?: { name: string; uri: string };
}

export interface Album {
  name: string;
  uri: string;
  artists?: Artist[];
  total_tracks?: number;
  release_date?: string;
}

export interface Playlist {
  id: string;
  name: string;
  uri: string;
  description?: string;
  owner?: { display_name?: string };
  items?: { total?: number };
  tracks?: { total?: number }; // pre-rename field, kept as fallback
  external_urls?: { spotify?: string };
}

export interface Device {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface PlaybackState {
  device?: Device;
  shuffle_state?: boolean;
  repeat_state?: "off" | "context" | "track";
  progress_ms?: number;
  is_playing?: boolean;
  item?: Track | null;
  context?: { uri: string; type: string } | null;
}

export interface SearchResults {
  tracks?: { items: Track[] };
  albums?: { items: Album[] };
  artists?: { items: Artist[] };
  playlists?: { items: (Playlist | null)[] };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function request<T>(path: string, opts: RequestOptions = {}, attempt = 0): Promise<T> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const token = await getAccessToken(attempt > 0);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && attempt === 0) return request(path, opts, 1);
  if (res.status === 429 && attempt === 0) {
    const wait = Math.min(Number(res.headers.get("Retry-After") ?? 2), 30);
    await sleep(wait * 1000);
    return request(path, opts, 1);
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; reason?: string };
    };
    const reason = payload.error?.reason ?? "";
    const message = payload.error?.message ?? res.statusText;
    if (reason === "NO_ACTIVE_DEVICE" || (res.status === 404 && /active device/i.test(message))) {
      throw new NoActiveDeviceError();
    }
    if (reason === "PREMIUM_REQUIRED" || (res.status === 403 && /premium/i.test(message))) {
      throw new PremiumRequiredError();
    }
    throw new SpotifyApiError(res.status, message);
  }

  if (res.status === 204) return null as T;
  // Player commands sometimes return 200 with an empty or non-JSON body.
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

// --- Profile ---

export const getMe = () => request<{ display_name?: string; id: string }>("/me");

// --- Search (limit capped at 10 since Feb 2026) ---

export function search(q: string, types: string[], limit = 5): Promise<SearchResults> {
  return request<SearchResults>("/search", {
    query: { q, type: types.join(","), limit: Math.min(limit, 10) },
  });
}

// --- Player ---

export const getPlaybackState = () => request<PlaybackState | null>("/me/player");

export const getDevices = async (): Promise<Device[]> =>
  (await request<{ devices: Device[] }>("/me/player/devices")).devices;

export function startPlayback(
  body?: { uris?: string[]; context_uri?: string },
  deviceId?: string
): Promise<null> {
  return request("/me/player/play", {
    method: "PUT",
    query: { device_id: deviceId },
    body: body ?? {},
  });
}

export const pause = (deviceId?: string) =>
  request<null>("/me/player/pause", { method: "PUT", query: { device_id: deviceId } });
export const skipNext = (deviceId?: string) =>
  request<null>("/me/player/next", { method: "POST", query: { device_id: deviceId } });
export const skipPrevious = (deviceId?: string) =>
  request<null>("/me/player/previous", { method: "POST", query: { device_id: deviceId } });

export const seek = (positionMs: number, deviceId?: string) =>
  request<null>("/me/player/seek", {
    method: "PUT",
    query: { position_ms: positionMs, device_id: deviceId },
  });

export const setVolume = (percent: number, deviceId?: string) =>
  request<null>("/me/player/volume", {
    method: "PUT",
    query: { volume_percent: percent, device_id: deviceId },
  });

export const setShuffle = (on: boolean, deviceId?: string) =>
  request<null>("/me/player/shuffle", {
    method: "PUT",
    query: { state: on, device_id: deviceId },
  });

export const setRepeat = (state: "off" | "context" | "track", deviceId?: string) =>
  request<null>("/me/player/repeat", { method: "PUT", query: { state, device_id: deviceId } });

export const transferPlayback = (deviceId: string, play: boolean) =>
  request<null>("/me/player", { method: "PUT", body: { device_ids: [deviceId], play } });

export const getQueue = () =>
  request<{ currently_playing: Track | null; queue: Track[] }>("/me/player/queue");

export const addToQueue = (uri: string, deviceId?: string) =>
  request<null>("/me/player/queue", { method: "POST", query: { uri, device_id: deviceId } });

// --- Playlists ---

export const getMyPlaylists = (limit = 50, offset = 0) =>
  request<{ items: Playlist[]; total: number }>("/me/playlists", { query: { limit, offset } });

/** Entries may expose the track under `item` (post-rename) or `track` (legacy). */
export const getPlaylistItems = (playlistId: string, limit = 50, offset = 0) =>
  request<{ items: { item?: Track; track?: Track }[]; total: number }>(
    `/playlists/${playlistId}/items`,
    { query: { limit, offset } }
  );

export const createPlaylist = (name: string, description?: string, isPublic = false) =>
  request<Playlist>("/me/playlists", {
    method: "POST",
    body: { name, description, public: isPublic },
  });

export const addPlaylistItems = (playlistId: string, uris: string[]) =>
  request<{ snapshot_id: string }>(`/playlists/${playlistId}/items`, {
    method: "POST",
    body: { uris },
  });

// --- Library (unified endpoints, Feb 2026) ---

export const librarySave = (uris: string[]) =>
  request<null>("/me/library", { method: "PUT", body: { uris } });

export const libraryRemove = (uris: string[]) =>
  request<null>("/me/library", { method: "DELETE", body: { uris } });

export const libraryContains = (uris: string[]) =>
  request<boolean[]>("/me/library/contains", { query: { uris: uris.join(",") } });
