import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoActiveDeviceError, PremiumRequiredError, SpotifyApiError } from "../src/errors.js";

const { getAccessTokenMock } = vi.hoisted(() => ({ getAccessTokenMock: vi.fn() }));
vi.mock("../src/auth.js", () => ({ getAccessToken: getAccessTokenMock }));

import * as spotify from "../src/spotify.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  fetchMock.mockReset();
  getAccessTokenMock.mockReset().mockResolvedValue("tok");
});

describe("request()", () => {
  it("sends the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "u", display_name: "X" }));
    await spotify.getMe();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("returns null on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(spotify.pause()).resolves.toBeNull();
  });

  it("tolerates a junk non-JSON 200 body (skip-track regression)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("xB1gAcELarJunk", { status: 200 }));
    await expect(spotify.skipNext()).resolves.toBeNull();
  });

  it("tolerates an empty 200 body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(spotify.skipNext()).resolves.toBeNull();
  });

  it("force-refreshes the token and retries once on 401", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ devices: [] }));
    await expect(spotify.getDevices()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessTokenMock).toHaveBeenLastCalledWith(true);
  });

  it("waits out Retry-After and retries once on 429", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(json({ devices: [] }));
    await expect(spotify.getDevices()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps NO_ACTIVE_DEVICE to NoActiveDeviceError", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { status: 404, message: "Player command failed", reason: "NO_ACTIVE_DEVICE" } }, 404)
    );
    await expect(spotify.pause()).rejects.toBeInstanceOf(NoActiveDeviceError);
  });

  it("maps a 404 'no active device' message without a reason field", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { status: 404, message: "No active device found" } }, 404)
    );
    await expect(spotify.pause()).rejects.toBeInstanceOf(NoActiveDeviceError);
  });

  it("maps PREMIUM_REQUIRED to PremiumRequiredError", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }, 403)
    );
    await expect(spotify.skipNext()).rejects.toBeInstanceOf(PremiumRequiredError);
  });

  it("wraps other failures in SpotifyApiError with the status", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "boom" } }, 500));
    const err = await spotify.getMe().catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err.status).toBe(500);
    expect(err.message).toContain("boom");
  });
});

describe("search()", () => {
  it("clamps limit to the API maximum of 10", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await spotify.search("miles davis", ["track"], 50);
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=10");
  });

  it("joins multiple types", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await spotify.search("q", ["track", "album"], 5);
    expect(String(fetchMock.mock.calls[0][0])).toContain("type=track%2Calbum");
  });
});
