# vinext-starter

R2 的整体需求、流程、数据与恢复边界见仓库根目录 `docs/R2-实验系统总说明.md`；真实设备通信与安全规则见 `docs/serial-haptic-protocol.md`。

## Spirit Ruins experimental game

The playable experimental module is in `app/game/`. The rendering layer has no haptic-device output in this release; NH, BH and STH are event metadata only and do not alter visual or gameplay parameters.

### R2 integration (2026-08-26)

The game is embedded by the R2 experiment system and is **not** a participant entry point. The dev server is pinned to **`http://localhost:3001`** (`server.port: 3001, strictPort: true` in `vite.config.ts`).

- Embedded practice (R2 builds this URL with a session id it generated and saved):
  `http://localhost:3001/?mode=practice&embedded=1&sessionId=<sessionId>&parentOrigin=<R2 origin>`.
  The game posts `PRACTICE_READY`, `PRACTICE_COMPLETE` and `PRACTICE_ERROR` with
  `source: "spirit-ruins"`, `protocolVersion: 1` and the session id — only to the
  validated `parentOrigin`, never to `*`. Opening an embedded-practice URL directly
  in a browser tab degrades to ordinary local practice.
- Embedded experiment (R2 supplies the shared `timelineSeed`, sequence ids, run id
  and parent origin):
  `http://localhost:3001/?mode=experiment&sessionId=…&runId=…&condition=BH|STH&projectileSequence=…&areaSequence=…&timelineSeed=…&parentOrigin=…`.
  The game posts `GAME_READY`, `GAME_EVENT` and `RUN_COMPLETE` (all carrying the
  protocol version and session/run identity) and accepts exactly one
  identity-checked `START_RUN`. In embedded mode the game hides its own header,
  developer panel, restart controls and end-of-run banners; local mode switching
  is never shown.

### Standalone developer preview

Run a local developer session:

```bash
npm run dev
# then open http://localhost:3001/?mode=developer&sessionId=DEV-001&runId=DEV-001-R1&condition=STH&projectileSequence=S1&areaSequence=A1
```

Practice mode uses private generated IDs and does not create a parent bridge:

```text
http://localhost:3001/?mode=practice
```

Developer mode provides a local `Download run JSON` control after a terminal result. No participant name, contact information, device API, serial connection, WebSocket, or haptic-output call is stored or used.

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## Serial haptic settings (2026-08-26)

A global serial settings page lives at `http://localhost:3001/?mode=serial` (Chrome/Edge,
localhost or HTTPS required). The operator picks a local serial port and connects with a
fixed baud rate (115200, not user-facing); the page exposes voltage setting (0–255,
0 = output off), per-event test buttons and an explicit enable switch.

When connected **and** enabled, game events dispatch single-byte event notifications at
event start through `app/game/hapticSerial.ts` (`dispatchSample`), mapped from each
timeline event's `hapticSampleKey` — see `docs/serial-haptic-protocol.md` for the full
protocol and the RP2040 firmware contract. Electrical output stays off by default and
every stop/disconnect isolates all electrodes.
