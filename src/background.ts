import {
  addUnreadLogId,
  isLogViewActive,
  loadUnreadLogIds,
} from './lib/logAttention'
import type { TableLogEntry } from './lib/logStorage'
import {
  getCurrentPlayerInfo,
  listenForSharedLogEvents,
  setActionBadgeCount,
  showSharedLogNotification,
} from './lib/owlbear'
import { isSameRollPlayer } from './lib/playerIdentity'
import { cleanupForgeSteelServiceWorkers } from './lib/serviceWorkerCleanup'

void startBackgroundListener()

async function startBackgroundListener() {
  await cleanupForgeSteelServiceWorkers()

  const localPlayer = await getCurrentPlayerInfo()

  await setActionBadgeCount(loadUnreadLogIds().size)

  await listenForSharedLogEvents((event) => {
    if (isSameRollPlayer(event.entry.player, localPlayer)) {
      return
    }

    updateUnreadBadge(event.entry)
    void showSharedLogNotification(event.entry)
  })
}

function updateUnreadBadge(entry: TableLogEntry) {
  if (isLogViewActive()) {
    return
  }

  const unreadLogIds = addUnreadLogId(entry.id)
  void setActionBadgeCount(unreadLogIds.size)
}
