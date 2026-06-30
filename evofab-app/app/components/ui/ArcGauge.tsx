'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/app/lib/utils'

interface ArcGaugeProps {
  value: number
  maxValue?: number
  color?: string
  label?: string
  size?: number
  strokeWidth?: number
  className?: string
  animate?: boolean
}

export function ArcGauge({
  value,
  maxValue = 2,
  color = 'var(--color-teal)',
  label,
  size = 120,
  strokeWidth = 8,
  className,
  animate = true,
}: ArcGaugeProps) {
  const [displayed, setDisplayed] = useState(animate ? 0 : value)
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    if (!animate) {
      setDisplayed(value)
      return
    }
    const start = performance.now()
    const duration = 1000
    const from = 0
    const to = value

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(from + (to - from) * eased)
      if (progress < 1) {
        animRef.current = requestAnimationFrame(step)
      }
    }
    animRef.current = requestAnimationFrame(step)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [value, animate])

  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const startAngle = -220
  const sweepAngle = 260
  const fraction = Math.min(displayed / maxValue, 1)
  const angle = startAngle + sweepAngle * fraction

  const trackPath = describeArc(cx, cy, radius, startAngle, startAngle + sweepAngle)
  const fillPath = fraction > 0
    ? describeArc(cx, cy, radius, startAngle, angle)
    : ''

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} strokeLinecap="round" />
        {fillPath && (
          <path d={fillPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" className="font-mono" fill="var(--color-text)" fontSize="18" fontWeight="600">
          {displayed.toFixed(2)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="text-muted" fontSize="10">
          mm⁻¹
        </text>
      </svg>
      {label && (
        <span className="text-xs text-[var(--color-muted)] uppercase tracking-wider">{label}</span>
      )}
    </div>
  )
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180
  const sx = cx + r * Math.cos(toRad(startDeg))
  const sy = cy + r * Math.sin(toRad(startDeg))
  const ex = cx + r * Math.cos(toRad(endDeg))
  const ey = cy + r * Math.sin(toRad(endDeg))
  const sweep = endDeg - startDeg > 180 ? 1 : 0
  return `M ${sx} ${sy} A ${r} ${r} 0 ${sweep} 1 ${ex} ${ey}`
}
