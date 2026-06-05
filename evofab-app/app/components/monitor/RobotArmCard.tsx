import { MetricBox } from '@/app/components/ui/MetricBox'

interface RobotArmCardProps {
  program?: string
  executionStatus?: string
  payload?: string
  speed?: string
}

export function RobotArmCard({
  program = '—',
  executionStatus = 'idle',
  payload = '—',
  speed = '—',
}: RobotArmCardProps) {
  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Robot Arm
        </h3>
        <span className="font-mono text-xs text-[var(--color-teal)]">UR7e</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBox label="Program"   value={program} />
        <MetricBox label="Status"    value={executionStatus} />
        <MetricBox label="Payload"   value={payload} unit="kg" />
        <MetricBox label="Speed"     value={speed}   unit="%" />
      </div>
    </div>
  )
}
