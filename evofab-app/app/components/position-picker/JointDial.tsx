// JointDial.tsx
// Circular drag control for one joint's angle — the joint-space analog of
// ZSlider, but a rotary dial rather than a linear range input since a joint
// angle is a 1D rotational value, not a position along a line. Pointer
// events (not mouse events) so dragging works with touch too, mirroring
// XYPad's pointer-capture approach.

'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/app/lib/utils'
import {
  clamp,
  fractionToSweepAngle,
  fractionToValue,
  pointOnCircle,
  sweepAngleToFraction,
  valueToFraction,
  type Bounds,
} from './jointMath'

interface JointDialProps {
  value: number
  bounds: Bounds
  /** Fires continuously during a drag — live preview only, never a robot move (mirrors XYPad/ZSlider's onChange). */
  onChange: (value: number) => void
  /** Fires once when the drag ends — the moment to fire a live robot move (mirrors XYPad/ZSlider's onCommit). */
  onCommit?: (value: number) => void
  disabled?: boolean
  size?: number
}

export function JointDial({ value, bounds, onChange, onCommit, disabled, size = 64 }: JointDialProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  function valueFromPointer(clientX: number, clientY: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return value
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const angleDeg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI
    const fraction = sweepAngleToFraction(angleDeg)
    return clamp(fractionToValue(fraction, bounds), bounds)
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(valueFromPointer(e.clientX, e.clientY))
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || e.buttons !== 1) return
    onChange(valueFromPointer(e.clientX, e.clientY))
  }

  function handlePointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled) return
    onCommit?.(valueFromPointer(e.clientX, e.clientY))
  }

  const cx = size / 2
  const cy = size / 2
  const r = size * 0.4
  const fraction = valueToFraction(value, bounds)

  const start = pointOnCircle(cx, cy, r, -135)
  const end = pointOnCircle(cx, cy, r, 135)
  const trackPath = `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`

  const progressAngle = fractionToSweepAngle(fraction)
  const progressPoint = pointOnCircle(cx, cy, r, progressAngle)
  const progressLargeArc = progressAngle - -135 > 180 ? 1 : 0
  const progressPath =
    fraction > 0
      ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${progressLargeArc} 1 ${progressPoint.x} ${progressPoint.y}`
      : ''

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={cn(
        'shrink-0 touch-none select-none',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
      )}
    >
      <path d={trackPath} fill="none" stroke="var(--color-border)" strokeWidth={4} strokeLinecap="round" />
      {progressPath && (
        <path d={progressPath} fill="none" stroke="var(--color-teal)" strokeWidth={4} strokeLinecap="round" />
      )}
      <circle cx={progressPoint.x} cy={progressPoint.y} r={4} className="fill-teal stroke-surface" strokeWidth={2} />
    </svg>
  )
}
