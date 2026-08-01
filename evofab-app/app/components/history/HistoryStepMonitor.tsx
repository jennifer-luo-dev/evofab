// HistoryStepMonitor.tsx
// Read-only counterpart to PipelineBuilder's StepMonitorCard: renders the same "Now Running"
// live panel for whichever step a persisted run is currently on — sourced from polled
// machine_status.telemetry and live robot state via RobotContext, rather than the executing
// tab's own local state — so a run started in one tab stays observable from History in another.

'use client'

import { CameraFeedCard } from '@/app/components/monitor/CameraFeedCard'
import { PrinterMetricsCard } from '@/app/components/monitor/PrinterMetricsCard'
import { MetricBox } from '@/app/components/ui/MetricBox'
import { RobotStatusRow } from '@/app/components/ui/RobotStatusRow'
import { useRobot } from '@/app/contexts/RobotContext'
import { JOINT_LABELS } from '@/app/lib/robot'
import type { LiveStep } from './types'

interface HistoryStepMonitorProps {
  liveStep: LiveStep
}

function MonitorHeader({ label, machine }: { label: string; machine: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">Now Running</h2>
      <p className="text-[13.5px] text-text font-mono truncate">
        {machine} — {label}
      </p>
    </div>
  )
}

function RobotLiveMonitor({ liveStep }: { liveStep: Extract<LiveStep, { tech: 'robot_arm' }> }) {
  const robot = useRobot()
  const { machine, label, target } = liveStep

  return (
    <div className="flex flex-col gap-4">
      <MonitorHeader label={label} machine={machine} />

      <div className="rounded-lg border border-border bg-surface p-4 space-y-1 text-sm font-mono">
        <RobotStatusRow label="Connected" value={robot.connected} />
        <RobotStatusRow label="Moving" value={robot.is_moving} />
        <RobotStatusRow label="E-stop" value={robot.is_emergency_stopped} danger />
        <RobotStatusRow label="Protective stop" value={robot.is_protective_stopped} danger />
      </div>

      {target && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">Target</h3>
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
      )}

      {robot.tcp_pose && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">Live TCP</h3>
          <div className="grid grid-cols-3 gap-2">
            <MetricBox label="X" value={robot.tcp_pose[0].toFixed(3)} unit="m" />
            <MetricBox label="Y" value={robot.tcp_pose[1].toFixed(3)} unit="m" />
            <MetricBox label="Z" value={robot.tcp_pose[2].toFixed(3)} unit="m" />
          </div>
        </div>
      )}
    </div>
  )
}

function CameraLiveMonitor({ liveStep }: { liveStep: Extract<LiveStep, { tech: 'camera' }> }) {
  return (
    <div className="flex flex-col gap-4">
      <MonitorHeader label={liveStep.label} machine={liveStep.machine} />
      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono text-muted uppercase tracking-widest">capturing…</span>
        </div>
      </div>
    </div>
  )
}

function ClassificationLiveMonitor({
  liveStep,
}: {
  liveStep: Extract<LiveStep, { tech: 'classification_model' }>
}) {
  const { machine, label, sourceImageUrl } = liveStep
  return (
    <div className="flex flex-col gap-4">
      <MonitorHeader label={label} machine={machine} />
      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {sourceImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sourceImageUrl}
            alt="Classification source"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-muted uppercase tracking-widest">classifying…</span>
          </div>
        )}
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 flex items-center justify-between text-sm font-mono">
        <span className="text-muted">Status</span>
        <span className="text-muted">classifying…</span>
      </div>
    </div>
  )
}

function PrinterLiveMonitor({ liveStep }: { liveStep: Extract<LiveStep, { tech: 'printer' }> }) {
  const { machine, label, streamUrl, printerStatus } = liveStep
  return (
    <div className="flex flex-col gap-4">
      <MonitorHeader label={label} machine={machine} />
      <CameraFeedCard live streamUrl={streamUrl} label={`${machine} Webcam`} />
      <PrinterMetricsCard
        printerName={machine}
        jobProgress={printerStatus?.progress ?? 0}
        layerCurrent={printerStatus?.layer_current ?? null}
        layerTotal={printerStatus?.layer_total ?? null}
        printerStatus={printerStatus}
      />
    </div>
  )
}

/** Live "now executing" card for whichever step a persisted pipeline run is currently on — the History-page counterpart to StepMonitorCard. */
export function HistoryStepMonitor({ liveStep }: HistoryStepMonitorProps) {
  if (liveStep.tech === 'robot_arm') return <RobotLiveMonitor liveStep={liveStep} />
  if (liveStep.tech === 'camera') return <CameraLiveMonitor liveStep={liveStep} />
  if (liveStep.tech === 'classification_model') return <ClassificationLiveMonitor liveStep={liveStep} />
  return <PrinterLiveMonitor liveStep={liveStep} />
}
