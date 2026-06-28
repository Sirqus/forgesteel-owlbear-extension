# ForgeSteel Owlbear Extension

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
cd C:\RPG\forgesteel-owlbear-bridge
npm.cmd run start -- --host 127.0.0.1 --port 5174 --strictPort
```

```powershell
cd C:\RPG\forgesteel-owlbear-extension
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Vite dev mode points the iframe at `http://localhost:5174` by default. Production builds point at `https://sirqus.github.io/forgesteel-owlbear-bridge/`, unless `VITE_FORGESTEEL_URL` is set.

When the bridge app is running on port `5174`, the extension passes `owlbearBridge=1` and `owlbearOrigin=http://localhost:5173` to the iframe so ForgeSteel can post roll messages back to the extension.

## Development

```powershell
npm.cmd run build
npm.cmd run lint
```

The static files are generated in `dist` when `npm.cmd run build` completes.

## GitHub Pages

This repo deploys with GitHub Actions. In GitHub, open **Settings -> Pages** and set **Build and deployment / Source** to **GitHub Actions**. Then push to `master` or run the `Deploy GitHub Pages` workflow manually.

The public Owlbear manifest URL is:

```text
https://sirqus.github.io/forgesteel-owlbear-extension/manifest.json
```

Install that URL in Owlbear Rodeo as the custom extension manifest. Do not publish the repo root as the Pages source; Vite apps must publish the generated `dist` artifact.

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
