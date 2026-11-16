import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("../src/spotify.js", () => ({ search: searchMock }));

import { parseOnOff, playableKind, resolvePlayable } from "../src/tools/playback.js";

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

describe("parseOnOff()", () => {
  it.each([
    ["on", true],
    ["ON", true],
    [true, true],
    ["off", false],
    [false, false],
  ])("%s → %s", (input, expected) => {
    expect(parseOnOff(input)).toBe(expected);
  });

  it.each([undefined, "", "maybe", 1])("rejects %s instead of defaulting to off", (input) => {
    expect(parseOnOff(input)).toBeNull();
  });
});

describe("playableKind()", () => {
  it("reads the kind from a playable URI", () => {
    expect(playableKind("spotify:album:1weenld61qoidwYuZ1GESA")).toBe("album");
    expect(playableKind("spotify:track:1")).toBe("track");
  });

  it.each(["Kind of Blue", "spotify:show:123", "https://open.spotify.com/track/1", "spotify:track:"])(
    "rejects %s",
    (input) => {
      expect(playableKind(input)).toBeNull();
    }
  );
});
