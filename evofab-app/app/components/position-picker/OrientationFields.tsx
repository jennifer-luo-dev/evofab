// OrientationFields.tsx
// Optional Rx/Ry/Rz (rotation vector, radians) fields for a Cartesian move
// target — off by default, mirroring JointRow's active-checkbox pattern.
// A target that never pins orientation keeps the bridge's original
// behavior: it inherits whatever orientation the arm is already in when the
// move executes (see main.py's _execute_cartesian_move). Checking "Pin
// Orientation" seeds from the arm's live pose so a fresh pin starts at
// wherever the tool currently points, rather than an arbitrary (0, 0, 0).
// Like LinkedCoordinateFields, typed entry here is UI-only — it never fires
// a live move.

'use client'

import { cn } from '@/app/lib/utils'
import type { Orientation } from './positionMath'

interface OrientationFieldsProps {
  /** `null` = not pinned (inherit orientation at move time). */
  orientation: Orientation | null
  /** The arm's live orientation, used to seed a fresh pin — `null` while disconnected/unknown. */
  liveOrientation: Orientation | null
  onChange: (next: Orientation | null) => void
}

const AXES = ['rx', 'ry', 'rz'] as const

export function OrientationFields({ orientation, liveOrientation, onChange }: OrientationFieldsProps) {
  const active = orientation !== null

  function toggle() {
    onChange(active ? null : (liveOrientation ?? { rx: 0, ry: 0, rz: 0 }))
  }

  function commit(axis: (typeof AXES)[number], raw: string) {
    if (!orientation) return
    const parsed = parseFloat(raw)
    onChange({ ...orientation, [axis]: Number.isFinite(parsed) ? parsed : 0 })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted font-medium">
        <input type="checkbox" checked={active} onChange={toggle} className="accent-teal h-3.5 w-3.5" />
        Pin Orientation
      </label>
      <div className="grid grid-cols-3 gap-2.5">
        {AXES.map((axis) => (
          <label key={axis} className={cn('flex flex-col gap-1', !active && 'opacity-50')}>
            <span className="text-[10px] uppercase tracking-wide text-muted font-medium">{axis} (rad)</span>
            <input
              type="number"
              step="0.001"
              disabled={!active}
              value={orientation ? orientation[axis] : 0}
              onChange={(e) => commit(axis, e.target.value)}
              className="rounded border border-border bg-surface px-2 py-2 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal disabled:opacity-50"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
