// LinkedCoordinateFields.tsx
// Three X/Y/Z number inputs, controlled from the shared position-picker
// state — always reflects the current target, whether it last changed via
// typing here, the XY pad, the Z slider, or a jog button.

'use client'

import type { AxisBounds, Position } from './positionMath'
import { clamp } from './positionMath'

interface LinkedCoordinateFieldsProps {
  position: Position
  bounds: AxisBounds
  onChange: (next: Position) => void
}

const AXES = ['x', 'y', 'z'] as const

export function LinkedCoordinateFields({ position, bounds, onChange }: LinkedCoordinateFieldsProps) {
  function commit(axis: (typeof AXES)[number], raw: string) {
    const parsed = parseFloat(raw)
    const value = clamp(Number.isFinite(parsed) ? parsed : 0, bounds[axis])
    onChange({ ...position, [axis]: value })
  }

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {AXES.map((axis) => (
        <label key={axis} className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted font-medium">
            {axis.toUpperCase()} (m)
          </span>
          <input
            type="number"
            step="0.001"
            value={position[axis]}
            onChange={(e) => commit(axis, e.target.value)}
            className="rounded border border-border bg-surface px-2 py-2 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal"
          />
        </label>
      ))}
    </div>
  )
}
