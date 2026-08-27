// positionMath.ts
// Pure position math for the robot-arm position picker — clamping,
// pad-fraction <-> coordinate mapping, and grid snapping. Kept free of React
// and DOM so it's unit-testable on its own.

export interface Bounds {
  min: number
  max: number
}

export interface AxisBounds {
  x: Bounds
  y: Bounds
  z: Bounds
}

export interface Position {
  x: number
  y: number
  z: number
}

/** Rotation vector (radians) — same axis-angle representation as RTDE's TCP pose
 * (`rx`/`ry`/`rz`, see RobotContext's RobotState). Pinning this alongside a Cartesian
 * x/y/z target is what makes "the same position" actually reproducible — see
 * MoveTargetModal's OrientationFields. */
export interface Orientation {
  rx: number
  ry: number
  rz: number
}

/** Restricts `value` to `[bounds.min, bounds.max]`. */
export function clamp(value: number, bounds: Bounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

/** Clamps every axis of `pos` to its corresponding bound. */
export function clampPosition(pos: Position, bounds: AxisBounds): Position {
  return {
    x: clamp(pos.x, bounds.x),
    y: clamp(pos.y, bounds.y),
    z: clamp(pos.z, bounds.z),
  }
}

/** Rounds `value` to the nearest multiple of `gridSize` (metres). `gridSize <= 0` disables snapping. */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value
  return Math.round(value / gridSize) * gridSize
}

/** Maps a normalized `[0, 1]` fraction to a value within `bounds` (0 -> min, 1 -> max). */
export function fractionToValue(fraction: number, bounds: Bounds): number {
  return bounds.min + fraction * (bounds.max - bounds.min)
}

/** Inverse of `fractionToValue` — maps a value within `bounds` back to `[0, 1]`. */
export function valueToFraction(value: number, bounds: Bounds): number {
  const span = bounds.max - bounds.min
  if (span === 0) return 0
  return (value - bounds.min) / span
}
