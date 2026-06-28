import OBR from '@owlbear-rodeo/sdk'
import {
  type ForgeSteelRollResultMessage,
  parseForgeSteelMessage,
} from './bridge'
import type { RollPlayer, RollVisibility } from './rollStorage'

const ROLL_CHANNEL = 'net.forgesteel.owlbear.rolls.v1'
const SHARED_ROLL_TYPE = 'FORGESTEEL_OWLBEAR_SHARED_ROLL'
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

export type SharedRollEvent = {
  message: ForgeSteelRollResultMessage
  visibility: RollVisibility
  player?: RollPlayer
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
  if (!OBR.isAvailable || !OBR.isReady) {
    return undefined
  }

  try {
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

function waitForOwlbearReady(): Promise<void> {
  if (OBR.isReady) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    OBR.onReady(resolve)
  })
}
