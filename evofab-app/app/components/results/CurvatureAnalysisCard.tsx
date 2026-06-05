import { ArcGauge } from '@/app/components/ui/ArcGauge'
import { ProgressBar } from '@/app/components/ui/ProgressBar'
import { cn } from '@/app/lib/utils'
import type { ResultRecord } from '@/app/types/result'

interface CurvatureAnalysisCardProps {
  result: ResultRecord
}

export function CurvatureAnalysisCard({ result }: CurvatureAnalysisCardProps) {
  const before = result.curvature_before ?? 0
  const after  = result.curvature_after  ?? 0
  const delta  = result.delta            ?? 0
  // delta_pct now comes directly from DB
  const pctChange = result.delta_pct !== null
    ? `${result.delta_pct >= 0 ? '+' : ''}${Number(result.delta_pct).toFixed(1)}%`
    : '—'
  const isPositive = delta >= 0

  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-5">
        Curvature Analysis
      </h3>

      <div className="flex items-center justify-around gap-4">
        <ArcGauge value={before} color="var(--color-blue)"  label="Before" animate />

        <div className={cn(
          'flex flex-col items-center gap-1 px-5 py-4 rounded-xl border',
          isPositive
            ? 'bg-green/5 border-green/20'
            : 'bg-red/5 border-red/20'
        )}>
          <span className="text-[10px] uppercase tracking-wider text-muted">Δ Change</span>
          <span className={cn('font-mono text-2xl font-bold', isPositive ? 'text-green' : 'text-red')}>
            {isPositive ? '+' : ''}{delta.toFixed(3)}
          </span>
          <span className={cn('font-mono text-sm', isPositive ? 'text-green' : 'text-red')}>
            {isPositive ? '▲' : '▼'} {pctChange}
          </span>
          {result.confidence !== null && (
            <span className="text-[10px] text-muted mt-1">
              Confidence: {(Number(result.confidence) * 100).toFixed(0)}%
            </span>
          )}
          {result.passed !== null && (
            <span className={cn(
              'text-[10px] font-semibold mt-0.5',
              result.passed ? 'text-green' : 'text-red'
            )}>
              {result.passed ? '✓ PASSED' : '✗ FAILED'}
            </span>
          )}
        </div>

        <ArcGauge value={after} color="var(--color-teal)" label="After" animate />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5">
        <div>
          <div className="flex justify-between text-[10px] text-muted mb-1">
            <span>Before</span>
            <span className="font-mono">{before.toFixed(4)} mm⁻¹</span>
          </div>
          <ProgressBar value={(before / 2) * 100} fillClassName="bg-blue" />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-muted mb-1">
            <span>After</span>
            <span className="font-mono">{after.toFixed(4)} mm⁻¹</span>
          </div>
          <ProgressBar value={(after / 2) * 100} />
        </div>
      </div>
    </div>
  )
}
