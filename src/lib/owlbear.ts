import OBR from '@owlbear-rodeo/sdk'

const ROLL_CHANNEL = 'net.forgesteel.owlbear.rolls.v1'

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

export async function broadcastRoll(data: unknown): Promise<void> {
  if (!OBR.isAvailable || !OBR.isReady) {
    return
  }

  try {
    await OBR.broadcast.sendMessage(ROLL_CHANNEL, data, {
      destination: 'ALL',
    })
  } catch (error) {
    console.warn('Unable to broadcast ForgeSteel roll.', error)
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

function waitForOwlbearReady(): Promise<void> {
  if (OBR.isReady) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    OBR.onReady(resolve)
  })
}
