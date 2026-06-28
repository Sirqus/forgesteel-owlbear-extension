import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const BASE_PATH = normalizeBasePath(process.env.VITE_BASE_PATH ?? '/')
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.VITE_PUBLIC_BASE_URL)

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    owlbearManifestPlugin(),
    {
      name: 'forgesteel-manifest-no-cache',
      configureServer(server) {
        server.middlewares.use(noCacheManifests)
      },
      configurePreviewServer(server) {
        server.middlewares.use(noCacheManifests)
      },
    },
  ],
  server: {
    allowedHosts: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  },
  preview: {
    allowedHosts: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  },
})

function owlbearManifestPlugin(): Plugin {
  return {
    name: 'forgesteel-owlbear-manifest',
    configureServer(server) {
      server.middlewares.use('/manifest.json', (_request, response) => {
        sendManifest(response)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/manifest.json', (_request, response) => {
        sendManifest(response)
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(createOwlbearManifest(), null, 2),
      })
    },
  }
}

function createOwlbearManifest() {
  const iconUrl = manifestUrl('icon.svg')

  return {
    name: 'ForgeSteel Bridge',
    version: '0.1.0',
    manifest_version: 1,
    description:
      'Embed ForgeSteel and collect bridge-ready roll events in Owlbear Rodeo.',
    author: 'ForgeSteel Owlbear Bridge contributors',
    homepage_url: 'https://github.com/Sirqus/forgesteel-owlbear-extension',
    icon: iconUrl,
    action: {
      title: 'ForgeSteel',
      icon: iconUrl,
      popover: manifestUrl(''),
      height: 520,
      width: 450,
    },
  }
}

function sendManifest(response: {
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}) {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  response.end(JSON.stringify(createOwlbearManifest(), null, 2))
}

function manifestUrl(path: string): string {
  if (PUBLIC_BASE_URL) {
    return `${PUBLIC_BASE_URL}/${path}`.replace(/\/$/, '/')
  }

  return `${BASE_PATH}${path}`
}

function normalizeBasePath(path: string): string {
  if (!path || path === '/') {
    return '/'
  }

  return `/${path.replace(/^\/+|\/+$/g, '')}/`
}

function normalizePublicBaseUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  return url.replace(/\/+$/g, '')
}

function noCacheManifests(
  request: { url?: string; headers: Record<string, string | string[] | undefined> },
  response: { setHeader: (name: string, value: string) => void },
  next: () => void,
) {
  const path = request.url?.split('?')[0] ?? ''

  if (path.includes('manifest') && path.endsWith('.json')) {
    delete request.headers['if-none-match']
    delete request.headers['if-modified-since']
    response.setHeader('Cache-Control', 'no-store, max-age=0')
  }

  next()
}
