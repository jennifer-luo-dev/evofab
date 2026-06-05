import { MetricBox } from '@/app/components/ui/MetricBox'
import { cn } from '@/app/lib/utils'

type MLStatus = 'pending' | 'running' | 'done' | 'error'

interface MLCharacterizationCardProps {
  status?: MLStatus
  script?: string
  method?: string
  inputFile?: string
}

const statusLabel: Record<MLStatus, string> = {
  pending: 'Pending',
  running: 'Running...',
  done:    'Done',
  error:   'Error',
}

const statusColor: Record<MLStatus, string> = {
  pending: 'text-[var(--color-muted)]',
  running: 'text-[var(--color-amber)]',
  done:    'text-[var(--color-green)]',
  error:   'text-[var(--color-red)]',
}

export function MLCharacterizationCard({
  status = 'pending',
  script = '—',
  method = 'OpenCV arc fit',
  inputFile = '—',
}: MLCharacterizationCardProps) {
  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          ML Characterization
        </h3>
        <span className={cn('font-mono text-xs font-medium', statusColor[status])}>
          {statusLabel[status]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBox label="Script"    value={script} />
        <MetricBox label="Method"    value={method} />
        <MetricBox label="Input"     value={inputFile} />
        <MetricBox label="Status"    value={statusLabel[status]} valueClassName={statusColor[status]} />
      </div>
    </div>
  )
}
