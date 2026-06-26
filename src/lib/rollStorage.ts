import type {
  ForgeSteelRollPayload,
  ForgeSteelRollResultMessage,
} from './bridge'

const STORAGE_KEY = 'net.forgesteel.owlbear.rolls.v1'
const MAX_ROLLS = 100

export type StoredRoll = ForgeSteelRollPayload & {
  id: string
  timestamp: string
}

export function loadStoredRolls(): StoredRoll[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isStoredRoll)
  } catch (error) {
    console.warn('Unable to load ForgeSteel roll history.', error)
    return []
  }
}

export function saveStoredRolls(rolls: StoredRoll[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(rolls.slice(0, MAX_ROLLS)),
    )
  } catch (error) {
    console.warn('Unable to persist ForgeSteel roll history.', error)
  }
}

export function appendRoll(
  rolls: StoredRoll[],
  message: ForgeSteelRollResultMessage,
): StoredRoll[] {
  if (rolls.some((roll) => roll.id === message.messageId)) {
    return rolls
  }

  return [
    {
      id: message.messageId,
      timestamp: message.timestamp,
      ...message.payload,
    },
    ...rolls,
  ].slice(0, MAX_ROLLS)
}

function isStoredRoll(value: unknown): value is StoredRoll {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.actorName === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.formula === 'string' &&
    typeof candidate.total === 'number' &&
    Number.isFinite(candidate.total) &&
    (candidate.breakdown === undefined ||
      typeof candidate.breakdown === 'string')
  )
}
