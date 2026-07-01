import OBR, { type Player } from '@owlbear-rodeo/sdk'
import {
  type ForgeSteelCharacterSnapshotPayload,
  type ForgeSteelRollResultMessage,
  parseForgeSteelMessage,
} from './bridge'
import {
  createRollLogEntry,
  isTableLogEntry,
  type RollPlayer,
  type RollVisibility,
  type StoredDamageLogEntry,
  type StoredRollLogEntry,
  type TableLogEntry,
} from './logStorage'

const ROLL_CHANNEL = 'net.forgesteel.owlbear.rolls.v1'
const SHARED_ROLL_TYPE = 'FORGESTEEL_OWLBEAR_SHARED_ROLL'
const SHARED_LOG_TYPE = 'FORGESTEEL_OWLBEAR_SHARED_LOG'
const CHARACTER_CHANNEL = 'net.forgesteel.owlbear.characters.v1'
const CHARACTER_SNAPSHOT_UPDATED_TYPE =
  'FORGESTEEL_OWLBEAR_CHARACTER_SNAPSHOT_UPDATED'
const CHARACTER_SNAPSHOT_METADATA_KEY =
  'net.forgesteel.owlbear.characterSnapshot.v1'
const CURRENT_SHARED_SCHEMA_VERSION = 1

export type OwlbearStatus =
  | 'available'
  | 'unavailable'
  | 'ready'
  | 'error'

export type OwlbearAdapterState = {
  status: OwlbearStatus
  message: string
}

export type ActionPopoverSize = {
  label: string
  width: number
  height: number
}

export type SharedRollMessage = {
  type: typeof SHARED_ROLL_TYPE
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel-owlbear-extension'
  visibility: RollVisibility
  sender?: RollPlayer
  roll: ForgeSteelRollResultMessage
}

export type SharedLogMessage = {
  type: typeof SHARED_LOG_TYPE
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel-owlbear-extension'
  entry: TableLogEntry
}

export type SharedRollEvent = {
  message: ForgeSteelRollResultMessage
  visibility: RollVisibility
  player?: RollPlayer
}

export type SharedLogEvent = {
  entry: TableLogEntry
}

export type CharacterRosterEntry = {
  player: RollPlayer
  snapshot: ForgeSteelCharacterSnapshotPayload | null
}

export function isOwlbearAvailable(): boolean {
  return OBR.isAvailable
}

export async function initializeOwlbear(): Promise<OwlbearAdapterState> {
  if (!OBR.isAvailable) {
    return {
      status: 'unavailable',
      message: 'Open this extension inside Owlbear Rodeo to enable SDK events.',
    }
  }

  try {
    await waitForOwlbearReady()
    await OBR.notification.show('ForgeSteel extension ready', 'SUCCESS')

    return {
      status: 'ready',
      message: 'Connected to Owlbear Rodeo.',
    }
  } catch (error) {
    console.warn('Owlbear SDK initialization failed.', error)

    return {
      status: 'error',
      message: 'Owlbear SDK was detected but did not finish initializing.',
    }
  }
}

export async function getCurrentPlayerInfo(): Promise<RollPlayer | undefined> {
  if (!OBR.isAvailable) {
    return undefined
  }

  try {
    await waitForOwlbearReady()

    const [id, connectionId, name, color, role] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getConnectionId(),
      OBR.player.getName(),
      OBR.player.getColor(),
      OBR.player.getRole(),
    ])

    return {
      id,
      connectionId,
      name,
      color,
      role,
    }
  } catch (error) {
    console.warn('Unable to read Owlbear player info.', error)
    return undefined
  }
}

export async function setActionBadgeCount(count: number): Promise<void> {
  if (!OBR.isAvailable) {
    return
  }

  try {
    await waitForOwlbearReady()

    if (count <= 0) {
      await OBR.action.setBadgeText(undefined)
      return
    }

    await Promise.all([
      OBR.action.setBadgeBackgroundColor('#b64a39'),
      OBR.action.setBadgeText(count > 99 ? '99+' : count.toString()),
    ])
  } catch (error) {
    console.warn('Unable to update ForgeSteel action badge.', error)
  }
}

export async function showSharedLogNotification(
  entry: TableLogEntry,
): Promise<void> {
  if (!OBR.isAvailable) {
    return
  }

  try {
    await waitForOwlbearReady()

    const notificationId = await OBR.notification.show(
      formatSharedLogNotification(entry),
      'INFO',
    )

    window.setTimeout(() => {
      void OBR.notification.close(notificationId).catch((error) => {
        console.warn('Unable to close ForgeSteel log notification.', error)
      })
    }, 4200)
  } catch (error) {
    console.warn('Unable to show ForgeSteel log notification.', error)
  }
}

export async function publishCharacterSnapshot(
  snapshot: ForgeSteelCharacterSnapshotPayload | null,
): Promise<void> {
  if (!OBR.isAvailable) {
    return
  }

  try {
    await waitForOwlbearReady()
    await OBR.player.setMetadata({
      [CHARACTER_SNAPSHOT_METADATA_KEY]: snapshot,
    })
    await OBR.broadcast.sendMessage(
      CHARACTER_CHANNEL,
      {
        type: CHARACTER_SNAPSHOT_UPDATED_TYPE,
        schemaVersion: CURRENT_SHARED_SCHEMA_VERSION,
        messageId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'forgesteel-owlbear-extension',
      },
      { destination: 'ALL' },
    )
  } catch (error) {
    console.warn('Unable to publish ForgeSteel character snapshot.', error)
  }
}

export async function listenForCharacterRoster(
  onRoster: (entries: CharacterRosterEntry[]) => void,
): Promise<() => void> {
  if (!OBR.isAvailable) {
    return () => undefined
  }

  try {
    await waitForOwlbearReady()

    const refreshRoster = async () => {
      try {
        onRoster(createCharacterRoster(await OBR.party.getPlayers()))
      } catch (error) {
        console.warn('Unable to refresh ForgeSteel character roster.', error)
      }
    }

    await refreshRoster()

    const unsubscribeParty = OBR.party.onChange((players) => {
      onRoster(createCharacterRoster(players))
    })
    const unsubscribeBroadcast = OBR.broadcast.onMessage(
      CHARACTER_CHANNEL,
      (event) => {
        if (isCharacterSnapshotUpdatedMessage(event.data)) {
          void refreshRoster()
        }
      },
    )

    return () => {
      unsubscribeParty()
      unsubscribeBroadcast()
    }
  } catch (error) {
    console.warn('Unable to listen for ForgeSteel character roster.', error)
    return () => undefined
  }
}

export async function broadcastRoll(
  message: ForgeSteelRollResultMessage,
  visibility: RollVisibility = 'public',
): Promise<void> {
  if (!OBR.isAvailable || !OBR.isReady) {
    return
  }

  if (visibility === 'hidden') {
    return
  }

  try {
    await OBR.broadcast.sendMessage(ROLL_CHANNEL, {
      type: SHARED_ROLL_TYPE,
      schemaVersion: CURRENT_SHARED_SCHEMA_VERSION,
      messageId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'forgesteel-owlbear-extension',
      visibility,
      sender: await getCurrentPlayerInfo(),
      roll: message,
    } satisfies SharedRollMessage, {
      destination: 'ALL',
    })
  } catch (error) {
    console.warn('Unable to broadcast ForgeSteel roll.', error)
  }
}

export async function broadcastLogEntry(entry: TableLogEntry): Promise<void> {
  if (!OBR.isAvailable || !OBR.isReady) {
    return
  }

  if (entry.visibility === 'hidden') {
    return
  }

  try {
    await OBR.broadcast.sendMessage(
      ROLL_CHANNEL,
      {
        type: SHARED_LOG_TYPE,
        schemaVersion: CURRENT_SHARED_SCHEMA_VERSION,
        messageId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'forgesteel-owlbear-extension',
        entry,
      } satisfies SharedLogMessage,
      {
        destination: 'ALL',
      },
    )
  } catch (error) {
    console.warn('Unable to broadcast ForgeSteel table log entry.', error)
  }
}

export async function broadcastDamageLog(
  entry: StoredDamageLogEntry,
): Promise<void> {
  await broadcastLogEntry(entry)
}

export async function listenForSharedLogEvents(
  onLog: (event: SharedLogEvent) => void,
): Promise<() => void> {
  if (!OBR.isAvailable) {
    return () => undefined
  }

  try {
    await waitForOwlbearReady()

    return OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
      const sharedLogMessage = parseSharedLogMessage(event.data)
      if (sharedLogMessage) {
        onLog({ entry: sharedLogMessage.entry })
        return
      }

      const sharedRollMessage = parseSharedRollMessage(event.data)
      if (sharedRollMessage) {
        onLog({
          entry: createRollLogEntry(sharedRollMessage.roll, {
            visibility: sharedRollMessage.visibility,
            player:
              sharedRollMessage.sender ??
              fallbackPlayerFromConnection(event.connectionId),
            source:
              sharedRollMessage.roll.payload.context?.kind === 'manual'
                ? 'manual'
                : 'forgesteel',
          }),
        })
        return
      }

      const legacyMessage = parseForgeSteelMessage(event.data)
      if (legacyMessage?.type === 'FORGESTEEL_ROLL_RESULT') {
        onLog({
          entry: createRollLogEntry(legacyMessage, {
            visibility: 'public',
            player: fallbackPlayerFromConnection(event.connectionId),
            source:
              legacyMessage.payload.context?.kind === 'manual'
                ? 'manual'
                : 'forgesteel',
          }),
        })
      }
    })
  } catch (error) {
    console.warn('Unable to listen for shared ForgeSteel table log.', error)
    return () => undefined
  }
}

export async function listenForSharedRolls(
  onRoll: (event: SharedRollEvent) => void,
): Promise<() => void> {
  if (!OBR.isAvailable) {
    return () => undefined
  }

  try {
    await waitForOwlbearReady()

    return OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
      const sharedMessage = parseSharedRollMessage(event.data)
      if (sharedMessage) {
        onRoll({
          message: sharedMessage.roll,
          visibility: sharedMessage.visibility,
          player:
            sharedMessage.sender ??
            fallbackPlayerFromConnection(event.connectionId),
        })
        return
      }

      const legacyMessage = parseForgeSteelMessage(event.data)
      if (legacyMessage?.type === 'FORGESTEEL_ROLL_RESULT') {
        onRoll({
          message: legacyMessage,
          visibility: 'public',
          player: fallbackPlayerFromConnection(event.connectionId),
        })
      }
    })
  } catch (error) {
    console.warn('Unable to listen for shared ForgeSteel rolls.', error)
    return () => undefined
  }
}

export async function resizeActionPopover({
  label,
  width,
  height,
}: ActionPopoverSize): Promise<OwlbearAdapterState> {
  if (!OBR.isAvailable) {
    return {
      status: 'unavailable',
      message: 'Resize controls are available inside Owlbear Rodeo.',
    }
  }

  try {
    await waitForOwlbearReady()
    await Promise.all([OBR.action.setWidth(width), OBR.action.setHeight(height)])

    return {
      status: 'ready',
      message: `Panel size set to ${label}.`,
    }
  } catch (error) {
    console.warn('Unable to resize Owlbear action popover.', error)

    return {
      status: 'error',
      message: 'Owlbear did not accept the panel resize request.',
    }
  }
}

function parseSharedLogMessage(data: unknown): SharedLogMessage | null {
  if (!isRecord(data)) {
    return null
  }

  if (
    data.type !== SHARED_LOG_TYPE ||
    data.schemaVersion !== CURRENT_SHARED_SCHEMA_VERSION ||
    data.source !== 'forgesteel-owlbear-extension' ||
    typeof data.messageId !== 'string' ||
    typeof data.timestamp !== 'string' ||
    !isTableLogEntry(data.entry)
  ) {
    return null
  }

  return {
    type: data.type,
    schemaVersion: data.schemaVersion,
    messageId: data.messageId,
    timestamp: data.timestamp,
    source: data.source,
    entry: data.entry,
  }
}

function parseSharedRollMessage(data: unknown): SharedRollMessage | null {
  if (!isRecord(data)) {
    return null
  }

  if (
    data.type !== SHARED_ROLL_TYPE ||
    data.schemaVersion !== CURRENT_SHARED_SCHEMA_VERSION ||
    data.source !== 'forgesteel-owlbear-extension' ||
    typeof data.messageId !== 'string' ||
    typeof data.timestamp !== 'string' ||
    (data.visibility !== 'public' && data.visibility !== 'hidden') ||
    (data.sender !== undefined && !isRollPlayer(data.sender))
  ) {
    return null
  }

  const roll = parseForgeSteelMessage(data.roll)
  if (roll?.type !== 'FORGESTEEL_ROLL_RESULT') {
    return null
  }

  return {
    type: data.type,
    schemaVersion: data.schemaVersion,
    messageId: data.messageId,
    timestamp: data.timestamp,
    source: data.source,
    visibility: data.visibility,
    sender: data.sender,
    roll,
  }
}

function fallbackPlayerFromConnection(connectionId: string): RollPlayer {
  return {
    connectionId,
    name: 'Player',
  }
}

function formatSharedLogNotification(entry: TableLogEntry): string {
  if (entry.kind === 'damage') {
    return formatSharedDamageNotification(entry)
  }

  return formatSharedRollNotification(entry)
}

function formatSharedRollNotification(entry: StoredRollLogEntry): string {
  const playerName = entry.player?.name || 'A player'
  const naturalTotal =
    entry.naturalTotal === undefined ? '-' : entry.naturalTotal.toString()
  const tier = entry.tier === undefined ? '-' : entry.tier.toString()

  return `${playerName} rolled for ${entry.actorName}: NAT ${naturalTotal}, TOTAL ${entry.total}, TIER ${tier}`
}

function formatSharedDamageNotification(entry: StoredDamageLogEntry): string {
  const playerName = entry.player?.name || 'Director'
  const targetCount = entry.targets.length
  const totalDamage = entry.targets.reduce(
    (sum, target) => sum + target.finalDamage,
    0,
  )
  const targetLabel = targetCount === 1 ? 'target' : 'targets'

  return `${playerName} used ${entry.title}: ${targetCount} ${targetLabel}, ${totalDamage} total ${entry.damageType}`
}

function createCharacterRoster(players: Player[]): CharacterRosterEntry[] {
  return players.map((player) => ({
    player: {
      id: player.id,
      connectionId: player.connectionId,
      name: player.name,
      color: player.color,
      role: player.role,
    },
    snapshot: parseCharacterSnapshotMetadata(player.metadata),
  }))
}

function parseCharacterSnapshotMetadata(
  metadata: Record<string, unknown>,
): ForgeSteelCharacterSnapshotPayload | null {
  const snapshot = metadata[CHARACTER_SNAPSHOT_METADATA_KEY]

  if (snapshot === null || snapshot === undefined) {
    return null
  }

  return isCharacterSnapshotPayload(snapshot) ? snapshot : null
}

function isCharacterSnapshotUpdatedMessage(data: unknown): boolean {
  return (
    isRecord(data) &&
    data.type === CHARACTER_SNAPSHOT_UPDATED_TYPE &&
    data.schemaVersion === CURRENT_SHARED_SCHEMA_VERSION &&
    data.source === 'forgesteel-owlbear-extension' &&
    typeof data.messageId === 'string' &&
    typeof data.timestamp === 'string'
  )
}

function isCharacterSnapshotPayload(
  value: unknown,
): value is ForgeSteelCharacterSnapshotPayload {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.characterId === 'string' &&
    typeof value.characterName === 'string' &&
    optionalString(value.description) &&
    optionalNumber(value.level) &&
    optionalString(value.ancestryName) &&
    optionalString(value.className) &&
    optionalString(value.subclassName) &&
    isOptionalNumberRecord(value.stamina, [
      'current',
      'max',
      'temp',
      'windedAt',
      'deadAt',
    ]) &&
    isOptionalNumberRecord(value.recoveries, ['current', 'max', 'value']) &&
    isOptionalNumberRecord(value.characteristics, [
      'might',
      'agility',
      'reason',
      'intuition',
      'presence',
    ]) &&
    isMovementPayload(value.movement) &&
    isOptionalNumberRecord(value.potencies, ['weak', 'average', 'strong']) &&
    isOptionalNumberRecord(value.save, ['target', 'bonus']) &&
    isDamageAdjustmentArray(value.immunities) &&
    isDamageAdjustmentArray(value.weaknesses) &&
    isStringArray(value.conditionImmunities) &&
    isConditionArray(value.conditions) &&
    typeof value.updatedAt === 'string'
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
    (value.role === undefined || value.role === 'GM' || value.role === 'PLAYER')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalNumberRecord(
  value: unknown,
  allowedKeys: string[],
): boolean {
  if (!isRecord(value)) {
    return false
  }

  return Object.entries(value).every(
    ([key, item]) => allowedKeys.includes(key) && optionalNumber(item),
  )
}

function isMovementPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return (
    optionalString(value.size) &&
    optionalString(value.speed) &&
    optionalNumber(value.stability) &&
    optionalNumber(value.disengage)
  )
}

function isDamageAdjustmentArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.damageType === 'string' &&
        typeof item.value === 'number' &&
        Number.isFinite(item.value),
    )
  )
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isConditionArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.type === 'string' &&
        typeof item.text === 'string' &&
        typeof item.ends === 'string',
    )
  )
}

function waitForOwlbearReady(): Promise<void> {
  if (OBR.isReady) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    OBR.onReady(resolve)
  })
}
