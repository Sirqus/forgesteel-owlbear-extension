import type { RollPlayer } from './logStorage'

export function isSameRollPlayer(
  left: RollPlayer | undefined,
  right: RollPlayer | undefined,
): boolean {
  if (!left || !right) {
    return false
  }

  if (left.connectionId && right.connectionId) {
    return left.connectionId === right.connectionId
  }

  if (left.id && right.id) {
    return left.id === right.id
  }

  return left.name === right.name
}
