# Contributing

## Setup

```sh
git clone https://github.com/XavierFabregat/spotify-mcp.git
cd spotify-mcp
npm install
npm test          # builds + runs the suite (no Spotify account needed)
```

`npm run test:live` runs read-only checks against a real Spotify account — it
needs your own setup (`npx . init`) and is never run in CI.

## Pull requests

- `main` is protected: all changes land via PR with green CI (Node 20/22/24).
- Add or update tests for behavior changes — see `test/` for the patterns
  (mocked `fetch` for API behavior, the stdio integration test for the tool
  surface).
- Keep the tool surface small and intent-shaped: prefer extending an existing
  tool over adding a new one, compact text responses with Spotify URIs, errors
  that tell the model what to do next.
- Target the current (post-Feb-2026) Spotify Web API. No new runtime
  dependencies without a strong reason.
