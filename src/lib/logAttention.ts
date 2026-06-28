const UNREAD_LOG_IDS_STORAGE_KEY = 'net.forgesteel.owlbear.unreadLogIds.v1'
const LOG_VIEW_ACTIVE_STORAGE_KEY = 'net.forgesteel.owlbear.logViewActive.v1'
const LOG_VIEW_ACTIVE_TTL_MS = 15000

export const UNREAD_LOG_IDS_CHANGED_EVENT =
  'forgesteel-owlbear-unread-log-ids-changed'

export function loadUnreadLogIds(): Set<string> {
  try {
    const storedValue = localStorage.getItem(UNREAD_LOG_IDS_STORAGE_KEY)

    if (!storedValue) {
      return new Set()
    }

    const parsedValue = JSON.parse(storedValue)

    if (!Array.isArray(parsedValue)) {
      return new Set()
    }

    return new Set(
      parsedValue.filter((logId): logId is string => typeof logId === 'string'),
    )
  } catch (error) {
    console.warn('Unable to read ForgeSteel unread log state.', error)
    return new Set()
  }
}

export function addUnreadLogId(logId: string): Set<string> {
  const logIds = loadUnreadLogIds()
  logIds.add(logId)
  saveUnreadLogIds(logIds)
  return logIds
}

export function clearUnreadLogIds(): void {
  try {
    localStorage.removeItem(UNREAD_LOG_IDS_STORAGE_KEY)
    notifyUnreadLogIdsChanged()
  } catch (error) {
    console.warn('Unable to clear ForgeSteel unread log state.', error)
  }
}

export function setLogViewActive(active: boolean): void {
  try {
    if (!active) {
      localStorage.removeItem(LOG_VIEW_ACTIVE_STORAGE_KEY)
      return
    }

    localStorage.setItem(
      LOG_VIEW_ACTIVE_STORAGE_KEY,
      JSON.stringify({ active: true, updatedAt: Date.now() }),
    )
  } catch (error) {
    console.warn('Unable to save ForgeSteel log view state.', error)
  }
}

export function isLogViewActive(): boolean {
  try {
    const storedValue = localStorage.getItem(LOG_VIEW_ACTIVE_STORAGE_KEY)

    if (!storedValue) {
      return false
    }

    const parsedValue = JSON.parse(storedValue) as {
      active?: unknown
      updatedAt?: unknown
    }

    return (
      parsedValue.active === true &&
      typeof parsedValue.updatedAt === 'number' &&
      Date.now() - parsedValue.updatedAt < LOG_VIEW_ACTIVE_TTL_MS
    )
  } catch (error) {
    console.warn('Unable to read ForgeSteel log view state.', error)
    return false
  }
}

function saveUnreadLogIds(logIds: Set<string>): void {
  try {
    localStorage.setItem(
      UNREAD_LOG_IDS_STORAGE_KEY,
      JSON.stringify([...logIds]),
    )
    notifyUnreadLogIdsChanged()
  } catch (error) {
    console.warn('Unable to save ForgeSteel unread log state.', error)
  }
}

function notifyUnreadLogIdsChanged(): void {
  window.dispatchEvent(new Event(UNREAD_LOG_IDS_CHANGED_EVENT))
}
