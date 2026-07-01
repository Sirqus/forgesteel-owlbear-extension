const CLEANUP_RELOAD_KEY =
  'net.forgesteel.owlbear.serviceWorkerCleanupReloaded.v1'

const STALE_SERVICE_WORKER_PATHS = [
  '/',
  '/forgesteel-owlbear/',
  '/forgesteel-owlbear-bridge/',
  '/forgesteel-owlbear-extension/',
]

export async function cleanupForgeSteelServiceWorkers({
  reload = false,
}: {
  reload?: boolean
} = {}): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false
  }

  try {
    const staleScopes = new Set(
      STALE_SERVICE_WORKER_PATHS.map((path) =>
        new URL(path, window.location.origin).href,
      ),
    )
    const registrations = await navigator.serviceWorker.getRegistrations()
    const staleRegistrations = registrations.filter((registration) =>
      staleScopes.has(registration.scope),
    )

    if (staleRegistrations.length === 0) {
      return false
    }

    await Promise.all(
      staleRegistrations.map((registration) => registration.unregister()),
    )
    await deleteForgeSteelCaches()

    if (reload && sessionStorage.getItem(CLEANUP_RELOAD_KEY) !== '1') {
      sessionStorage.setItem(CLEANUP_RELOAD_KEY, '1')
      window.location.reload()
    }

    return true
  } catch (error) {
    console.warn('Unable to clean up stale ForgeSteel service workers.', error)
    return false
  }
}

async function deleteForgeSteelCaches() {
  if (!('caches' in window)) {
    return
  }

  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith('forgesteel-'))
      .map((cacheName) => caches.delete(cacheName)),
  )
}
