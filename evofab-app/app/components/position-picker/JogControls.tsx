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
  /** Called with the jogged position — the caller decides whether this also fires a live robot move (see PositionPickerModal, which treats every jog as discrete, exactly like app/robot-test/page.tsx's handleJog). */
  onChange: (next: Position) => void
  disabled?: boolean
}

const AXES = ['x', 'y', 'z'] as const

export function JogControls({ position, bounds, onChange, disabled }: JogControlsProps) {
  const [step, setStep] = useState<number>(JOG_STEP_OPTIONS[0].value)

  function jog(axis: (typeof AXES)[number], direction: 1 | -1) {
    onChange({ ...position, [axis]: clamp(position[axis] + direction * step, bounds[axis]) })
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
