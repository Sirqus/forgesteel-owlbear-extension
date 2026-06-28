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
  showSharedRollNotification,
} from './lib/owlbear'
import { isSameRollPlayer } from './lib/playerIdentity'

void startBackgroundListener()

async function startBackgroundListener() {
  const localPlayer = await getCurrentPlayerInfo()

  await setActionBadgeCount(loadUnreadLogIds().size)

  await listenForSharedLogEvents((event) => {
    if (isSameRollPlayer(event.entry.player, localPlayer)) {
      return
    }

    updateUnreadBadge(event.entry)

    if (event.entry.kind === 'roll') {
      void showSharedRollNotification(event.entry)
    }
  })
}

function updateUnreadBadge(entry: TableLogEntry) {
  if (isLogViewActive()) {
    return
  }

  const unreadLogIds = addUnreadLogId(entry.id)
  void setActionBadgeCount(unreadLogIds.size)
}
