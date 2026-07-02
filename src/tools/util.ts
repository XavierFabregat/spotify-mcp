import { NoActiveDeviceError } from "../errors.js";
import { deviceChoiceMessage } from "../format.js";
import { getDevices } from "../spotify.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** An error whose message is already phrased for the end user / model. */
export class ToolMessageError extends Error {}

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Wraps a tool implementation so every typed error surfaces as an actionable
 * message instead of a stack trace. The model reads these and knows what to
 * tell the user or which tool to call next.
 */
export function run<A>(fn: (args: A) => Promise<string>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

/**
 * Executes a player command; on NO_ACTIVE_DEVICE it auto-targets the only
 * available device, or raises a message listing devices to choose from.
 */
export async function withDeviceFallback<T>(
  fn: (deviceId?: string) => Promise<T>
): Promise<{ result: T; deviceNote: string }> {
  try {
    return { result: await fn(undefined), deviceNote: "" };
  } catch (e) {
    if (!(e instanceof NoActiveDeviceError)) throw e;
    const devices = await getDevices();
    const usable = devices.filter((d) => d.id);
    if (usable.length === 1) {
      const device = usable[0];
      return { result: await fn(device.id!), deviceNote: ` on ${device.name}` };
    }
    throw new ToolMessageError(deviceChoiceMessage(devices));
  }
}

/** Accepts a bare id, spotify:playlist:… URI, or open.spotify.com URL. */
export function normalizePlaylistId(input: string): string {
  return (
    input.match(/spotify:playlist:([A-Za-z0-9]+)/)?.[1] ??
    input.match(/playlist\/([A-Za-z0-9]+)/)?.[1] ??
    input
  );
}
