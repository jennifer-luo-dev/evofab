// CurvatureTrendChart.tsx
// Results chart showing curvature before/after across all jobs in
// chronological order, used to spot drift over a series of experiments.

'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import type { ResultRecord } from '@/app/types/result'

interface CurvatureTrendChartProps {
  results: ResultRecord[]
}

/**
 * Area chart of curvature before/after across all jobs, in chronological order.
 * Renders nothing if fewer than two results exist — no trend to display.
 */
export function CurvatureTrendChart({ results }: CurvatureTrendChartProps) {
  if (results.length < 2) return null

  const data = results
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .filter((r) => r.curvature_before !== null && r.curvature_after !== null)
    .map((r, i) => ({
      job: `#${i + 1}`,
      before: Number((r.curvature_before ?? 0).toFixed(4)),
      after:  Number((r.curvature_after  ?? 0).toFixed(4)),
    }))

  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-5">
        Curvature Trend
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fillAfter" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00D4B4" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#00D4B4" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillBefore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis
            dataKey="job"
            tick={{ fill: '#5A6480', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#5A6480', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: '#0F1525',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: '#5A6480' }}
          />
          <Area type="monotone" dataKey="before" stroke="#3B82F6" fill="url(#fillBefore)" strokeWidth={1.5} dot={false} name="Before" />
          <Area type="monotone" dataKey="after"  stroke="#00D4B4" fill="url(#fillAfter)"  strokeWidth={2}   dot={{ r: 3, fill: '#00D4B4' }} name="After" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
