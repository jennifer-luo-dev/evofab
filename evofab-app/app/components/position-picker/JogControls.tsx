// JogControls.tsx
// Per-axis ± jog buttons for fine correction after a coarse pad drag, with a
// step-size selector. Step size is transient UI state, not part of the
// shared position — only the resulting position goes through onChange.

'use client'

import { useState } from 'react'
import type { AxisBounds, Position } from './positionMath'
import { clamp } from './positionMath'
import { JOG_STEP_OPTIONS } from './constants'

interface JogControlsProps {
  position: Position
  bounds: AxisBounds
  /** The robot's actual live TCP position, when known — jog steps from this rather than from
   * `position` so the step is exact regardless of whether `position` (the stored/typed target)
   * matches where the arm physically is, mirroring app/robot-test/page.tsx's handleJog. Falls
   * back to `position` when unknown (e.g. no machine selected yet, or not connected). */
  livePosition?: Position | null
  /** Called with the jogged position — the caller decides whether this also fires a live robot move (see MoveTargetModal, which treats every jog as discrete, exactly like app/robot-test/page.tsx's handleJog). */
  onChange: (next: Position) => void
  disabled?: boolean
}

const AXES = ['x', 'y', 'z'] as const

export function JogControls({ position, bounds, livePosition, onChange, disabled }: JogControlsProps) {
  const [step, setStep] = useState<number>(JOG_STEP_OPTIONS[0].value)

  function jog(axis: (typeof AXES)[number], direction: 1 | -1) {
    // Live axes are real -- the arm is physically there right now -- so they're stepped and sent
    // as-is; the bridge's own safety-plane check (see constants.ts's ROBOT_BOUNDS comment) is the
    // real authority on whether the result is reachable. Clamping to ROBOT_BOUNDS here too (as
    // this used to) would fight that: the placeholder box doesn't match the arm's real reach, so
    // a live axis already outside it would get snapped back to the boundary on every press. Only
    // the no-live-position fallback (nothing connected yet) still clamps, since `position` there
    // is a UI-only value with no real robot backing it.
    if (livePosition) {
      onChange({ ...livePosition, [axis]: livePosition[axis] + direction * step })
    } else {
      onChange({ ...position, [axis]: clamp(position[axis] + direction * step, bounds[axis]) })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Jog</span>
        <select
          value={step}
          onChange={(e) => setStep(parseFloat(e.target.value))}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-teal"
        >
          {JOG_STEP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {AXES.map((axis) => (
          <div key={axis} className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted uppercase tracking-wide">{axis}</span>
            <div className="flex gap-1 w-full">
              <button
                type="button"
                onClick={() => jog(axis, -1)}
                disabled={disabled}
                className="flex-1 rounded border border-border bg-surface px-2 py-1.5 text-sm font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => jog(axis, 1)}
                disabled={disabled}
                className="flex-1 rounded border border-border bg-surface px-2 py-1.5 text-sm font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
