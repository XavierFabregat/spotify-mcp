/** Typed errors the tools convert into actionable, user-facing messages. */

export class NotConfiguredError extends Error {
  constructor() {
    super(
      "No Spotify Client ID configured. Run `npx -y @xavifabregat/spotify-mcp init` in a " +
        "terminal for guided setup, or set the SPOTIFY_CLIENT_ID environment variable in " +
        "your MCP client config."
    );
    this.name = "NotConfiguredError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor(detail?: string) {
    super(
      (detail ? detail + " " : "") +
        "Not connected to Spotify. Run the `authenticate` tool (it opens a browser to approve " +
        "access), or run `npm run auth` from the spotify-mcp directory."
    );
    this.name = "NotAuthenticatedError";
  }
}

export class NoActiveDeviceError extends Error {
  constructor() {
    super("No active Spotify device.");
    this.name = "NoActiveDeviceError";
  }
}

export class PremiumRequiredError extends Error {
  constructor() {
    super(
      "Spotify Premium is required for playback control. This account does not appear to have Premium."
    );
    this.name = "PremiumRequiredError";
  }
}

export class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(`Spotify API error (${status}): ${message}`);
    this.name = "SpotifyApiError";
  }
}
