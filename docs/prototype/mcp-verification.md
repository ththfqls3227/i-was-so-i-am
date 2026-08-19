# Playwright MCP Verification

Date: 2026-08-17 KST  
Target: local Vite build at `http://127.0.0.1:4173/`

## Configuration

- Project-scoped server: `.codex/config.toml`
- Portable launcher: `scripts/playwright-mcp-server.mjs` (no absolute repository or browser path)
- Server package: exact `@playwright/mcp@0.0.78`
- Client: exact `@modelcontextprotocol/sdk@1.30.0`
- Browser: isolated headless Chromium
- Executable resolution: `PLAYWRIGHT_MCP_EXECUTABLE_PATH` when provided, otherwise the installed Playwright Chromium path
- Allowed browser origins: `127.0.0.1:4173` and `localhost:4173` only
- Codex registry check: `codex mcp list` and `codex mcp get playwright` report the server enabled

## Reproduce

Run the two commands in separate terminals:

```bash
npm run dev -- --host 127.0.0.1 --port 4173
npm run test:mcp
```

## Verified result

`npm run test:mcp` connected to the server over stdio MCP and returned `PASS` after:

- discovering 24 MCP browser tools;
- navigating to the game and checking the `I WAS, SO I AM` title/start action;
- reading accessible snapshots for the title, all four production rooms, and ending;
- completing the live Crossing record-reset-cooperate loop with keyboard input;
- completing Crossing, Trace Weight, Handoff, and Last Hold at 30 and 144 Hz schedules;
- physically recording the past and then driving the present through all four live Babylon scenes with keyboard input, checking every visible success card, and advancing into the authored farewell ending;
- confirming zero browser console errors; and
- capturing `.playwright-mcp/crossing-success.png`.

The generated `.playwright-mcp/` evidence directory is intentionally git-ignored. A new Codex session is still required before the native tool surface reflects newly added MCP configuration, because MCP tools are loaded at session startup.
