// StepMonitorCard.tsx
// Right-side "now executing" panel shown while Run Pipeline is on a
// `printer` step (live camera feed, print progress/temps, expected total
// print time), a `robot_arm` Move step (target coordinates and live TCP
// pose/status from RobotContext's `/ws/robot` feed), a `camera` Capture step
// (the resulting photo, once the bridge responds), or a
// `classification_model` Classify step (source photo and the curvature-vision
// pipeline's result, once the classification bridge responds).

'use client'

import { CameraFeedCard } from '@/app/components/monitor/CameraFeedCard'
import { PrinterMetricsCard } from '@/app/components/monitor/PrinterMetricsCard'
import { MetricBox } from '@/app/components/ui/MetricBox'
import { RobotStatusRow } from '@/app/components/ui/RobotStatusRow'
import { useRobot } from '@/app/contexts/RobotContext'
import { JOINT_LABELS, type MoveResult, type MoveTargetBody } from '@/app/lib/robot'
import type { PrinterWithStatus } from '@/app/types/printer'

export interface RunningPrinterState {
  kind: 'printer'
  printer: PrinterWithStatus
  fileName: string
  streamUrl: string | null
  startedAt: number
  /**
   * The slicer's own estimate from Moonraker's file metadata (`estimated_time`), once known —
   * authoritative when present. Moonraker's metadata scan can lag slightly behind upload, so
   * this starts null and is filled in shortly after the print starts.
   */
  slicerEstimatedSeconds: number | null
  /** Elapsed-so-far extrapolated by current progress; used only until the slicer estimate arrives. */
  extrapolatedSeconds: number | null
}

export interface RunningRobotState {
  kind: 'robot'
  machineName: string
  /** Cartesian or joint-space target — the same discriminated body sent to POST /api/robot-move. */
  target: MoveTargetBody
  startedAt: number
  /** `null` while the move request is in flight — filled in once the bridge responds (mirrors ClassificationMonitor's same null-until-resolved pattern). */
  result: MoveResult | null
}

export interface RunningCameraState {
  kind: 'camera'
  machineName: string
  startedAt: number
  /** `null` while the capture request is in flight. */
  imageUrl: string | null
}

/** Curvature-vision pipeline's result for a `classification_model` step — mirrors app/api/python/main.py's POST /classify response (and action_types.output_schema for "classify"). `null` fields mean the fit didn't converge (`analysis_status` other than `TRACKING`). */
export interface ClassificationResult {
  analysis_status: string
  mean_curvature: number | null
  bend_angle_deg: number | null
  radius_mm: number | null
  ppm_used: number
  actuator_length_mm: number
  /** Annotated (mask/skeleton/fit overlay) version of the source photo, once the bridge responds. */
  image_url: string | null
}

export interface RunningClassificationState {
  kind: 'classification'
  machineName: string
  /** The photo being classified — `outputs.image_keys[0]` from the referenced camera step. */
  sourceImageUrl: string
  startedAt: number
  /** `null` while the classification request is in flight. */
  result: ClassificationResult | null
}

export type RunningStepState =
  | RunningPrinterState
  | RunningRobotState
  | RunningCameraState
  | RunningClassificationState

interface StepMonitorCardProps {
  running: RunningStepState
}

/** Formats seconds into a human-readable duration ("1h 23m" or "45m"). Returns "—" for null. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Live "now executing" card for whichever step type Run Pipeline is currently on. */
export function StepMonitorCard({ running }: StepMonitorCardProps) {
  if (running.kind === 'robot') return <RobotMonitor running={running} />
  if (running.kind === 'camera') return <CameraMonitor running={running} />
  if (running.kind === 'classification') return <ClassificationMonitor running={running} />

  const { printer, fileName, streamUrl, slicerEstimatedSeconds, extrapolatedSeconds } = running
  const totalExpectedSeconds = slicerEstimatedSeconds ?? extrapolatedSeconds

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">
          Now Running
        </h2>
        <p className="text-[13.5px] text-text font-mono truncate">{fileName}</p>
      </div>

      <CameraFeedCard live streamUrl={streamUrl} />

      <PrinterMetricsCard
        printerName={printer.name}
        jobProgress={printer.printer_status?.progress ?? 0}
        layerCurrent={printer.printer_status?.layer_current ?? null}
        layerTotal={printer.printer_status?.layer_total ?? null}
        printerStatus={printer.printer_status}
      />

      <MetricBox
        label={slicerEstimatedSeconds !== null ? 'Total Time Expected' : 'Total Time Expected (est.)'}
        value={formatDuration(totalExpectedSeconds)}
      />
    </div>
  )
}

/** Live "now executing" card for a robot_arm Move step (Cartesian or joint-space): target, live TCP/joint telemetry from RobotContext, and the bridge's final result once resolved. */
function RobotMonitor({ running }: { running: RunningRobotState }) {
  const robot = useRobot()
  const { machineName, target, result } = running

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">
          Now Running
        </h2>
        <p className="text-[13.5px] text-text font-mono truncate">
          {machineName} — {target.target_type === 'cartesian' ? 'Move' : `Rotate (${target.mode})`}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 space-y-1 text-sm font-mono">
        <RobotStatusRow label="Connected" value={robot.connected} />
        <RobotStatusRow label="Moving" value={robot.is_moving} />
        <RobotStatusRow label="E-stop" value={robot.is_emergency_stopped} danger />
        <RobotStatusRow label="Protective stop" value={robot.is_protective_stopped} danger />
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">
          Target
        </h3>
        {target.target_type === 'cartesian' ? (
          <div className="grid grid-cols-3 gap-2">
            <MetricBox label="X" value={target.position.x.toFixed(3)} unit="m" />
            <MetricBox label="Y" value={target.position.y.toFixed(3)} unit="m" />
            <MetricBox label="Z" value={target.position.z.toFixed(3)} unit="m" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {target.joints.map((j) => (
              <MetricBox key={j.joint} label={JOINT_LABELS[j.joint]} value={j.angle_deg.toFixed(1)} unit="°" />
            ))}
          </div>
        )}
      </div>

      {robot.tcp_pose && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">
            Live TCP
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <MetricBox label="X" value={robot.tcp_pose[0].toFixed(3)} unit="m" />
            <MetricBox label="Y" value={robot.tcp_pose[1].toFixed(3)} unit="m" />
            <MetricBox label="Z" value={robot.tcp_pose[2].toFixed(3)} unit="m" />
          </div>
        </div>
      )}

      {result && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">
            Result
          </h3>
          <div className="rounded-lg border border-border bg-surface p-3 flex items-center justify-between text-sm font-mono">
            <span className="text-muted">Status</span>
            <span className={result.status === 'success' ? 'text-teal' : 'text-amber-400'}>{result.status}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Live "now executing" card for a camera Capture step: shows the resulting photo once the bridge responds. */
function CameraMonitor({ running }: { running: RunningCameraState }) {
  const { machineName, imageUrl } = running

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">
          Now Running
        </h2>
        <p className="text-[13.5px] text-text font-mono truncate">{machineName} — Capture</p>
      </div>

      <div
        className="relative w-full bg-black rounded-lg overflow-hidden"
        style={{ aspectRatio: '16/9' }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Camera capture"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-muted uppercase tracking-widest">
              capturing…
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Live "now executing" card for a classification_model Classify step: the source photo, and once the bridge responds, its annotated result and curvature metrics. */
function ClassificationMonitor({ running }: { running: RunningClassificationState }) {
  const { machineName, sourceImageUrl, result } = running
  const displayImageUrl = result?.image_url ?? sourceImageUrl
  const statusColor = !result ? 'text-muted' : result.analysis_status === 'TRACKING' ? 'text-teal' : 'text-amber-400'

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">
          Now Running
        </h2>
        <p className="text-[13.5px] text-text font-mono truncate">{machineName} — Classify</p>
      </div>

      <div
        className="relative w-full bg-black rounded-lg overflow-hidden"
        style={{ aspectRatio: '16/9' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayImageUrl}
          alt="Classification photo"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 flex items-center justify-between text-sm font-mono">
        <span className="text-muted">Status</span>
        <span className={statusColor}>{result ? result.analysis_status : 'classifying…'}</span>
      </div>

      {result?.analysis_status === 'TRACKING' && (
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="Curvature" value={result.mean_curvature?.toFixed(2) ?? '—'} unit="1/m" />
          <MetricBox label="Bend Angle" value={result.bend_angle_deg?.toFixed(1) ?? '—'} unit="°" />
          <MetricBox label="Radius" value={result.radius_mm?.toFixed(0) ?? '—'} unit="mm" />
        </div>
      )}
    </div>
  )
}
