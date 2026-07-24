// ZSlider.tsx
// Vertical range input for Z, meant to sit beside XYPad. Only ever touches
// the z field of shared position state. `onChange` fires continuously while
// dragging (for live visual feedback); `onCommit` fires once on release —
// the moment to fire a live robot move rather than one per drag tick.

'use client'

import type { SyntheticEvent } from 'react'
import { cn } from '@/app/lib/utils'
import type { Bounds } from './positionMath'

interface ZSliderProps {
  z: number
  bounds: Bounds
  onChange: (z: number) => void
  onCommit?: (z: number) => void
  disabled?: boolean
}

export function ZSlider({ z, bounds, onChange, onCommit, disabled }: ZSliderProps) {
  function commit(e: SyntheticEvent<HTMLInputElement>) {
    onCommit?.(parseFloat(e.currentTarget.value))
  }

  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <span className="text-[10px] uppercase tracking-widest text-muted font-medium">Z</span>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={0.005}
        value={z}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className={cn('accent-teal', disabled && 'opacity-50 cursor-not-allowed')}
        style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '1.25rem', flex: 1 }}
      />
      <span className="text-[11px] font-mono text-text tabular-nums">{z.toFixed(3)}m</span>
    </div>
  )
}
