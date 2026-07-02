import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoActiveDeviceError } from "../src/errors.js";

const { getDevicesMock } = vi.hoisted(() => ({ getDevicesMock: vi.fn() }));
vi.mock("../src/spotify.js", () => ({ getDevices: getDevicesMock }));

import { normalizePlaylistId, ToolMessageError, withDeviceFallback } from "../src/tools/util.js";

const device = (id: string, name: string) => ({
  id,
  name,
  type: "Computer",
  is_active: false,
  volume_percent: 50,
});

beforeEach(() => {
  getDevicesMock.mockReset();
});

describe("withDeviceFallback()", () => {
  it("passes through a first-try success without touching devices", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    await expect(withDeviceFallback(fn)).resolves.toEqual({ result: "done", deviceNote: "" });
    expect(getDevicesMock).not.toHaveBeenCalled();
  });

  it("auto-targets the only available device and notes it", async () => {
    getDevicesMock.mockResolvedValue([device("d1", "MacBook")]);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new NoActiveDeviceError())
      .mockResolvedValueOnce("done");
    await expect(withDeviceFallback(fn)).resolves.toEqual({ result: "done", deviceNote: " on MacBook" });
    expect(fn).toHaveBeenLastCalledWith("d1");
  });

  it("asks the user to choose among multiple devices", async () => {
    getDevicesMock.mockResolvedValue([device("d1", "MacBook"), device("d2", "iPhone")]);
    const fn = vi.fn().mockRejectedValue(new NoActiveDeviceError());
    const err = await withDeviceFallback(fn).catch((e) => e);
    expect(err).toBeInstanceOf(ToolMessageError);
    expect(err.message).toContain("MacBook");
    expect(err.message).toContain("iPhone");
    expect(fn).toHaveBeenCalledTimes(1); // no blind retry
  });

  it("explains how to wake Spotify when no devices exist", async () => {
    getDevicesMock.mockResolvedValue([]);
    const fn = vi.fn().mockRejectedValue(new NoActiveDeviceError());
    const err = await withDeviceFallback(fn).catch((e) => e);
    expect(err).toBeInstanceOf(ToolMessageError);
    expect(err.message).toMatch(/Open the Spotify app/);
  });

  it("rethrows unrelated errors untouched", async () => {
    const boom = new Error("boom");
    const fn = vi.fn().mockRejectedValue(boom);
    await expect(withDeviceFallback(fn)).rejects.toBe(boom);
    expect(getDevicesMock).not.toHaveBeenCalled();
  });
});

describe("normalizePlaylistId()", () => {
  it.each([
    ["spotify:playlist:3ZqVbRcdKt2YlcHd91CGMR", "3ZqVbRcdKt2YlcHd91CGMR"],
    ["https://open.spotify.com/playlist/3ZqVbRcdKt2YlcHd91CGMR?si=abc123", "3ZqVbRcdKt2YlcHd91CGMR"],
    ["3ZqVbRcdKt2YlcHd91CGMR", "3ZqVbRcdKt2YlcHd91CGMR"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePlaylistId(input)).toBe(expected);
  });
});
