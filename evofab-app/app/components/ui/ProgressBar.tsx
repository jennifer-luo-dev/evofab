import { cn } from '@/app/lib/utils'

interface ProgressBarProps {
  value: number
  className?: string
  trackClassName?: string
  fillClassName?: string
  height?: 'sm' | 'md'
}

export function ProgressBar({
  value,
  className,
  trackClassName,
  fillClassName,
  height = 'sm',
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn(
        'w-full rounded-full overflow-hidden bg-white/5',
        height === 'sm' ? 'h-1' : 'h-1.5',
        trackClassName,
        className
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          'bg-[var(--color-teal)]',
          fillClassName
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
