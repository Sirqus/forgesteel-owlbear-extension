import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  type BridgeRejectEvent,
  type ForgeSteelCharacterSnapshotPayload,
  type ForgeSteelRollResultMessage,
  listenForForgeSteelMessages,
  postDefaultOptionsToForgeSteel,
} from './lib/bridge'
import {
  UNREAD_LOG_IDS_CHANGED_EVENT,
  addUnreadLogId,
  clearUnreadLogIds,
  loadUnreadLogIds,
  setLogViewActive,
} from './lib/logAttention'
import {
  appendLogEntry,
  clearStoredLogEntries,
  createRollLogEntry,
  loadStoredLogEntries,
  saveStoredLogEntries,
  type DamageLogTarget,
  type RollPlayer,
  type RollSource,
  type RollVisibility,
  type StoredDamageLogEntry,
  type StoredRollLogEntry,
  type TableLogEntry,
} from './lib/logStorage'
import {
  broadcastDamageLog,
  broadcastLogEntry,
  broadcastRoll,
  getCurrentPlayerInfo,
  initializeOwlbear,
  isOwlbearAvailable,
  listenForCharacterRoster,
  listenForSharedLogEvents,
  publishCharacterSnapshot,
  resizeActionPopover,
  setActionBadgeCount,
  type CharacterRosterEntry,
  type OwlbearAdapterState,
} from './lib/owlbear'
import { isSameRollPlayer } from './lib/playerIdentity'

const DEFAULT_FORGESTEEL_URL = import.meta.env.DEV
  ? 'http://localhost:5174'
  : 'https://sirqus.github.io/forgesteel-owlbear-bridge/'
const FORGESTEEL_BASE_URL =
  import.meta.env.VITE_FORGESTEEL_URL || DEFAULT_FORGESTEEL_URL
const FORGESTEEL_ORIGIN = new URL(FORGESTEEL_BASE_URL).origin
const FORGESTEEL_URL = createForgeSteelUrl()
const PANEL_SIZE_STORAGE_KEY = 'net.forgesteel.owlbear.panelSize.v1'
const EXTENSION_THEME_STORAGE_KEY = 'net.forgesteel.owlbear.theme.v1'
const DEFAULT_PANEL_SIZE: PanelSize = {
  label: 'Default',
  width: 450,
  height: 520,
}
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 1280
const MIN_PANEL_HEIGHT = 360
const MAX_PANEL_HEIGHT = 1180
const MIN_MANUAL_MODIFIER = -99
const MAX_MANUAL_MODIFIER = 99
const MIN_DAMAGE_VALUE = 0
const MAX_DAMAGE_VALUE = 999

type ActiveTab = 'forgesteel' | 'log' | 'roller' | 'director'
type DirectorView = 'overview' | 'attack'
type ExtensionTheme = 'dark' | 'light'
type ManualDice = 'd10' | '2d10'
type ManualRollState =
  | 'doubleBane'
  | 'bane'
  | 'standard'
  | 'edge'
  | 'doubleEdge'

type PanelSize = {
  label: string
  width: number
  height: number
}

type BridgeStatus = {
  state: 'waiting' | 'ready' | 'received' | 'rejected'
  message: string
}

type DamageType =
  | 'Damage'
  | 'Acid'
  | 'Cold'
  | 'Corruption'
  | 'Fire'
  | 'Holy'
  | 'Lightning'
  | 'Poison'
  | 'Psychic'
  | 'Sonic'

type DamageByTier = Record<1 | 2 | 3, number>

type PowerRollResult = {
  rolls: number[]
  naturalTotal: number
  total: number
  baseTier: 1 | 2 | 3
  tier: 1 | 2 | 3
  stateBonus: number
  formula: string
  rollStateLabel: string
  breakdown: string
}

const MANUAL_ROLL_STATES: Array<{
  value: ManualRollState
  label: string
}> = [
  { value: 'doubleBane', label: 'Double Bane' },
  { value: 'bane', label: 'Bane' },
  { value: 'standard', label: 'Standard' },
  { value: 'edge', label: 'Edge' },
  { value: 'doubleEdge', label: 'Double Edge' },
]

const DAMAGE_TYPES: DamageType[] = [
  'Damage',
  'Acid',
  'Cold',
  'Corruption',
  'Fire',
  'Holy',
  'Lightning',
  'Poison',
  'Psychic',
  'Sonic',
]

function RollScoreBox({
  label,
  value,
  tone = 'neutral',
  note,
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'total' | 'tier'
  note?: string
}) {
  return (
    <span
      className={`roll-score-box roll-score-${tone} ${
        note ? 'roll-score-shifted' : ''
      }`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </span>
  )
}

function DirectorStat({
  label,
  value,
  note,
}: {
  label: string
  value: string | number
  note?: string
}) {
  return (
    <span className="director-stat">
      <small>{label}</small>
      <strong>{value}</strong>
      {note && <em>{note}</em>}
    </span>
  )
}

function DirectorTagSection({
  label,
  emptyLabel,
  tags,
}: {
  label: string
  emptyLabel: string
  tags: string[]
}) {
  return (
    <div className="director-tag-section">
      <strong>{label}</strong>
      {tags.length > 0 ? (
        <div className="director-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : (
        <span className="director-muted">{emptyLabel}</span>
      )}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('forgesteel')
  const [directorView, setDirectorView] = useState<DirectorView>('overview')
  const [extensionTheme, setExtensionTheme] =
    useState<ExtensionTheme>(loadExtensionTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logEntries, setLogEntries] = useState<TableLogEntry[]>(() =>
    loadStoredLogEntries(),
  )
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    state: 'waiting',
    message: 'Waiting for ForgeSteel bridge events.',
  })
  const [owlbearStatus, setOwlbearStatus] = useState<OwlbearAdapterState>(() =>
    isOwlbearAvailable()
      ? {
          status: 'available',
          message: 'Connecting to Owlbear Rodeo.',
        }
      : {
          status: 'unavailable',
          message: 'Open this extension inside Owlbear Rodeo to enable SDK events.',
        },
  )
  const [panelSize, setPanelSize] = useState<PanelSize>(loadPanelSize)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [localPlayer, setLocalPlayer] = useState<RollPlayer>()
  const [characterRoster, setCharacterRoster] = useState<
    CharacterRosterEntry[]
  >([])
  const [manualDice, setManualDice] = useState<ManualDice>('2d10')
  const [manualModifier, setManualModifier] = useState(0)
  const [manualRollState, setManualRollState] =
    useState<ManualRollState>('standard')
  const [manualHidden, setManualHidden] = useState(false)
  const [attackModifier, setAttackModifier] = useState(0)
  const [attackRollState, setAttackRollState] =
    useState<ManualRollState>('standard')
  const [attackDamageType, setAttackDamageType] =
    useState<DamageType>('Damage')
  const [attackDamageByTier, setAttackDamageByTier] =
    useState<DamageByTier>({ 1: 3, 2: 6, 3: 9 })
  const [attackHidden, setAttackHidden] = useState(false)
  const [selectedAttackTargetIds, setSelectedAttackTargetIds] = useState<
    Set<string>
  >(() => new Set())
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [unseenLogIds, setUnseenLogIds] = useState<Set<string>>(
    loadUnreadLogIds,
  )
  const [flashingLogIds, setFlashingLogIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(
    () => new Set(),
  )
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const localPlayerRef = useRef<RollPlayer | undefined>(undefined)
  const activeTabRef = useRef<ActiveTab>('forgesteel')
  const flashTimeoutsRef = useRef<number[]>([])
  const logIdsRef = useRef<Set<string>>(
    new Set(logEntries.map((entry) => entry.id)),
  )
  const lastCharacterSnapshotRef = useRef<string>('')
  const isStandaloneBrowser = owlbearStatus.status === 'unavailable'
  const isDirector = localPlayer?.role === 'GM'
  const attackTargets = useMemo(
    () => characterRoster.filter((entry) => entry.snapshot),
    [characterRoster],
  )
  const visibleTabs: Array<{ id: ActiveTab; label: string }> = isDirector
    ? [
        { id: 'director', label: 'Director' },
        { id: 'log', label: 'Log' },
        { id: 'roller', label: 'Roller' },
        { id: 'forgesteel', label: 'ForgeSteel' },
      ]
    : [
        { id: 'forgesteel', label: 'ForgeSteel' },
        { id: 'log', label: 'Log' },
        { id: 'roller', label: 'Roller' },
      ]

  function recordLogEntry(entry: TableLogEntry): boolean {
    if (logIdsRef.current.has(entry.id)) {
      return false
    }

    logIdsRef.current.add(entry.id)
    markLogFresh(entry.id)

    setLogEntries((currentEntries) => {
      const nextEntries = appendLogEntry(currentEntries, entry)
      logIdsRef.current = new Set(nextEntries.map((item) => item.id))
      saveStoredLogEntries(nextEntries)
      return nextEntries
    })

    return true
  }

  function recordRoll(
    message: ForgeSteelRollResultMessage,
    options: {
      source?: RollSource
      visibility?: RollVisibility
      player?: RollPlayer | undefined
    } = {},
  ) {
    recordLogEntry(createRollLogEntry(message, options))
  }

  useEffect(() => {
    saveExtensionTheme(extensionTheme)
  }, [extensionTheme])

  useEffect(() => {
    let active = true

    initializeOwlbear().then((status) => {
      if (active) {
        setOwlbearStatus(status)
      }

      if (status.status === 'ready') {
        void getCurrentPlayerInfo().then((player) => {
          if (active) {
            localPlayerRef.current = player
            setLocalPlayer(player)
          }
        })
      }

      const storedSize = loadPanelSize()
      if (
        active &&
        status.status === 'ready' &&
        (storedSize.width !== DEFAULT_PANEL_SIZE.width ||
          storedSize.height !== DEFAULT_PANEL_SIZE.height)
      ) {
        void resizeActionPopover(storedSize).then((resizeStatus) => {
          if (active) {
            setOwlbearStatus(resizeStatus)
          }
        })
      }
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isStandaloneBrowser) {
      return
    }

    activeTabRef.current = 'forgesteel'
    setActiveTab('forgesteel')
    setSettingsOpen(false)
  }, [isStandaloneBrowser])

  useEffect(() => {
    return listenForForgeSteelMessages({
      allowedOrigins: [FORGESTEEL_ORIGIN],
      onEvent: (event) => {
        if (event.kind === 'ready') {
          setBridgeStatus({
            state: 'ready',
            message: `ForgeSteel bridge ready from ${event.origin}.`,
          })
          queueForgeSteelDefaultOptions()
          return
        }

        if (event.kind === 'character') {
          const signature = JSON.stringify(event.message.payload)

          if (signature !== lastCharacterSnapshotRef.current) {
            lastCharacterSnapshotRef.current = signature
            void publishCharacterSnapshot(event.message.payload)
          }

          setBridgeStatus({
            state: 'received',
            message: event.message.payload
              ? `Hero snapshot received for ${event.message.payload.characterName}.`
              : 'No active ForgeSteel hero is open.',
          })
          return
        }

        recordRoll(event.message, {
          source: 'forgesteel',
          visibility: 'public',
          player: localPlayerRef.current,
        })
        setBridgeStatus({
          state: 'received',
          message: `Roll received from ${event.message.payload.actorName}.`,
        })
        void broadcastRoll(event.message, 'public')
      },
      onReject: (event) => {
        setBridgeStatus({
          state: 'rejected',
          message: rejectMessage(event),
        })
      },
    })
  }, [])

  useEffect(() => {
    let active = true
    let unsubscribe: () => void = () => undefined

    void listenForSharedLogEvents((event) => {
      if (!active) {
        return
      }

      recordLogEntry(event.entry)

      setBridgeStatus({
        state: 'received',
        message:
          event.entry.kind === 'damage'
            ? `Shared damage event received from ${
                event.entry.player?.name || 'Director'
              }.`
            : `Shared roll received from ${
                event.entry.player?.name || event.entry.actorName
              }.`,
      })
    }).then((listener) => {
      unsubscribe = listener
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const syncUnreadLogIds = () => {
      setUnseenLogIds(loadUnreadLogIds())
    }

    window.addEventListener('storage', syncUnreadLogIds)
    window.addEventListener(UNREAD_LOG_IDS_CHANGED_EVENT, syncUnreadLogIds)

    return () => {
      window.removeEventListener('storage', syncUnreadLogIds)
      window.removeEventListener(UNREAD_LOG_IDS_CHANGED_EVENT, syncUnreadLogIds)
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'log') {
      setLogViewActive(false)
      return
    }

    setLogViewActive(true)
    const heartbeatId = window.setInterval(() => {
      setLogViewActive(true)
    }, 5000)

    return () => {
      window.clearInterval(heartbeatId)
      setLogViewActive(false)
    }
  }, [activeTab])

  useEffect(() => {
    if (!isDirector) {
      setCharacterRoster([])
      setManualHidden(false)
      setAttackHidden(false)
      setDirectorView('overview')
      setSelectedAttackTargetIds(new Set())

      if (activeTabRef.current === 'director') {
        activeTabRef.current = 'forgesteel'
        setActiveTab('forgesteel')
      }

      return
    }

    let active = true
    let unsubscribe: () => void = () => undefined

    void listenForCharacterRoster((entries) => {
      if (active) {
        setCharacterRoster(entries)
      }
    }).then((listener) => {
      unsubscribe = listener
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [isDirector])

  useEffect(() => {
    setSelectedAttackTargetIds((currentIds) => {
      const availableIds = new Set(
        attackTargets
          .map((entry) => entry.snapshot?.characterId)
          .filter((id): id is string => Boolean(id)),
      )
      const nextIds = new Set(
        [...currentIds].filter((id) => availableIds.has(id)),
      )

      if (nextIds.size === currentIds.size) {
        return currentIds
      }

      return nextIds
    })
  }, [attackTargets])

  useEffect(() => {
    const flashTimeouts = flashTimeoutsRef.current

    return () => {
      flashTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [])

  const activePanelSize = panelSize
  const rollStateDisabled = manualDice === 'd10'

  function handleResizeGripPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const originX = event.clientX
    const originY = event.clientY
    const originWidth = activePanelSize.width
    const originHeight = activePanelSize.height
    let animationFrameId = 0

    setIsResizing(true)

    const resizeFromPointer = (clientX: number, clientY: number) => {
      const nextSize = snapCustomPanelSize({
        width: originWidth + clientX - originX,
        height: originHeight + clientY - originY,
      })

      setPanelSize(nextSize)
      savePanelSize(nextSize)

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = requestAnimationFrame(() => {
        void resizeActionPopover(nextSize).then(setOwlbearStatus)
      })
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeFromPointer(moveEvent.clientX, moveEvent.clientY)
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      resizeFromPointer(upEvent.clientX, upEvent.clientY)
      setIsResizing(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  function queueForgeSteelDefaultOptions() {
    postDefaultOptionsToForgeSteel(iframeRef.current, FORGESTEEL_ORIGIN)
    window.setTimeout(() => {
      postDefaultOptionsToForgeSteel(iframeRef.current, FORGESTEEL_ORIGIN)
    }, 250)
    window.setTimeout(() => {
      postDefaultOptionsToForgeSteel(iframeRef.current, FORGESTEEL_ORIGIN)
    }, 1000)
  }

  function handleManualRoll() {
    const visibility: RollVisibility =
      isDirector && manualHidden ? 'hidden' : 'public'
    const message = createManualRollMessage({
      dice: manualDice,
      modifier: manualModifier,
      rollState: manualRollState,
      rollerName:
        localPlayerRef.current?.role === 'GM'
          ? 'Director'
          : localPlayerRef.current?.name || 'Table',
    })

    recordRoll(message, {
      source: 'manual',
      visibility,
      player: localPlayerRef.current,
    })
    void broadcastRoll(message, visibility)
  }

  function handleDirectorAttack() {
    const selectedTargets = attackTargets.filter(
      (entry) =>
        entry.snapshot &&
        selectedAttackTargetIds.has(entry.snapshot.characterId),
    )

    if (selectedTargets.length === 0) {
      return
    }

    const roll = rollPowerRoll({
      modifier: attackModifier,
      rollState: attackRollState,
    })
    const baseDamage = attackDamageByTier[roll.tier]
    const targets = selectedTargets
      .map((entry): DamageLogTarget | null => {
        if (!entry.snapshot) {
          return null
        }

        const result = calculateTargetDamage(
          entry.snapshot,
          attackDamageType,
          baseDamage,
        )

        return {
          characterId: entry.snapshot.characterId,
          characterName: entry.snapshot.characterName,
          playerName: entry.player.name,
          playerColor: entry.player.color,
          baseDamage,
          adjustment: result.adjustment,
          finalDamage: result.finalDamage,
          immunities: result.immunities,
          weaknesses: result.weaknesses,
        }
      })
      .filter((target): target is DamageLogTarget => Boolean(target))

    if (targets.length === 0) {
      return
    }

    const entry: StoredDamageLogEntry = {
      kind: 'damage',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'director',
      visibility: attackHidden ? 'hidden' : 'public',
      player: localPlayerRef.current,
      title: 'Director Attack',
      damageType: attackDamageType,
      baseDamage,
      formula: roll.formula,
      total: roll.total,
      naturalTotal: roll.naturalTotal,
      tier: roll.tier,
      baseTier: roll.baseTier,
      rollState: roll.rollStateLabel,
      breakdown: roll.breakdown,
      targets,
    }

    recordLogEntry(entry)
    void broadcastDamageLog(entry)
  }

  function selectTab(nextTab: ActiveTab) {
    activeTabRef.current = nextTab
    setActiveTab(nextTab)

    if (nextTab === 'log') {
      setUnseenLogIds((currentIds) => {
        const ids = [...currentIds]
        if (ids.length > 0) {
          queueLogFlash(ids)
        }

        return new Set()
      })
      clearUnreadLogIds()
      void setActionBadgeCount(0)
    }
  }

  function markLogFresh(logId: string) {
    if (activeTabRef.current === 'log') {
      queueLogFlash([logId])
      return
    }

    const nextIds = addUnreadLogId(logId)
    setUnseenLogIds(nextIds)
    void setActionBadgeCount(nextIds.size)
  }

  function queueLogFlash(logIds: string[]) {
    if (logIds.length === 0) {
      return
    }

    setFlashingLogIds((currentIds) => {
      const nextIds = new Set(currentIds)
      logIds.forEach((logId) => nextIds.add(logId))
      return nextIds
    })

    const timeoutId = window.setTimeout(() => {
      setFlashingLogIds((currentIds) => {
        const nextIds = new Set(currentIds)
        logIds.forEach((logId) => nextIds.delete(logId))
        return nextIds
      })
    }, 6000)

    flashTimeoutsRef.current.push(timeoutId)
  }

  function adjustManualModifier(delta: number) {
    setManualModifier((value) =>
      clamp(value + delta, MIN_MANUAL_MODIFIER, MAX_MANUAL_MODIFIER),
    )
  }

  function adjustAttackModifier(delta: number) {
    setAttackModifier((value) =>
      clamp(value + delta, MIN_MANUAL_MODIFIER, MAX_MANUAL_MODIFIER),
    )
  }

  function adjustAttackDamage(tier: 1 | 2 | 3, delta: number) {
    setAttackDamageByTier((currentDamage) => ({
      ...currentDamage,
      [tier]: clamp(
        currentDamage[tier] + delta,
        MIN_DAMAGE_VALUE,
        MAX_DAMAGE_VALUE,
      ),
    }))
  }

  function toggleAttackTarget(characterId: string) {
    setSelectedAttackTargetIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(characterId)) {
        nextIds.delete(characterId)
      } else {
        nextIds.add(characterId)
      }

      return nextIds
    })
  }

  function selectAllAttackTargets() {
    setSelectedAttackTargetIds(
      new Set(
        attackTargets
          .map((entry) => entry.snapshot?.characterId)
          .filter((id): id is string => Boolean(id)),
      ),
    )
  }

  function clearAttackTargets() {
    setSelectedAttackTargetIds(new Set())
  }

  function toggleLogExpanded(logId: string) {
    setExpandedLogIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(logId)) {
        nextIds.delete(logId)
      } else {
        nextIds.add(logId)
      }

      return nextIds
    })
  }

  function handleLogSummaryKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    logId: string,
  ) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    toggleLogExpanded(logId)
  }

  function clearTableLog() {
    setLogEntries([])
    clearStoredLogEntries()
    clearUnreadLogIds()
    logIdsRef.current = new Set()
    setUnseenLogIds(new Set())
    setFlashingLogIds(new Set())
    setExpandedLogIds(new Set())
    setClearConfirmOpen(false)
    void setActionBadgeCount(0)
  }

  function showHiddenLogEntry(entry: TableLogEntry) {
    if (entry.visibility !== 'hidden') {
      return
    }

    const publicEntry = {
      ...entry,
      visibility: 'public',
    } satisfies TableLogEntry

    setLogEntries((currentEntries) => {
      const nextEntries = currentEntries.map((item) =>
        item.id === entry.id ? publicEntry : item,
      )
      saveStoredLogEntries(nextEntries)
      return nextEntries
    })

    void broadcastLogEntry(publicEntry)
  }

  function entryBelongsToCurrentPlayer(entry: TableLogEntry): boolean {
    return isSameRollPlayer(entry.player, localPlayer)
  }

  function renderDamageLogEntry(
    entry: StoredDamageLogEntry,
    expanded: boolean,
  ) {
    const totalDamage = entry.targets.reduce(
      (sum, target) => sum + target.finalDamage,
      0,
    )
    const isMine = entryBelongsToCurrentPlayer(entry)

    return (
      <li
        key={entry.id}
        className={`roll-card damage-card ${
          entry.visibility === 'hidden' ? 'roll-card-hidden' : ''
        } ${isMine ? 'roll-card-mine' : ''} ${
          flashingLogIds.has(entry.id) ? 'roll-card-fresh' : ''
        }`}
      >
        <div
          className="roll-card-summary"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => toggleLogExpanded(entry.id)}
          onKeyDown={(event) => handleLogSummaryKeyDown(event, entry.id)}
        >
          <div className="roll-card-header">
            <div className="player-chip">
              <span
                className="player-avatar"
                style={{
                  backgroundColor: entry.player?.color || '#7a3f32',
                }}
              >
                {getInitial(entry.player?.name || 'Director')}
              </span>
              <span>{entry.player?.name || 'Director'}</span>
            </div>
            <div className="roll-card-badges">
              {isMine && <span>You</span>}
              <span>Damage</span>
              <span>{entry.damageType}</span>
              {flashingLogIds.has(entry.id) && (
                <span className="roll-card-new-badge">New</span>
              )}
              {entry.visibility === 'hidden' && (
                <span className="hidden-visibility-badge">Hidden</span>
              )}
            </div>
            <time dateTime={entry.timestamp}>
              {formatRollTime(entry.timestamp)}
            </time>
            {isDirector && entry.visibility === 'hidden' && (
              <button
                type="button"
                className="show-hidden-command"
                onClick={(event) => {
                  event.stopPropagation()
                  showHiddenLogEntry(entry)
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                Show
              </button>
            )}
            <span
              className={`expand-indicator ${expanded ? 'expanded' : ''}`}
              aria-hidden="true"
            >
              ^
            </span>
          </div>

          <div className="roll-card-main">
            <div className="roll-card-title">
              <strong>{entry.title}</strong>
              <span>{entry.targets.length} targets</span>
            </div>
            <div className="roll-score-grid">
              <RollScoreBox label="BASE" value={entry.baseDamage} />
              <RollScoreBox label="TOTAL" value={totalDamage} tone="total" />
              <RollScoreBox
                label="TIER"
                value={entry.tier}
                tone="tier"
                note={getTierAdjustmentLabel(entry)}
              />
            </div>
          </div>

          <div className="roll-formula">
            <span>{entry.formula}</span>
            <em>{entry.rollState}</em>
          </div>
        </div>

        {expanded && (
          <div className="roll-card-details">
            <div className="roll-breakdown">
              <strong>Attack</strong>
              <span>{entry.breakdown}</span>
            </div>
            {isTierShifted(entry) && (
              <div className="tier-shift-note">
                {entry.rollState} moved this from tier {entry.baseTier} to tier{' '}
                {entry.tier}.
              </div>
            )}
            <div className="damage-target-list">
              {entry.targets.map((target) => (
                <div key={target.characterId} className="damage-target-row">
                  <div>
                    <strong>{target.characterName}</strong>
                    {target.playerName && <span>{target.playerName}</span>}
                  </div>
                  <div className="damage-target-math">
                    <span>{target.baseDamage}</span>
                    <span>{formatModifierValue(target.adjustment)}</span>
                    <strong>{target.finalDamage}</strong>
                  </div>
                  <div className="damage-adjustments">
                    {target.immunities.map((modifier) => (
                      <span key={`immunity-${modifier.damageType}`}>
                        {modifier.damageType} immunity{' '}
                        {formatModifierValue(modifier.value)}
                      </span>
                    ))}
                    {target.weaknesses.map((modifier) => (
                      <span key={`weakness-${modifier.damageType}`}>
                        {modifier.damageType} weakness{' '}
                        {formatModifierValue(modifier.value)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </li>
    )
  }

  function renderDirectorAttackTool() {
    return (
      <section className="director-tool-panel" aria-label="Attack heroes">
        <div className="manual-roll-heading">
          <div>
            <h3>Attack Heroes</h3>
            <p>
              Power roll once, then apply tier damage to selected hero
              snapshots.
            </p>
          </div>
          <div className="manual-roll-actions">
            <label className="hidden-toggle hidden-toggle-heading">
              <input
                type="checkbox"
                checked={attackHidden}
                onChange={(event) => setAttackHidden(event.target.checked)}
              />
              Hidden
            </label>
            <button
              type="button"
              className="roll-command"
              disabled={selectedAttackTargetIds.size === 0}
              onClick={handleDirectorAttack}
            >
              Attack
            </button>
          </div>
        </div>

        <div className="attack-controls">
          <div className="control-group">
            <span>Damage Type</span>
            <select
              className="select-control"
              value={attackDamageType}
              onChange={(event) =>
                setAttackDamageType(event.target.value as DamageType)
              }
            >
              {DAMAGE_TYPES.map((damageType) => (
                <option key={damageType} value={damageType}>
                  {damageType}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <span>Modifier</span>
            <div className="modifier-stepper">
              <button
                type="button"
                aria-label="Decrease attack modifier"
                onClick={() => adjustAttackModifier(-1)}
              >
                -
              </button>
              <output aria-live="polite">
                {formatModifierValue(attackModifier)}
              </output>
              <button
                type="button"
                aria-label="Increase attack modifier"
                onClick={() => adjustAttackModifier(1)}
              >
                +
              </button>
            </div>
          </div>

          <div className="control-group control-group-wide">
            <span>Roll State</span>
            <div className="segmented-control roll-state-control">
              {MANUAL_ROLL_STATES.map((state) => (
                <button
                  key={state.value}
                  type="button"
                  className={attackRollState === state.value ? 'active' : ''}
                  aria-pressed={attackRollState === state.value}
                  onClick={() => setAttackRollState(state.value)}
                >
                  {state.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group control-group-wide">
            <span>Tier Damage</span>
            <div className="tier-damage-grid">
              {([1, 2, 3] as const).map((tier) => (
                <div key={tier} className="tier-damage-stepper">
                  <small>T{tier}</small>
                  <div className="modifier-stepper">
                    <button
                      type="button"
                      aria-label={`Decrease tier ${tier} damage`}
                      onClick={() => adjustAttackDamage(tier, -1)}
                    >
                      -
                    </button>
                    <output aria-live="polite">
                      {attackDamageByTier[tier]}
                    </output>
                    <button
                      type="button"
                      aria-label={`Increase tier ${tier} damage`}
                      onClick={() => adjustAttackDamage(tier, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="control-group control-group-wide">
            <div className="target-heading">
              <span>Targets</span>
              <div>
                <button type="button" onClick={selectAllAttackTargets}>
                  All
                </button>
                <button type="button" onClick={clearAttackTargets}>
                  None
                </button>
              </div>
            </div>
            {attackTargets.length === 0 ? (
              <div className="target-empty">
                No active hero snapshots are available.
              </div>
            ) : (
              <div className="target-grid">
                {attackTargets.map((entry) => {
                  const snapshot = entry.snapshot!
                  const selected = selectedAttackTargetIds.has(
                    snapshot.characterId,
                  )

                  return (
                    <label
                      key={snapshot.characterId}
                      className={`target-option ${selected ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          toggleAttackTarget(snapshot.characterId)
                        }
                      />
                      <span>{snapshot.characterName}</span>
                      <small>{entry.player.name}</small>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  function renderDirectorRoster() {
    if (characterRoster.length === 0) {
      return (
        <div className="empty-state">
          <strong>No connected players yet</strong>
          <span>
            Hero snapshots appear here when players open a ForgeSteel hero
            through the extension.
          </span>
        </div>
      )
    }

    return (
      <ol className="director-roster">
        {characterRoster.map((entry) => (
          <li
            key={
              entry.player.connectionId || entry.player.id || entry.player.name
            }
            className={`director-card ${
              entry.snapshot ? '' : 'director-card-empty'
            }`}
          >
            <div className="director-card-top">
              <div className="player-chip">
                <span
                  className="player-avatar"
                  style={{
                    backgroundColor: entry.player.color || '#215681',
                  }}
                >
                  {getInitial(entry.player.name)}
                </span>
                <span>{entry.player.name}</span>
              </div>
              <div className="director-card-badges">
                <span>{entry.player.role || 'PLAYER'}</span>
                <span>
                  {entry.snapshot
                    ? formatSnapshotAge(entry.snapshot.updatedAt)
                    : 'No hero'}
                </span>
              </div>
            </div>

            {entry.snapshot ? (
              <div className="director-hero">
                <div className="director-hero-title">
                  <h3>{entry.snapshot.characterName}</h3>
                  <p>{formatHeroSummary(entry.snapshot)}</p>
                </div>

                <div className="director-stat-grid">
                  <DirectorStat
                    label="Stamina"
                    value={formatFraction(
                      entry.snapshot.stamina.current,
                      entry.snapshot.stamina.max,
                    )}
                    note={
                      entry.snapshot.stamina.temp
                        ? `+${entry.snapshot.stamina.temp} temp`
                        : undefined
                    }
                  />
                  <DirectorStat
                    label="Recoveries"
                    value={formatFraction(
                      entry.snapshot.recoveries.current,
                      entry.snapshot.recoveries.max,
                    )}
                    note={
                      entry.snapshot.recoveries.value !== undefined
                        ? `${entry.snapshot.recoveries.value} value`
                        : undefined
                    }
                  />
                  <DirectorStat
                    label="Save"
                    value={formatOptionalNumber(entry.snapshot.save.target)}
                    note={
                      entry.snapshot.save.bonus !== undefined
                        ? `+${entry.snapshot.save.bonus}`
                        : undefined
                    }
                  />
                  <DirectorStat
                    label="Speed"
                    value={entry.snapshot.movement.speed || '-'}
                    note={
                      entry.snapshot.movement.size
                        ? `Size ${entry.snapshot.movement.size}`
                        : undefined
                    }
                  />
                </div>

                <div className="director-characteristics">
                  {Object.entries(entry.snapshot.characteristics).map(
                    ([key, value]) => (
                      <span key={key}>
                        <small>{key.slice(0, 3).toUpperCase()}</small>
                        <strong>{formatOptionalNumber(value)}</strong>
                      </span>
                    ),
                  )}
                </div>

                <DirectorTagSection
                  label="Immunities"
                  emptyLabel="No immunities"
                  tags={entry.snapshot.immunities.map(
                    (modifier) =>
                      `${modifier.damageType} ${formatSignedNumber(
                        modifier.value,
                      )}`,
                  )}
                />
                <DirectorTagSection
                  label="Weaknesses"
                  emptyLabel="No weaknesses"
                  tags={entry.snapshot.weaknesses.map(
                    (modifier) =>
                      `${modifier.damageType} ${formatSignedNumber(
                        modifier.value,
                      )}`,
                  )}
                />
                <DirectorTagSection
                  label="Conditions"
                  emptyLabel="No conditions"
                  tags={entry.snapshot.conditions.map((condition) =>
                    condition.text
                      ? `${condition.type}: ${condition.text}`
                      : condition.type,
                  )}
                />
              </div>
            ) : (
              <p className="director-empty-note">
                This player has the extension open, but no ForgeSteel hero page
                is currently active.
              </p>
            )}
          </li>
        ))}
      </ol>
    )
  }

  return (
    <main
      className={`extension-shell theme-${extensionTheme} ${
        isResizing ? 'resizing' : ''
      } ${isStandaloneBrowser ? 'standalone-shell' : ''}`}
    >
      <h1 className="sr-only">ForgeSteel Owlbear Extension</h1>

      <section
        className={`panel panel-forgesteel ${
          activeTab === 'forgesteel' ? 'visible' : ''
        }`}
        aria-hidden={activeTab !== 'forgesteel'}
      >
        {!iframeLoaded && (
          <div className="iframe-loading">
            <strong>Loading ForgeSteel</strong>
            <span>
              If this stays blank, open ForgeSteel in a browser once and then
              reload the Owlbear extension.
            </span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="ForgeSteel"
          src={FORGESTEEL_URL}
          onLoad={() => {
            setIframeLoaded(true)
            queueForgeSteelDefaultOptions()
          }}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="clipboard-read; clipboard-write"
        />
      </section>

      <section
        className={`panel panel-log ${activeTab === 'log' ? 'visible' : ''}`}
        aria-hidden={activeTab !== 'log'}
      >
        <div className="rolls-header">
          <div>
            <h2>Table Log</h2>
            <p>Shared rolls, Director actions, and table-facing results.</p>
          </div>
          <div className="rolls-header-actions">
            <button
              type="button"
              className="subtle-command"
              disabled={logEntries.length === 0}
              onClick={() => setClearConfirmOpen(true)}
            >
              Clear
            </button>
          </div>
        </div>

        {logEntries.length === 0 ? (
          <div className="empty-state">
            <strong>No log entries yet</strong>
            <span>Roll, attack, or use a Director action to add entries here.</span>
          </div>
        ) : (
          <ol className="roll-list">
            {logEntries.map((entry) => {
              const expanded = expandedLogIds.has(entry.id)

              if (entry.kind === 'damage') {
                return renderDamageLogEntry(entry, expanded)
              }

              const roll = entry
              const isMine = entryBelongsToCurrentPlayer(roll)

              return (
                <li
                  key={roll.id}
                  className={`roll-card ${
                    roll.visibility === 'hidden' ? 'roll-card-hidden' : ''
                  } ${isMine ? 'roll-card-mine' : ''} ${
                    flashingLogIds.has(roll.id) ? 'roll-card-fresh' : ''
                  }`}
                >
                  <div
                    className="roll-card-summary"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => toggleLogExpanded(roll.id)}
                    onKeyDown={(event) =>
                      handleLogSummaryKeyDown(event, roll.id)
                    }
                  >
                    <div className="roll-card-header">
                      <div className="player-chip">
                        <span
                          className="player-avatar"
                          style={{
                            backgroundColor: roll.player?.color || '#215681',
                          }}
                        >
                          {getPlayerInitial(roll)}
                        </span>
                        <span>{getPlayerName(roll)}</span>
                      </div>
                      <div className="roll-card-badges">
                        {isMine && <span>You</span>}
                        <span>
                          {roll.source === 'manual' ? 'Manual' : 'ForgeSteel'}
                        </span>
                        {flashingLogIds.has(roll.id) && (
                          <span className="roll-card-new-badge">New</span>
                        )}
                        {roll.visibility === 'hidden' && (
                          <span className="hidden-visibility-badge">
                            Hidden
                          </span>
                        )}
                      </div>
                      <time dateTime={roll.timestamp}>
                        {formatRollTime(roll.timestamp)}
                      </time>
                      {isDirector && roll.visibility === 'hidden' && (
                        <button
                          type="button"
                          className="show-hidden-command"
                          onClick={(event) => {
                            event.stopPropagation()
                            showHiddenLogEntry(roll)
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          Show
                        </button>
                      )}
                      <span
                        className={`expand-indicator ${
                          expanded ? 'expanded' : ''
                        }`}
                        aria-hidden="true"
                      >
                        ^
                      </span>
                    </div>

                    <div className="roll-card-main">
                      <div className="roll-card-title">
                        <strong>{roll.actorName}</strong>
                        <span>{getAbilityName(roll)}</span>
                      </div>
                      <div className="roll-score-grid">
                        <RollScoreBox
                          label="NAT"
                          value={formatOptionalNumber(roll.naturalTotal)}
                        />
                        <RollScoreBox
                          label="TOTAL"
                          value={roll.total}
                          tone="total"
                        />
                        <RollScoreBox
                          label="TIER"
                          value={formatTierValue(roll)}
                          tone="tier"
                          note={getTierAdjustmentLabel(roll)}
                        />
                      </div>
                    </div>

                    <div className="roll-formula">
                      <span>{roll.formula}</span>
                      {roll.rollState &&
                        roll.rollState !== 'Standard Roll' &&
                        roll.rollState !== 'Standard' && (
                          <em>{roll.rollState}</em>
                        )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="roll-card-details">
                      {roll.breakdown && (
                        <div className="roll-breakdown">
                          <strong>Roll</strong>
                          <span>{roll.breakdown}</span>
                        </div>
                      )}

                      {isTierShifted(roll) && (
                        <div className="tier-shift-note">
                          {roll.rollState || 'Tier shift'} moved this from tier{' '}
                          {roll.baseTier} to tier {roll.tier}.
                        </div>
                      )}

                      {roll.context?.details && (
                        <div className="ability-details">
                          <div className="ability-title-row">
                            <strong>
                              {roll.context.details.name || roll.label}
                            </strong>
                            {roll.context.details.type && (
                              <span>{roll.context.details.type}</span>
                            )}
                          </div>
                          {roll.context.details.description && (
                            <p>{roll.context.details.description}</p>
                          )}
                          <div className="ability-fields">
                            {roll.context.details.cost && (
                              <span>Cost: {roll.context.details.cost}</span>
                            )}
                            {roll.context.details.distance && (
                              <span>
                                Distance: {roll.context.details.distance}
                              </span>
                            )}
                            {roll.context.details.target && (
                              <span>Target: {roll.context.details.target}</span>
                            )}
                            {roll.context.details.trigger && (
                              <span>
                                Trigger: {roll.context.details.trigger}
                              </span>
                            )}
                          </div>
                          {roll.context.details.keywords &&
                            roll.context.details.keywords.length > 0 && (
                              <div className="keyword-row">
                                {roll.context.details.keywords.map((keyword) => (
                                  <span key={keyword}>{keyword}</span>
                                ))}
                              </div>
                            )}
                          {roll.context.details.sections &&
                            roll.context.details.sections.length > 0 && (
                              <div className="ability-section-list">
                                {roll.context.details.sections.map(
                                  (section, index) => (
                                    <div key={`${section.label}-${index}`}>
                                      <strong>{section.label}</strong>
                                      <span>{section.text}</span>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          {roll.context.details.tiers &&
                            roll.context.details.tiers.length > 0 && (
                              <div className="tier-list">
                                {roll.context.details.tiers.map((tier) => (
                                  <div key={tier.tier}>
                                    <strong>Tier {tier.tier}</strong>
                                    <span>{tier.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {clearConfirmOpen && (
          <div
            className="confirm-backdrop"
            role="presentation"
            onClick={() => setClearConfirmOpen(false)}
          >
            <section
              className="confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-rolls-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="clear-rolls-title">Clear Table Log</h3>
              <p>
                This removes locally stored table log entries from this
                extension panel. Shared entries already seen by other players are
                not recalled.
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="subtle-command"
                  onClick={() => setClearConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-command"
                  onClick={clearTableLog}
                >
                  Clear log
                </button>
              </div>
            </section>
          </div>
        )}
      </section>

      <section
        className={`panel panel-roller ${
          activeTab === 'roller' ? 'visible' : ''
        }`}
        aria-hidden={activeTab !== 'roller'}
      >
        <div className="rolls-header">
          <div>
            <h2>Table Roller</h2>
            <p>Roll simple table checks and share public results to the log.</p>
          </div>
        </div>

        <section className="manual-roll-panel" aria-label="Manual roll panel">
          <div className="manual-roll-heading">
            <div>
              <h3>Table Roll</h3>
              <p>
                {localPlayer ? `Rolling as ${localPlayer.name}` : 'Local roll'}
              </p>
            </div>
            <div className="manual-roll-actions">
              {isDirector && (
                <label className="hidden-toggle hidden-toggle-heading">
                  <input
                    type="checkbox"
                    checked={manualHidden}
                    onChange={(event) => setManualHidden(event.target.checked)}
                  />
                  Hidden
                </label>
              )}
              <button
                type="button"
                className="roll-command"
                onClick={handleManualRoll}
              >
                Roll
              </button>
            </div>
          </div>

          <div className="manual-roll-controls">
            <div className="control-group">
              <span>Dice</span>
              <div className="segmented-control">
                {(['2d10', 'd10'] as ManualDice[]).map((dice) => (
                  <button
                    key={dice}
                    type="button"
                    className={manualDice === dice ? 'active' : ''}
                    aria-pressed={manualDice === dice}
                    onClick={() => setManualDice(dice)}
                  >
                    {dice}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span>Modifier</span>
              <div className="modifier-stepper">
                <button
                  type="button"
                  aria-label="Decrease modifier"
                  onClick={() => adjustManualModifier(-1)}
                >
                  -
                </button>
                <output aria-live="polite">
                  {formatModifierValue(manualModifier)}
                </output>
                <button
                  type="button"
                  aria-label="Increase modifier"
                  onClick={() => adjustManualModifier(1)}
                >
                  +
                </button>
              </div>
            </div>

            <div
              className={`control-group control-group-wide ${
                rollStateDisabled ? 'control-group-disabled' : ''
              }`}
            >
              <span>Roll State</span>
              <div
                className="segmented-control roll-state-control"
                aria-disabled={rollStateDisabled}
              >
                {MANUAL_ROLL_STATES.map((state) => (
                  <button
                    key={state.value}
                    type="button"
                    className={manualRollState === state.value ? 'active' : ''}
                    aria-pressed={manualRollState === state.value}
                    disabled={rollStateDisabled}
                    onClick={() => setManualRollState(state.value)}
                  >
                    {state.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>

      <section
        className={`panel panel-director ${
          activeTab === 'director' ? 'visible' : ''
        }`}
        aria-hidden={activeTab !== 'director'}
      >
        <div className="director-header">
          <div>
            <h2>Director</h2>
            <p>Live ForgeSteel hero snapshots from connected players.</p>
          </div>
          <div className="director-header-tools">
            <span className="director-player-count">
              {characterRoster.length} players
            </span>
            {isDirector && (
              <div className="director-view-switcher" role="tablist">
                <button
                  type="button"
                  className={directorView === 'overview' ? 'active' : ''}
                  aria-pressed={directorView === 'overview'}
                  onClick={() => setDirectorView('overview')}
                >
                  Overview
                </button>
                <button
                  type="button"
                  className={directorView === 'attack' ? 'active' : ''}
                  aria-pressed={directorView === 'attack'}
                  onClick={() => setDirectorView('attack')}
                >
                  Attack
                </button>
              </div>
            )}
          </div>
        </div>

        {!isDirector ? (
          <div className="empty-state">
            <strong>Director tools are GM only</strong>
            <span>Open this extension as the Owlbear GM to see party data.</span>
          </div>
        ) : (
          <>
            {directorView === 'attack'
              ? renderDirectorAttackTool()
              : renderDirectorRoster()}
          </>
        )}
      </section>

      {!isStandaloneBrowser && (
        <footer className="bottom-bar">
          <nav
            className="tabs"
            aria-label="Extension views"
            style={{
              gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))`,
            }}
          >
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'log' && unseenLogIds.size > 0 && (
                  <span>{unseenLogIds.size}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="settings-info">
            <button
              type="button"
              className="settings-button"
              aria-label="Extension settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((isOpen) => !isOpen)}
            >
              S
            </button>
            {settingsOpen && (
              <section className="settings-popover" aria-label="Settings">
                <div className="settings-popover-heading">
                  <strong>Settings</strong>
                  <span>Extension display</span>
                </div>
                <div className="control-group">
                  <span>Theme</span>
                  <div className="segmented-control theme-control">
                    {(['dark', 'light'] as ExtensionTheme[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        className={extensionTheme === theme ? 'active' : ''}
                        aria-pressed={extensionTheme === theme}
                        onClick={() => setExtensionTheme(theme)}
                      >
                        {theme === 'dark' ? 'Dark' : 'Light'}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
          <div className="status-info">
            <button
              type="button"
              className={`status-info-button status-info-${owlbearStatus.status}`}
              aria-label="Extension status"
            >
              i
            </button>
            <div className="status-tooltip" role="status">
              <p>{owlbearStatus.message}</p>
              <p>{bridgeStatus.message}</p>
            </div>
          </div>
        </footer>
      )}

      {!isStandaloneBrowser && (
        <button
          type="button"
          className="resize-grip"
          aria-label="Resize panel"
          title="Drag to resize panel"
          onPointerDown={handleResizeGripPointerDown}
        />
      )}
    </main>
  )
}

function createForgeSteelUrl(): string {
  const url = new URL(FORGESTEEL_BASE_URL)
  url.searchParams.set('owlbearBridge', '1')
  url.searchParams.set('owlbearOrigin', window.location.origin)
  return url.toString()
}

function snapCustomPanelSize({
  width,
  height,
}: {
  width: number
  height: number
}): PanelSize {
  const nextWidth = clamp(
    Math.round(width),
    MIN_PANEL_WIDTH,
    MAX_PANEL_WIDTH,
  )
  const nextHeight = clamp(
    Math.round(height),
    MIN_PANEL_HEIGHT,
    MAX_PANEL_HEIGHT,
  )

  return {
    label: 'Custom',
    width: nextWidth,
    height: nextHeight,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function createManualRollMessage({
  dice,
  modifier,
  rollState,
  rollerName,
}: {
  dice: ManualDice
  modifier: number
  rollState: ManualRollState
  rollerName: string
}): ForgeSteelRollResultMessage {
  if (dice === 'd10') {
    const roll = rollD10Only({ modifier })

    return {
      type: 'FORGESTEEL_ROLL_RESULT',
      schemaVersion: 1,
      messageId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'forgesteel',
      payload: {
        actorName: rollerName,
        label: 'd10 Roll',
        formula: roll.formula,
        total: roll.total,
        naturalTotal: roll.naturalTotal,
        breakdown: roll.breakdown,
        context: {
          kind: 'manual',
          details: {
            name: 'Manual d10 Roll',
          },
        },
      },
    }
  }

  const roll = rollPowerRoll({ modifier, rollState })

  return {
    type: 'FORGESTEEL_ROLL_RESULT',
    schemaVersion: 1,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'forgesteel',
    payload: {
      actorName: rollerName,
      label: 'Power Roll',
      formula: roll.formula,
      total: roll.total,
      naturalTotal: roll.naturalTotal,
      tier: roll.tier,
      baseTier: roll.baseTier,
      rollState: roll.rollStateLabel,
      breakdown: roll.breakdown,
      context: {
        kind: 'manual',
        details: {
          name: 'Manual Power Roll',
          type: roll.rollStateLabel,
          tiers: [
            {
              tier: roll.tier,
              text: `Result landed in tier ${roll.tier}.`,
            },
          ],
        },
      },
    },
  }
}

function rollPowerRoll({
  modifier,
  rollState,
}: {
  modifier: number
  rollState: ManualRollState
}): PowerRollResult {
  const rolls = [rollD10(), rollD10()]
  const naturalTotal = rolls.reduce((sum, roll) => sum + roll, 0)
  const stateBonus = getRollStateBonus(rollState)
  const total = naturalTotal + modifier + stateBonus
  const baseTier = getBasePowerRollTier(total)
  const tier = getPowerRollTier(total, rollState)
  const formula = formatFormula('2d10', modifier, stateBonus, rollState)
  const rollStateLabel = getRollStateLabel(rollState)
  const breakdownParts = [
    rolls.join(' + '),
    modifier !== 0 ? formatSignedNumber(modifier) : '',
    stateBonus !== 0
      ? `${formatSignedNumber(stateBonus)} ${rollStateLabel}`
      : '',
  ].filter(Boolean)

  return {
    rolls,
    naturalTotal,
    total,
    baseTier,
    tier,
    stateBonus,
    formula,
    rollStateLabel,
    breakdown: `${breakdownParts.join(' ')} = ${total} (Tier ${tier})`,
  }
}

function rollD10Only({ modifier }: { modifier: number }) {
  const rolls = [rollD10()]
  const naturalTotal = rolls[0]
  const total = naturalTotal + modifier
  const formula = formatFormula('d10', modifier, 0, 'standard')
  const breakdownParts = [
    naturalTotal.toString(),
    modifier !== 0 ? formatSignedNumber(modifier) : '',
  ].filter(Boolean)

  return {
    rolls,
    naturalTotal,
    total,
    formula,
    breakdown: `${breakdownParts.join(' ')} = ${total}`,
  }
}

function rollD10(): number {
  return 1 + Math.floor(Math.random() * 10)
}

function getRollStateBonus(rollState: ManualRollState): number {
  switch (rollState) {
    case 'edge':
      return 2
    case 'bane':
      return -2
    case 'doubleBane':
    case 'standard':
    case 'doubleEdge':
      return 0
  }
}

function getBasePowerRollTier(total: number): 1 | 2 | 3 {
  return total >= 17 ? 3 : total >= 12 ? 2 : 1
}

function getPowerRollTier(total: number, rollState: ManualRollState): 1 | 2 | 3 {
  let tier = getBasePowerRollTier(total)

  if (rollState === 'doubleEdge' && tier < 3) {
    tier = (tier + 1) as 1 | 2 | 3
  }

  if (rollState === 'doubleBane' && tier > 1) {
    tier = (tier - 1) as 1 | 2 | 3
  }

  return tier
}

function calculateTargetDamage(
  snapshot: ForgeSteelCharacterSnapshotPayload,
  damageType: DamageType,
  baseDamage: number,
) {
  const immunities = getApplicableDamageAdjustments(
    snapshot.immunities,
    damageType,
  )
  const weaknesses = getApplicableDamageAdjustments(
    snapshot.weaknesses,
    damageType,
  )
  const immunityTotal = immunities.reduce(
    (sum, modifier) => sum + modifier.value,
    0,
  )
  const weaknessTotal = weaknesses.reduce(
    (sum, modifier) => sum + modifier.value,
    0,
  )
  const adjustment = weaknessTotal - immunityTotal

  return {
    adjustment,
    finalDamage: Math.max(0, baseDamage + adjustment),
    immunities,
    weaknesses,
  }
}

function getApplicableDamageAdjustments(
  modifiers: Array<{ damageType: string; value: number }>,
  damageType: DamageType,
) {
  return modifiers.filter(
    (modifier) =>
      sameDamageType(modifier.damageType, damageType) ||
      (damageType !== 'Damage' && sameDamageType(modifier.damageType, 'Damage')),
  )
}

function sameDamageType(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function formatFormula(
  dice: ManualDice,
  modifier: number,
  stateBonus: number,
  rollState: ManualRollState,
): string {
  const parts: string[] = [dice]

  if (modifier !== 0) {
    parts.push(formatSignedNumber(modifier))
  }

  if (stateBonus !== 0) {
    parts.push(`${formatSignedNumber(stateBonus)} ${getRollStateLabel(rollState)}`)
  } else if (rollState === 'doubleBane' || rollState === 'doubleEdge') {
    parts.push(getRollStateLabel(rollState))
  }

  return parts.join(' ')
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? '+' : '-'} ${Math.abs(value)}`
}

function formatModifierValue(value: number): string {
  return value > 0 ? `+${value}` : value.toString()
}

function getRollStateLabel(rollState: ManualRollState): string {
  return (
    MANUAL_ROLL_STATES.find((state) => state.value === rollState)?.label ||
    'Standard'
  )
}

function getAbilityName(roll: StoredRollLogEntry): string {
  return roll.context?.details?.name || roll.label
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? '-' : value.toString()
}

function formatFraction(
  current: number | undefined,
  max: number | undefined,
): string {
  if (current === undefined && max === undefined) {
    return '-'
  }

  if (current === undefined) {
    return `- / ${max}`
  }

  if (max === undefined) {
    return current.toString()
  }

  return `${current} / ${max}`
}

function formatHeroSummary(
  snapshot: ForgeSteelCharacterSnapshotPayload,
): string {
  return [
    snapshot.level ? `Level ${snapshot.level}` : undefined,
    snapshot.ancestryName,
    snapshot.className,
    snapshot.subclassName ? `(${snapshot.subclassName})` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
}

function formatSnapshotAge(timestamp: string): string {
  const updatedAt = new Date(timestamp).getTime()

  if (!Number.isFinite(updatedAt)) {
    return 'Updated'
  }

  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))

  if (seconds < 10) {
    return 'Live'
  }

  if (seconds < 60) {
    return `${seconds}s ago`
  }

  return `${Math.floor(seconds / 60)}m ago`
}

function formatTierValue(roll: StoredRollLogEntry): string {
  return roll.tier === undefined ? '-' : roll.tier.toString()
}

function isTierShifted(entry: {
  tier?: 1 | 2 | 3
  baseTier?: 1 | 2 | 3
}): boolean {
  return (
    entry.tier !== undefined &&
    entry.baseTier !== undefined &&
    entry.tier !== entry.baseTier
  )
}

function getTierAdjustmentLabel(entry: {
  tier?: 1 | 2 | 3
  baseTier?: 1 | 2 | 3
}): string | undefined {
  if (!isTierShifted(entry)) {
    return undefined
  }

  return `from ${entry.baseTier}`
}

function getPlayerName(roll: StoredRollLogEntry): string {
  return roll.player?.name || 'Unknown Player'
}

function getPlayerInitial(roll: StoredRollLogEntry): string {
  return getPlayerName(roll).trim().charAt(0).toUpperCase() || '?'
}

function getInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || '?'
}

function formatRollTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function loadPanelSize(): PanelSize {
  try {
    const storedValue = localStorage.getItem(PANEL_SIZE_STORAGE_KEY)

    if (isLegacyPanelSizeId(storedValue)) {
      return DEFAULT_PANEL_SIZE
    }

    if (storedValue) {
      const storedSize = JSON.parse(storedValue) as Partial<PanelSize>
      if (
        typeof storedSize.width === 'number' &&
        typeof storedSize.height === 'number'
      ) {
        return snapCustomPanelSize({
          width: storedSize.width,
          height: storedSize.height,
        })
      }
    }
  } catch (error) {
    console.warn('Unable to read ForgeSteel panel size preference.', error)
  }

  return DEFAULT_PANEL_SIZE
}

function savePanelSize(size: PanelSize) {
  try {
    localStorage.setItem(
      PANEL_SIZE_STORAGE_KEY,
      JSON.stringify({ width: size.width, height: size.height }),
    )
  } catch (error) {
    console.warn('Unable to save ForgeSteel panel size preference.', error)
  }
}

function loadExtensionTheme(): ExtensionTheme {
  try {
    const storedValue = localStorage.getItem(EXTENSION_THEME_STORAGE_KEY)

    if (storedValue === 'dark' || storedValue === 'light') {
      return storedValue
    }
  } catch (error) {
    console.warn('Unable to read ForgeSteel extension theme preference.', error)
  }

  return 'dark'
}

function saveExtensionTheme(theme: ExtensionTheme) {
  try {
    localStorage.setItem(EXTENSION_THEME_STORAGE_KEY, theme)
  } catch (error) {
    console.warn('Unable to save ForgeSteel extension theme preference.', error)
  }
}

function isLegacyPanelSizeId(value: string | null): boolean {
  return (
    value === 'compact' ||
    value === 'standard' ||
    value === 'wide' ||
    value === 'large'
  )
}

function rejectMessage(event: BridgeRejectEvent): string {
  switch (event.reason) {
    case 'origin':
      return `Ignored bridge message from ${event.origin || 'unknown origin'}.`
    case 'schema':
      return 'Ignored ForgeSteel bridge message with an unsupported schema.'
    case 'duplicate':
      return 'Ignored duplicate ForgeSteel bridge message.'
    case 'shape':
      return 'Ignored malformed ForgeSteel bridge message.'
  }
}

export default App
