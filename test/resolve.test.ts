import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("../src/spotify.js", () => ({ search: searchMock }));

import { resolvePlayable } from "../src/tools/playback.js";

beforeEach(() => {
  searchMock.mockReset();
});

describe("resolvePlayable()", () => {
  it("picks the top track and labels it", async () => {
    searchMock.mockResolvedValue({
      tracks: {
        items: [
          {
            name: "So What",
            uri: "spotify:track:1",
            artists: [{ name: "Miles Davis", uri: "a" }],
            album: { name: "Kind of Blue", uri: "al" },
          },
        ],
      },
    });
    const res = await resolvePlayable("so what", "track");
    expect(res?.uri).toBe("spotify:track:1");
    expect(res?.label).toContain("So What");
    expect(res?.label).toContain("Miles Davis");
  });

  it("returns null when nothing matches", async () => {
    searchMock.mockResolvedValue({ tracks: { items: [] } });
    await expect(resolvePlayable("zzz", "track")).resolves.toBeNull();
  });

  it("resolves albums via context URI", async () => {
    searchMock.mockResolvedValue({
      albums: { items: [{ name: "Kind of Blue", uri: "spotify:album:1", artists: [{ name: "Miles Davis", uri: "a" }] }] },
    });
    const res = await resolvePlayable("kind of blue", "album");
    expect(res?.uri).toBe("spotify:album:1");
    expect(res?.label).toContain("Kind of Blue");
  });

  it("skips null entries in playlist results (Spotify quirk)", async () => {
    searchMock.mockResolvedValue({
      playlists: { items: [null, { name: "Jazz", uri: "spotify:playlist:1", id: "1" }] },
    });
    const res = await resolvePlayable("jazz", "playlist");
    expect(res?.uri).toBe("spotify:playlist:1");
  });
});
