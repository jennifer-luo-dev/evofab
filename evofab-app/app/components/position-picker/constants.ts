// constants.ts (position-picker)
// Workspace bounds and default poses for the robot-arm position picker.
// Conservative placeholders, not real UR7e kinematic limits — the FastAPI
// bridge's own safety-plane check (app/api/python/main.py _SAFETY_PLANES:
// east y<=0.25, south x<=0.20, table z>=0.025) remains the actual source of
// truth and will reject an out-of-bounds move regardless of what this picker
// allows. Swap these for per-machine reach limits once that's plumbed
// through machineRobotArm config.

import type { AxisBounds, Position } from './positionMath'

export const ROBOT_BOUNDS: AxisBounds = {
  x: { min: -0.5, max: 0.2 },
  y: { min: -0.5, max: 0.25 },
  z: { min: 0.025, max: 0.6 },
}

/** Matches app/robot-test/page.tsx's DEFAULT_TARGET — a known-safe idle pose. */
export const ROBOT_HOME_POSITION: Position = { x: 0.15, y: 0.15, z: 0.3 }

/** Jog step sizes, metres — mirrors app/robot-test/page.tsx's JOG_STEPS. */
export const JOG_STEP_OPTIONS = [
  { label: '1 mm', value: 0.001 },
  { label: '1 cm', value: 0.01 },
  { label: '5 cm', value: 0.05 },
] as const

/** XY-pad drag snap grid, metres (5 mm). */
export const XY_PAD_GRID_SIZE = 0.005
