export const FORGESTEEL_ORIGIN = 'https://forgesteel.net'
export const CURRENT_SCHEMA_VERSION = 1

export type ForgeSteelMessageType =
  | 'FORGESTEEL_READY'
  | 'FORGESTEEL_ROLL_RESULT'

export type ForgeSteelRollPayload = {
  actorName: string
  label: string
  formula: string
  total: number
  naturalTotal?: number
  tier?: 1 | 2 | 3
  baseTier?: 1 | 2 | 3
  rollState?: string
  breakdown?: string
  context?: ForgeSteelRollContext
}

export type ForgeSteelRollContext = {
  kind?: 'ability' | 'characteristic' | 'savingThrow' | 'manual'
  details?: {
    name?: string
    description?: string
    type?: string
    cost?: string
    distance?: string
    target?: string
    trigger?: string
    keywords?: string[]
    sections?: Array<{
      label: string
      text: string
    }>
    tiers?: Array<{
      tier: 1 | 2 | 3
      text: string
    }>
  }
}

export type ForgeSteelBaseMessage = {
  type: ForgeSteelMessageType
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel'
}

export type ForgeSteelReadyMessage = ForgeSteelBaseMessage & {
  type: 'FORGESTEEL_READY'
}

export type ForgeSteelRollResultMessage = ForgeSteelBaseMessage & {
  type: 'FORGESTEEL_ROLL_RESULT'
  payload: ForgeSteelRollPayload
}

export type ForgeSteelBridgeMessage =
  | ForgeSteelReadyMessage
  | ForgeSteelRollResultMessage

export type OwlbearDefaultOptionsPayload = {
  shownStandardAbilities: 'all' | string[]
  compactView: boolean
  abilityWidth: 'Narrow' | 'Medium' | 'Wide' | 'Extra Wide'
  themeMode: 'light' | 'dark' | 'system'
}

export type OwlbearApplyDefaultOptionsMessage = {
  type: 'OWLBEAR_APPLY_DEFAULT_OPTIONS'
  schemaVersion: 1
  messageId: string
  timestamp: string
  source: 'forgesteel-owlbear-extension'
  payload: OwlbearDefaultOptionsPayload
}

export type BridgeEvent =
  | {
      kind: 'ready'
      message: ForgeSteelReadyMessage
      origin: string
    }
  | {
      kind: 'roll'
      message: ForgeSteelRollResultMessage
      origin: string
    }

export type BridgeRejectReason =
  | 'origin'
  | 'shape'
  | 'schema'
  | 'duplicate'

export type BridgeRejectEvent = {
  reason: BridgeRejectReason
  origin: string
  data: unknown
}

type BridgeOptions = {
  onEvent: (event: BridgeEvent) => void
  onReject?: (event: BridgeRejectEvent) => void
  allowedOrigins?: string[]
  allowLocalDevOrigin?: boolean
}

export function listenForForgeSteelMessages({
  onEvent,
  onReject,
  allowedOrigins = [FORGESTEEL_ORIGIN],
  allowLocalDevOrigin = import.meta.env.DEV,
}: BridgeOptions): () => void {
  const seenMessageIds = new Set<string>()

  const handleMessage = (event: MessageEvent<unknown>) => {
    const originAllowed =
      allowedOrigins.includes(event.origin) ||
      (allowLocalDevOrigin && event.origin === window.location.origin)

    if (!originAllowed) {
      onReject?.({ reason: 'origin', origin: event.origin, data: event.data })
      return
    }

    const message = parseForgeSteelMessage(event.data)

    if (!message) {
      onReject?.({ reason: 'shape', origin: event.origin, data: event.data })
      return
    }

    if (message.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      onReject?.({ reason: 'schema', origin: event.origin, data: event.data })
      return
    }

    if (seenMessageIds.has(message.messageId)) {
      onReject?.({ reason: 'duplicate', origin: event.origin, data: event.data })
      return
    }

    seenMessageIds.add(message.messageId)

    if (message.type === 'FORGESTEEL_READY') {
      onEvent({ kind: 'ready', message, origin: event.origin })
      return
    }

    onEvent({ kind: 'roll', message, origin: event.origin })
  }

  window.addEventListener('message', handleMessage)

  return () => {
    window.removeEventListener('message', handleMessage)
  }
}

export function postDefaultOptionsToForgeSteel(
  iframe: HTMLIFrameElement | null,
  targetOrigin: string,
): boolean {
  if (!iframe?.contentWindow) {
    return false
  }

  iframe.contentWindow.postMessage(
    createDefaultOptionsMessage(),
    targetOrigin,
  )
  return true
}

function createDefaultOptionsMessage(): OwlbearApplyDefaultOptionsMessage {
  return {
    type: 'OWLBEAR_APPLY_DEFAULT_OPTIONS',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'forgesteel-owlbear-extension',
    payload: {
      shownStandardAbilities: 'all',
      compactView: false,
      abilityWidth: 'Narrow',
      themeMode: 'dark',
    },
  }
}

export function parseForgeSteelMessage(
  data: unknown,
): ForgeSteelBridgeMessage | null {
  if (!isRecord(data)) {
    return null
  }

  if (
    data.source !== 'forgesteel' ||
    typeof data.messageId !== 'string' ||
    typeof data.timestamp !== 'string' ||
    data.schemaVersion !== CURRENT_SCHEMA_VERSION
  ) {
    return null
  }

  if (data.type === 'FORGESTEEL_READY') {
    return data as ForgeSteelReadyMessage
  }

  if (data.type !== 'FORGESTEEL_ROLL_RESULT') {
    return null
  }

  if (!isRollPayload(data.payload)) {
    return null
  }

  return data as ForgeSteelRollResultMessage
}

function isRollPayload(payload: unknown): payload is ForgeSteelRollPayload {
  if (!isRecord(payload)) {
    return false
  }

  return (
    typeof payload.actorName === 'string' &&
    typeof payload.label === 'string' &&
    typeof payload.formula === 'string' &&
    typeof payload.total === 'number' &&
    Number.isFinite(payload.total) &&
    optionalFiniteNumber(payload.naturalTotal) &&
    optionalTier(payload.tier) &&
    optionalTier(payload.baseTier) &&
    optionalString(payload.rollState) &&
    (payload.breakdown === undefined || typeof payload.breakdown === 'string') &&
    (payload.context === undefined || isRollContext(payload.context))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRollContext(value: unknown): value is ForgeSteelRollContext {
  if (!isRecord(value)) {
    return false
  }

  if (
    value.kind !== undefined &&
    value.kind !== 'ability' &&
    value.kind !== 'characteristic' &&
    value.kind !== 'savingThrow' &&
    value.kind !== 'manual'
  ) {
    return false
  }

  if (value.details === undefined) {
    return true
  }

  if (!isRecord(value.details)) {
    return false
  }

  const details = value.details

  return (
    optionalString(details.name) &&
    optionalString(details.description) &&
    optionalString(details.type) &&
    optionalString(details.cost) &&
    optionalString(details.distance) &&
    optionalString(details.target) &&
    optionalString(details.trigger) &&
    optionalStringArray(details.keywords) &&
    optionalLabelTextArray(details.sections) &&
    optionalTierArray(details.tiers)
  )
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function optionalTier(value: unknown): boolean {
  return value === undefined || value === 1 || value === 2 || value === 3
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}

function optionalLabelTextArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          typeof item.label === 'string' &&
          typeof item.text === 'string',
      ))
  )
}

function optionalTierArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          (item.tier === 1 || item.tier === 2 || item.tier === 3) &&
          typeof item.text === 'string',
      ))
  )
}
