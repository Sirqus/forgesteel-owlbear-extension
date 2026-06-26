import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
