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
  listenForForgeSteelMessages,
  postDefaultOptionsToForgeSteel,
  postLocalTestRoll,
} from './lib/bridge'
import {
  appendRoll,
  loadStoredRolls,
  saveStoredRolls,
  type StoredRoll,
} from './lib/rollStorage'
import {
  broadcastRoll,
  initializeOwlbear,
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

type PanelSize = {
  label: string
  width: number
  height: number
}

type BridgeStatus = {
  state: 'waiting' | 'ready' | 'received' | 'rejected'
  message: string
}

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
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let active = true

    initializeOwlbear().then((status) => {
      if (active) {
        setOwlbearStatus(status)
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

        setRolls((currentRolls) => {
          const nextRolls = appendRoll(currentRolls, event.message)
          saveStoredRolls(nextRolls)
          return nextRolls
        })
        setBridgeStatus({
          state: 'received',
          message: `Roll received from ${event.message.payload.actorName}.`,
        })
        void broadcastRoll(event.message)
      },
      onReject: (event) => {
        setBridgeStatus({
          state: 'rejected',
          message: rejectMessage(event),
        })
      },
    })
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
        <div className="roll-toolbar">
          <div>
            <h2>Roll Feed</h2>
            <p>
              Bridge-ready feed for ForgeSteel
              <code> FORGESTEEL_ROLL_RESULT </code>
              messages.
            </p>
          </div>
          {import.meta.env.DEV && (
            <button type="button" onClick={postLocalTestRoll}>
              Add Test Roll
            </button>
          )}
        </div>

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
              <li key={roll.id}>
                <div className="roll-main">
                  <strong>{roll.actorName}</strong>
                  <span>{roll.label}</span>
                </div>
                <div className="roll-result">
                  <span>{roll.formula}</span>
                  <b>{roll.total}</b>
                </div>
                {roll.breakdown && <p>{roll.breakdown}</p>}
                <time dateTime={roll.timestamp}>
                  {new Intl.DateTimeFormat(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }).format(new Date(roll.timestamp))}
                </time>
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
