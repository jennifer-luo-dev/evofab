import { cn } from '@/app/lib/utils'

interface MetricBoxProps {
  label: string
  value: string | number
  unit?: string
  className?: string
  valueClassName?: string
}

/** Labelled metric tile used across monitor, robot-arm, and result cards. */
export function MetricBox({ label, value, unit, className, valueClassName }: MetricBoxProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-3 rounded-lg bg-white/[0.03] border border-[var(--color-border)]',
        className
      )}
    >
      <span className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] font-medium">
        {label}
      </span>
      <span className={cn('font-mono text-sm text-[var(--color-text)]', valueClassName)}>
        {value}
        {unit && <span className="text-[var(--color-muted)] ml-0.5 text-xs">{unit}</span>}
      </span>
    </div>
  )
}
