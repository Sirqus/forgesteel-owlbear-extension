import type {
  ForgeSteelRollPayload,
  ForgeSteelRollResultMessage,
} from './bridge'

const LOG_STORAGE_KEY = 'net.forgesteel.owlbear.log.v1'
const LEGACY_ROLL_STORAGE_KEY = 'net.forgesteel.owlbear.rolls.v1'
const MAX_LOG_ENTRIES = 120

export type RollVisibility = 'public' | 'hidden'
export type RollSource = 'forgesteel' | 'manual'
export type LogSource = RollSource | 'director'

export type RollPlayer = {
  id?: string
  connectionId?: string
  name: string
  color?: string
  role?: 'GM' | 'PLAYER'
}

export type DamageAdjustment = {
  damageType: string
  value: number
}

export type DamageLogTarget = {
  characterId: string
  characterName: string
  playerName?: string
  playerColor?: string
  baseDamage: number
  adjustment: number
  finalDamage: number
  immunities: DamageAdjustment[]
  weaknesses: DamageAdjustment[]
}

export type StoredRollLogEntry = ForgeSteelRollPayload & {
  kind: 'roll'
  id: string
  timestamp: string
  source: RollSource
  visibility: RollVisibility
  player?: RollPlayer
}

export type StoredDamageLogEntry = {
  kind: 'damage'
  id: string
  timestamp: string
  source: 'director'
  visibility: RollVisibility
  player?: RollPlayer
  title: string
  damageType: string
  baseDamage: number
  formula: string
  total: number
  naturalTotal: number
  tier: 1 | 2 | 3
  baseTier: 1 | 2 | 3
  rollState: string
  breakdown: string
  targets: DamageLogTarget[]
}

export type TableLogEntry = StoredRollLogEntry | StoredDamageLogEntry

export type AppendRollOptions = {
  source?: RollSource
  visibility?: RollVisibility
  player?: RollPlayer | undefined
}

export function loadStoredLogEntries(): TableLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY)

    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter(isTableLogEntry).map(normalizeTableLogEntry)
      }
    }

    return loadLegacyRollEntries()
  } catch (error) {
    console.warn('Unable to load ForgeSteel table log.', error)
    return []
  }
}

export function saveStoredLogEntries(entries: TableLogEntry[]): void {
  try {
    window.localStorage.setItem(
      LOG_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_LOG_ENTRIES)),
    )
  } catch (error) {
    console.warn('Unable to persist ForgeSteel table log.', error)
  }
}

export function clearStoredLogEntries(): void {
  try {
    window.localStorage.removeItem(LOG_STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_ROLL_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to clear ForgeSteel table log.', error)
  }
}

export function appendLogEntry(
  entries: TableLogEntry[],
  entry: TableLogEntry,
): TableLogEntry[] {
  if (entries.some((item) => item.id === entry.id)) {
    return entries
  }

  return [entry, ...entries].slice(0, MAX_LOG_ENTRIES)
}

export function createRollLogEntry(
  message: ForgeSteelRollResultMessage,
  options: AppendRollOptions = {},
): StoredRollLogEntry {
  return {
    kind: 'roll',
    id: message.messageId,
    timestamp: message.timestamp,
    source: options.source ?? 'forgesteel',
    visibility: options.visibility ?? 'public',
    player: options.player,
    ...message.payload,
  }
}

function loadLegacyRollEntries(): TableLogEntry[] {
  const raw = window.localStorage.getItem(LEGACY_ROLL_STORAGE_KEY)

  if (!raw) {
    return []
  }

  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.filter(isLegacyStoredRoll).map((roll) =>
    normalizeTableLogEntry({
      kind: 'roll',
      ...roll,
    }),
  )
}

function normalizeTableLogEntry(entry: TableLogEntry): TableLogEntry {
  if (entry.kind === 'damage') {
    return entry
  }

  return {
    ...entry,
    source: entry.source ?? 'forgesteel',
    visibility: entry.visibility ?? 'public',
  }
}

export function isTableLogEntry(value: unknown): value is TableLogEntry {
  if (!isRecord(value)) {
    return false
  }

  if (value.kind === 'roll') {
    return isStoredRollLogEntry(value)
  }

  if (value.kind === 'damage') {
    return isStoredDamageLogEntry(value)
  }

  return false
}

function isStoredRollLogEntry(value: Record<string, unknown>): value is StoredRollLogEntry {
  return (
    value.kind === 'roll' &&
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.actorName === 'string' &&
    typeof value.label === 'string' &&
    typeof value.formula === 'string' &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total) &&
    (value.source === undefined ||
      value.source === 'forgesteel' ||
      value.source === 'manual') &&
    (value.visibility === undefined ||
      value.visibility === 'public' ||
      value.visibility === 'hidden') &&
    (value.player === undefined || isRollPlayer(value.player)) &&
    (value.breakdown === undefined || typeof value.breakdown === 'string')
  )
}

function isLegacyStoredRoll(value: unknown): value is Omit<StoredRollLogEntry, 'kind'> {
  if (!isRecord(value)) {
    return false
  }

  return isStoredRollLogEntry({
    ...value,
    kind: 'roll',
  })
}

function isStoredDamageLogEntry(
  value: Record<string, unknown>,
): value is StoredDamageLogEntry {
  return (
    value.kind === 'damage' &&
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    value.source === 'director' &&
    (value.visibility === 'public' || value.visibility === 'hidden') &&
    (value.player === undefined || isRollPlayer(value.player)) &&
    typeof value.title === 'string' &&
    typeof value.damageType === 'string' &&
    typeof value.baseDamage === 'number' &&
    Number.isFinite(value.baseDamage) &&
    typeof value.formula === 'string' &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total) &&
    typeof value.naturalTotal === 'number' &&
    Number.isFinite(value.naturalTotal) &&
    (value.tier === 1 || value.tier === 2 || value.tier === 3) &&
    (value.baseTier === 1 || value.baseTier === 2 || value.baseTier === 3) &&
    typeof value.rollState === 'string' &&
    typeof value.breakdown === 'string' &&
    Array.isArray(value.targets) &&
    value.targets.every(isDamageLogTarget)
  )
}

function isDamageLogTarget(value: unknown): value is DamageLogTarget {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.characterId === 'string' &&
    typeof value.characterName === 'string' &&
    (value.playerName === undefined || typeof value.playerName === 'string') &&
    (value.playerColor === undefined || typeof value.playerColor === 'string') &&
    typeof value.baseDamage === 'number' &&
    Number.isFinite(value.baseDamage) &&
    typeof value.adjustment === 'number' &&
    Number.isFinite(value.adjustment) &&
    typeof value.finalDamage === 'number' &&
    Number.isFinite(value.finalDamage) &&
    Array.isArray(value.immunities) &&
    value.immunities.every(isDamageAdjustment) &&
    Array.isArray(value.weaknesses) &&
    value.weaknesses.every(isDamageAdjustment)
  )
}

function isDamageAdjustment(value: unknown): value is DamageAdjustment {
  return (
    isRecord(value) &&
    typeof value.damageType === 'string' &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value)
  )
}

function isRollPlayer(value: unknown): value is RollPlayer {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.name === 'string' &&
    (value.id === undefined || typeof value.id === 'string') &&
    (value.connectionId === undefined ||
      typeof value.connectionId === 'string') &&
    (value.color === undefined || typeof value.color === 'string') &&
    (value.role === undefined ||
      value.role === 'GM' ||
      value.role === 'PLAYER')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
