// jointMath.ts
// Pure math for the joint-rotation dial: value<->fraction mapping over the
// dial's 270° sweep, and clamping. Kept free of React/DOM, mirroring
// positionMath.ts's own shape — separate from it since the dial's circular
// sweep<->angle mapping has no equivalent in the flat XY pad / Z slider.

export interface Bounds {
  min: number
  max: number
}

/** Dial sweep spans 270°, degrees, leaving a 90° dead zone centered at the bottom (180°/-180°) — a standard rotary-knob layout. */
const SWEEP_START_DEG = -135
const SWEEP_END_DEG = 135

/** Restricts `value` to `[bounds.min, bounds.max]`. */
export function clamp(value: number, bounds: Bounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

/** Fixed-decimal angle string for live readouts, with negative zero collapsed to
 * `0.0`. A joint resting on zero jitters by a few hundredths of a degree; without
 * this the readout flips between `-0.0°` and `0.0°` on every state push (wrist_3). */
export function formatAngle(deg: number, decimals = 1): string {
  const factor = 10 ** decimals
  const rounded = Math.round(deg * factor) / factor
  return (rounded === 0 ? 0 : rounded).toFixed(decimals)
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

/** Maps a fraction `[0, 1]` to the dial's sweep angle, degrees (screen-space: 0° = 3 o'clock, increasing clockwise). */
export function fractionToSweepAngle(fraction: number): number {
  return SWEEP_START_DEG + clamp(fraction, { min: 0, max: 1 }) * (SWEEP_END_DEG - SWEEP_START_DEG)
}

/**
 * Inverse of `fractionToSweepAngle` — given a raw pointer angle (atan2 degrees, any
 * range), returns its fraction along the sweep. An angle in the ~90° dead zone at
 * the bottom snaps to whichever end (0 or 1) it's nearer — the dead zone is
 * symmetric around ±180°, so the snap boundary is exactly that seam.
 */
export function sweepAngleToFraction(angleDeg: number): number {
  const a = (((angleDeg + 180) % 360) + 360) % 360 - 180 // normalize to (-180, 180]
  if (a > SWEEP_END_DEG) return 1
  if (a < SWEEP_START_DEG) return 0
  return (a - SWEEP_START_DEG) / (SWEEP_END_DEG - SWEEP_START_DEG)
}

/** Point on a circle of radius `r` centered at `(cx, cy)`, at screen-space angle `angleDeg`. */
export function pointOnCircle(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

export { SWEEP_START_DEG, SWEEP_END_DEG }
