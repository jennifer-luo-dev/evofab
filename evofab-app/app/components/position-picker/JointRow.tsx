// JointRow.tsx
// One row per joint in the joint-space move view: a checkbox that activates
// the row (unlisted/inactive joints hold their current position, mirroring
// the backend's "only include joints being changed" contract), a dial +
// linked numeric field (same linked-field pattern as ZSlider/
// LinkedCoordinateFields), and ±1°/±5°/±15° jog buttons.
//
// Typed numeric entry is UI-only (never fires a live move), matching
// LinkedCoordinateFields; the dial's release and every jog press do fire one
// (mirrors XYPad/ZSlider/JogControls) — the caller decides what that move
// looks like via onCommit.

'use client'

import { cn } from '@/app/lib/utils'
import type { JointName } from '@/app/lib/robot'
import { JointDial } from './JointDial'
import { JOINT_JOG_STEP_OPTIONS } from './constants'
import { clamp, type Bounds } from './jointMath'

interface JointRowProps {
  joint: JointName
  label: string
  active: boolean
  /** Degrees — a target angle in absolute mode, a delta in relative mode. */
  value: number
  bounds: Bounds
  mode: 'absolute' | 'relative'
  /** Live actual angle from RobotContext, degrees — `null` while disconnected/unknown. */
  liveAngleDeg: number | null
  disabled?: boolean
  onToggleActive: () => void
  onChange: (value: number) => void
  onCommit: (value: number) => void
}

export function JointRow({
  joint,
  label,
  active,
  value,
  bounds,
  mode,
  liveAngleDeg,
  disabled,
  onToggleActive,
  onChange,
  onCommit,
}: JointRowProps) {
  const rowDisabled = disabled || !active

  function jog(direction: 1 | -1, step: number) {
    onCommit(clamp(value + direction * step, bounds))
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border border-border p-2',
        !active && 'opacity-50'
      )}
    >
      <input
        type="checkbox"
        checked={active}
        onChange={onToggleActive}
        className="accent-teal h-4 w-4 shrink-0"
        aria-label={`Rotate ${label}`}
      />

      <div className="w-19 shrink-0">
        <div className="text-xs font-semibold text-text">{label}</div>
        <div className="text-[10px] text-muted font-mono">
          {liveAngleDeg != null ? `${liveAngleDeg.toFixed(1)}°` : '—'}
        </div>
      </div>

      <JointDial value={value} bounds={bounds} onChange={onChange} onCommit={onCommit} disabled={rowDisabled} />

      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          value={value}
          disabled={rowDisabled}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value)
            onChange(clamp(Number.isFinite(parsed) ? parsed : 0, bounds))
          }}
          className="w-18 rounded border border-border bg-surface px-2 py-1.5 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal disabled:opacity-50"
        />
        <span className="text-xs text-muted">{mode === 'relative' ? 'Δ°' : '°'}</span>
      </div>

      <div className="flex gap-1 ml-auto">
        {JOINT_JOG_STEP_OPTIONS.map((opt) => (
          <div key={opt.value} className="flex flex-col gap-0.5">
            <button
              type="button"
              disabled={rowDisabled}
              onClick={() => jog(1, opt.value)}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +{opt.label}
            </button>
            <button
              type="button"
              disabled={rowDisabled}
              onClick={() => jog(-1, opt.value)}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −{opt.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
