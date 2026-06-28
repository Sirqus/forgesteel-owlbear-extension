# ForgeSteel Owlbear Bridge

Standalone Owlbear Rodeo extension MVP for embedding ForgeSteel and receiving future ForgeSteel bridge events.

## Local Setup

For extension-only development:

```powershell
npm.cmd install
npm.cmd run dev
```

The local Owlbear extension manifest is served at:

```text
http://localhost:5173/manifest.json
```

Install that manifest URL through Owlbear Rodeo's extension/install flow while the Vite dev server is running.

For local ForgeSteel bridge testing, run both apps:

```powershell
cd C:\RPG\forgesteel-source
npm.cmd run start -- --host 127.0.0.1 --port 5174 --strictPort
```

```powershell
cd C:\RPG\forgesteel-owlbear-extension
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Vite dev mode points the iframe at `http://localhost:5174` by default. Production builds still point at `https://forgesteel.net`, unless `VITE_FORGESTEEL_URL` is set.

The local ForgeSteel bridge work currently lives in `C:\RPG\forgesteel-source` on the `owlbear-roll-bridge` branch. When that app is running on port `5174`, the extension passes `owlbearBridge=1` and `owlbearOrigin=http://localhost:5173` to the iframe so ForgeSteel can post roll messages back to the extension.

## Development

```powershell
npm.cmd run build
npm.cmd run lint
```

In development builds, the Rolls tab includes an `Add Test Roll` button. It posts a local `FORGESTEEL_ROLL_RESULT` message so the extension can be tested before ForgeSteel emits bridge messages itself.

## ForgeSteel Bridge Contract

ForgeSteel should send messages to the parent extension with `window.parent.postMessage(message, targetOrigin)`. For local development, `targetOrigin` is the extension origin, such as `http://localhost:5173`. For production, use the deployed extension origin.

Ready message:

```ts
type ForgeSteelReadyMessage = {
  type: 'FORGESTEEL_READY'
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel'
}
```

Roll message:

```ts
type ForgeSteelRollResultMessage = {
  type: 'FORGESTEEL_ROLL_RESULT'
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel'
  payload: {
    actorName: string
    label: string
    formula: string
    total: number
    breakdown?: string
  }
}
```

The extension ignores malformed messages, unsupported schema versions, duplicate `messageId` values, and non-ForgeSteel origins in production.

## License Notes

This extension does not copy ForgeSteel source code. ForgeSteel lives at `andyaiken/forgesteel` and is GPL-3.0, so future changes that copy or distribute ForgeSteel code should follow GPL-3.0 obligations and preserve the separate Draw Steel creator-license notices.
