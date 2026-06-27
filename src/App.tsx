import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  type BridgeRejectEvent,
  type ForgeSteelRollResultMessage,
  listenForForgeSteelMessages,
  postDefaultOptionsToForgeSteel,
} from './lib/bridge'
import {
  appendRoll,
  loadStoredRolls,
  saveStoredRolls,
  type RollPlayer,
  type RollSource,
  type RollVisibility,
  type StoredRoll,
} from './lib/rollStorage'
import {
  broadcastRoll,
  getCurrentPlayerInfo,
  initializeOwlbear,
  listenForSharedRolls,
  resizeActionPopover,
  type OwlbearAdapterState,
} from './lib/owlbear'

const DEFAULT_FORGESTEEL_URL = import.meta.env.DEV
  ? 'http://localhost:5174'
  : 'https://forgesteel.net'
const FORGESTEEL_BASE_URL =
  import.meta.env.VITE_FORGESTEEL_URL || DEFAULT_FORGESTEEL_URL
const FORGESTEEL_ORIGIN = new URL(FORGESTEEL_BASE_URL).origin
const FORGESTEEL_URL = createForgeSteelUrl()
const PANEL_SIZE_STORAGE_KEY = 'net.forgesteel.owlbear.panelSize.v1'
const DEFAULT_PANEL_SIZE: PanelSize = {
  label: 'Default',
  width: 450,
  height: 520,
}
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 1280
const MIN_PANEL_HEIGHT = 360
const MAX_PANEL_HEIGHT = 1180

type ActiveTab = 'forgesteel' | 'rolls'
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

const MANUAL_ROLL_STATES: Array<{
  value: ManualRollState
  label: string
}> = [
  { value: 'doubleBane', label: '2 Bane' },
  { value: 'bane', label: 'Bane' },
  { value: 'standard', label: 'Standard' },
  { value: 'edge', label: 'Edge' },
  { value: 'doubleEdge', label: '2 Edge' },
]

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('forgesteel')
  const [rolls, setRolls] = useState<StoredRoll[]>(() => loadStoredRolls())
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    state: 'waiting',
    message: 'Waiting for ForgeSteel bridge events.',
  })
  const [owlbearStatus, setOwlbearStatus] = useState<OwlbearAdapterState>({
    status: 'available',
    message: 'Connecting to Owlbear Rodeo.',
  })
  const [panelSize, setPanelSize] = useState<PanelSize>(loadPanelSize)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [localPlayer, setLocalPlayer] = useState<RollPlayer>()
  const [manualDice, setManualDice] = useState<ManualDice>('2d10')
  const [manualModifier, setManualModifier] = useState(0)
  const [manualRollState, setManualRollState] =
    useState<ManualRollState>('standard')
  const [manualHidden, setManualHidden] = useState(false)
  const [manualPanelOpen, setManualPanelOpen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const localPlayerRef = useRef<RollPlayer | undefined>(undefined)

  function recordRoll(
    message: ForgeSteelRollResultMessage,
    options: {
      source?: RollSource
      visibility?: RollVisibility
      player?: RollPlayer | undefined
    } = {},
  ) {
    setRolls((currentRolls) => {
      const nextRolls = appendRoll(currentRolls, message, options)
      saveStoredRolls(nextRolls)
      return nextRolls
    })
  }

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

    void listenForSharedRolls((event) => {
      if (!active) {
        return
      }

      recordRoll(event.message, {
        source:
          event.message.payload.context?.kind === 'manual'
            ? 'manual'
            : 'forgesteel',
        visibility: event.visibility,
        player: event.player,
      })

      setBridgeStatus({
        state: 'received',
        message: `Shared roll received from ${
          event.player?.name || event.message.payload.actorName
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

  const latestRoll = useMemo(() => rolls.at(0), [rolls])
  const activePanelSize = panelSize

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
    const visibility: RollVisibility = manualHidden ? 'hidden' : 'public'
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

  return (
    <main className={`extension-shell ${isResizing ? 'resizing' : ''}`}>
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
        className={`panel panel-rolls ${activeTab === 'rolls' ? 'visible' : ''}`}
        aria-hidden={activeTab !== 'rolls'}
      >
        <div className="rolls-header">
          <div>
            <h2>Roll Feed</h2>
            <p>
              Shared table rolls from ForgeSteel and the manual roll panel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setManualPanelOpen((open) => !open)}
          >
            {manualPanelOpen ? 'Close Roller' : 'Table Roller'}
          </button>
        </div>

        {manualPanelOpen && (
          <section className="manual-roll-panel" aria-label="Manual roll panel">
            <div className="manual-roll-heading">
              <div>
                <h3>Table Roll</h3>
                <p>
                  {localPlayer ? `Rolling as ${localPlayer.name}` : 'Local roll'}
                </p>
              </div>
              <button
                type="button"
                className="roll-command"
                onClick={handleManualRoll}
              >
                Roll
              </button>
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

              <label className="control-group">
                <span>Modifier</span>
                <input
                  type="number"
                  value={manualModifier}
                  onChange={(event) => {
                    setManualModifier(Number(event.target.value || 0))
                  }}
                />
              </label>

              <div className="control-group control-group-wide">
                <span>Roll State</span>
                <div className="segmented-control roll-state-control">
                  {MANUAL_ROLL_STATES.map((state) => (
                    <button
                      key={state.value}
                      type="button"
                      className={manualRollState === state.value ? 'active' : ''}
                      aria-pressed={manualRollState === state.value}
                      onClick={() => setManualRollState(state.value)}
                    >
                      {state.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="hidden-toggle">
                <input
                  type="checkbox"
                  checked={manualHidden}
                  onChange={(event) => setManualHidden(event.target.checked)}
                />
                Hidden
              </label>
            </div>
          </section>
        )}

        {latestRoll && (
          <div className="latest-roll">
            <span>Latest</span>
            <strong>{latestRoll.actorName}</strong>
            <b>{latestRoll.total}</b>
          </div>
        )}

        {rolls.length === 0 ? (
          <div className="empty-state">
            <strong>No rolls yet</strong>
            <span>
              Use a local ForgeSteel bridge build or the dev test button to
              send roll events here.
            </span>
          </div>
        ) : (
          <ol className="roll-list">
            {rolls.map((roll) => (
              <li
                key={roll.id}
                className={`roll-card ${
                  roll.visibility === 'hidden' ? 'roll-card-hidden' : ''
                }`}
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
                    <span>{roll.source === 'manual' ? 'Manual' : 'ForgeSteel'}</span>
                    {roll.visibility === 'hidden' && <span>Hidden</span>}
                  </div>
                  <time dateTime={roll.timestamp}>
                    {formatRollTime(roll.timestamp)}
                  </time>
                </div>

                <div className="roll-card-main">
                  <div>
                    <strong>{roll.actorName}</strong>
                    <span>{roll.label}</span>
                  </div>
                  <b>{roll.total}</b>
                </div>

                <div className="roll-formula">
                  <span>{roll.formula}</span>
                </div>

                {roll.breakdown && <p>{roll.breakdown}</p>}

                {roll.context?.details && (
                  <div className="ability-details">
                    <div className="ability-title-row">
                      <strong>{roll.context.details.name || roll.label}</strong>
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
                        <span>Distance: {roll.context.details.distance}</span>
                      )}
                      {roll.context.details.target && (
                        <span>Target: {roll.context.details.target}</span>
                      )}
                      {roll.context.details.trigger && (
                        <span>Trigger: {roll.context.details.trigger}</span>
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
                          {roll.context.details.sections.map((section, index) => (
                            <div key={`${section.label}-${index}`}>
                              <strong>{section.label}</strong>
                              <span>{section.text}</span>
                            </div>
                          ))}
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
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="bottom-bar">
        <nav className="tabs" aria-label="Extension views">
          <button
            type="button"
            className={activeTab === 'forgesteel' ? 'active' : ''}
            onClick={() => setActiveTab('forgesteel')}
          >
            ForgeSteel
          </button>
          <button
            type="button"
            className={activeTab === 'rolls' ? 'active' : ''}
            onClick={() => setActiveTab('rolls')}
          >
            Rolls
            {rolls.length > 0 && <span>{rolls.length}</span>}
          </button>
        </nav>
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

      <button
        type="button"
        className="resize-grip"
        aria-label="Resize panel"
        title="Drag to resize panel"
        onPointerDown={handleResizeGripPointerDown}
      />
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
  const rolls = dice === '2d10' ? [rollD10(), rollD10()] : [rollD10()]
  const stateBonus = dice === '2d10' ? getRollStateBonus(rollState) : 0
  const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier + stateBonus
  const tier = dice === '2d10' ? getPowerRollTier(total, rollState) : undefined
  const formula = formatFormula(dice, modifier, stateBonus, rollState)
  const breakdownParts = [
    rolls.join(' + '),
    modifier !== 0 ? formatSignedNumber(modifier) : '',
    stateBonus !== 0
      ? `${formatSignedNumber(stateBonus)} ${getRollStateLabel(rollState)}`
      : '',
  ].filter(Boolean)

  return {
    type: 'FORGESTEEL_ROLL_RESULT',
    schemaVersion: 1,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'forgesteel',
    payload: {
      actorName: rollerName,
      label: dice === '2d10' ? 'Power Roll' : 'd10 Roll',
      formula,
      total,
      breakdown: `${breakdownParts.join(' ')} = ${total}${
        tier ? ` (Tier ${tier})` : ''
      }`,
      context: {
        kind: 'manual',
        details: {
          name: dice === '2d10' ? 'Manual Power Roll' : 'Manual d10 Roll',
          type: getRollStateLabel(rollState),
          tiers: tier
            ? [
                {
                  tier,
                  text: `Result landed in tier ${tier}.`,
                },
              ]
            : undefined,
        },
      },
    },
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

function getPowerRollTier(total: number, rollState: ManualRollState): 1 | 2 | 3 {
  let tier: 1 | 2 | 3 = total >= 17 ? 3 : total >= 12 ? 2 : 1

  if (rollState === 'doubleEdge' && tier < 3) {
    tier = (tier + 1) as 1 | 2 | 3
  }

  if (rollState === 'doubleBane' && tier > 1) {
    tier = (tier - 1) as 1 | 2 | 3
  }

  return tier
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

function getRollStateLabel(rollState: ManualRollState): string {
  return (
    MANUAL_ROLL_STATES.find((state) => state.value === rollState)?.label ||
    'Standard'
  )
}

function getPlayerName(roll: StoredRoll): string {
  if (roll.visibility === 'hidden') {
    return `${roll.player?.name || 'Local'} (hidden)`
  }

  return roll.player?.name || 'Unknown Player'
}

function getPlayerInitial(roll: StoredRoll): string {
  return getPlayerName(roll).trim().charAt(0).toUpperCase() || '?'
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
