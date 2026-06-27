import type {
  ForgeSteelRollPayload,
  ForgeSteelRollResultMessage,
} from './bridge'

const STORAGE_KEY = 'net.forgesteel.owlbear.rolls.v1'
const MAX_ROLLS = 100

export type RollVisibility = 'public' | 'hidden'
export type RollSource = 'forgesteel' | 'manual'

export type RollPlayer = {
  id?: string
  connectionId?: string
  name: string
  color?: string
  role?: 'GM' | 'PLAYER'
}

export type StoredRoll = ForgeSteelRollPayload & {
  id: string
  timestamp: string
  source: RollSource
  visibility: RollVisibility
  player?: RollPlayer
}

export type AppendRollOptions = {
  source?: RollSource
  visibility?: RollVisibility
  player?: RollPlayer | undefined
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

    return parsed.filter(isStoredRoll).map(normalizeStoredRoll)
  } catch (error) {
    console.warn('Unable to load ForgeSteel roll history.', error)
    return []
  }
}

function normalizeStoredRoll(roll: StoredRoll): StoredRoll {
  return {
    ...roll,
    source: roll.source ?? 'forgesteel',
    visibility: roll.visibility ?? 'public',
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
  options: AppendRollOptions = {},
): StoredRoll[] {
  if (rolls.some((roll) => roll.id === message.messageId)) {
    return rolls
  }

  return [
    {
      id: message.messageId,
      timestamp: message.timestamp,
      source: options.source ?? 'forgesteel',
      visibility: options.visibility ?? 'public',
      player: options.player,
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
    (candidate.source === undefined ||
      candidate.source === 'forgesteel' ||
      candidate.source === 'manual') &&
    (candidate.visibility === undefined ||
      candidate.visibility === 'public' ||
      candidate.visibility === 'hidden') &&
    (candidate.player === undefined || isRollPlayer(candidate.player)) &&
    (candidate.breakdown === undefined ||
      typeof candidate.breakdown === 'string')
  )
}

function isRollPlayer(value: unknown): value is RollPlayer {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.name === 'string' &&
    (candidate.id === undefined || typeof candidate.id === 'string') &&
    (candidate.connectionId === undefined ||
      typeof candidate.connectionId === 'string') &&
    (candidate.color === undefined || typeof candidate.color === 'string') &&
    (candidate.role === undefined ||
      candidate.role === 'GM' ||
      candidate.role === 'PLAYER')
  )
}
