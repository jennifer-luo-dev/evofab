// XYPad.tsx
// Top-down draggable pad for setting X/Y together: a square plane with a
// dashed reach-envelope overlay and a dot at the current target. Pointer
// events (not mouse events) so dragging works with touch too.

'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/app/lib/utils'
import type { AxisBounds, Position } from './positionMath'
import { clamp, fractionToValue, snapToGrid, valueToFraction } from './positionMath'
import { XY_PAD_GRID_SIZE } from './constants'

interface XYPadProps {
  position: Position
  bounds: AxisBounds
  onChange: (next: Pick<Position, 'x' | 'y'>) => void
  /** Fired once when the drag/click ends — the moment to fire a live robot move, rather than on every intermediate onChange tick during the drag. */
  onCommit?: (next: Pick<Position, 'x' | 'y'>) => void
  disabled?: boolean
}

export function XYPad({ position, bounds, onChange, onCommit, disabled }: XYPadProps) {
  const padRef = useRef<HTMLDivElement>(null)

  function computeFromPointer(clientX: number, clientY: number): Pick<Position, 'x' | 'y'> | null {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return null
    const fracX = clamp((clientX - rect.left) / rect.width, { min: 0, max: 1 })
    const fracY = clamp((clientY - rect.top) / rect.height, { min: 0, max: 1 })
    // Pad's vertical axis is inverted relative to Y — top of pad = max Y.
    const x = clamp(snapToGrid(fractionToValue(fracX, bounds.x), XY_PAD_GRID_SIZE), bounds.x)
    const y = clamp(snapToGrid(fractionToValue(1 - fracY, bounds.y), XY_PAD_GRID_SIZE), bounds.y)
    return { x, y }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const next = computeFromPointer(e.clientX, e.clientY)
    if (next) onChange(next)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || e.buttons !== 1) return
    const next = computeFromPointer(e.clientX, e.clientY)
    if (next) onChange(next)
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return
    const next = computeFromPointer(e.clientX, e.clientY)
    if (next) onCommit?.(next)
  }

  const dotLeftPct = valueToFraction(position.x, bounds.x) * 100
  const dotTopPct = (1 - valueToFraction(position.y, bounds.y)) * 100

  return (
    <div
      ref={padRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={cn(
        'relative w-full rounded-lg border border-border bg-surface cursor-crosshair select-none touch-none',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      style={{ aspectRatio: '1' }}
    >
      <div className="absolute inset-3 rounded-full border border-dashed border-border pointer-events-none" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-border pointer-events-none" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-border pointer-events-none" />
      <div
        className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal border-2 border-surface pointer-events-none"
        style={{ left: `${dotLeftPct}%`, top: `${dotTopPct}%` }}
      />
    </div>
  )
}
