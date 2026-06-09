// MonitorClient.tsx
// Client-side monitor page for an active job. Subscribes to live job and
// printer status updates via Supabase Realtime, and connects directly to
// Moonraker's WebSocket for sub-second temperature and progress data.
// Robot arm status is read from RobotContext (no prop-drilling needed).

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase";
import { useJob } from "@/app/contexts/JobContext";
import { PipelineTracker } from "@/app/components/monitor/PipelineTracker";
import { PrinterMetricsCard } from "@/app/components/monitor/PrinterMetricsCard";
import { RobotArmCard } from "@/app/components/monitor/RobotArmCard";
import { ExperimentCard } from "@/app/components/monitor/ExperimentCard";
import { CameraFeedCard } from "@/app/components/monitor/CameraFeedCard";
import { MLCharacterizationCard } from "@/app/components/monitor/MLCharacterizationCard";
import { SystemLogCard } from "@/app/components/monitor/SystemLogCard";
import type { Job, LogEntry, PipelineStepId } from "@/app/types/job";
import type { PrinterStatus } from "@/app/types/printer";

const INACTIVE_STATUSES = new Set(["complete", "failed", "aborted"]);
const PRE_ML_STEPS = new Set<PipelineStepId>([
  "upload",
  "printing",
  "transfer",
  "experiment",
  "photobooth",
]);

interface Props {
  initialJob: Job;
  initialLogs: LogEntry[];
  initialPrinterStatus: PrinterStatus | null;
  streamUrl: string | null;
  moonrakerWsUrl: string | null;
}

export function MonitorClient({
  initialJob,
  initialLogs,
  initialPrinterStatus,
  streamUrl,
  moonrakerWsUrl,
}: Props) {
  const router = useRouter();
  const { dispatch } = useJob();
  const [job, setJob] = useState<Job>(initialJob);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(
    initialPrinterStatus,
  );
  const [moonrakerLayers, setMoonrakerLayers] = useState<{
    current: number | null;
    total: number | null;
  }>({ current: null, total: null });
  const [moonrakerProgress, setMoonrakerProgress] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!INACTIVE_STATUSES.has(job.status)) {
      dispatch({ type: "START_JOB", jobId: job.id });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to job updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`job:${job.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          const updated = payload.new as Job;
          setJob(updated);
          dispatch({
            type: "SET_STEP",
            step: updated.pipeline_step as PipelineStepId | null,
          });
          if (updated.status === "complete") {
            dispatch({ type: "COMPLETE_JOB" });
            router.push(`/results/${job.id}`);
          }
          if (updated.status === "aborted" || updated.status === "failed") {
            dispatch({ type: "ABORT_JOB" });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id, dispatch, router]);

  // Subscribe to printer_status for live temperatures
  useEffect(() => {
    if (!job.printer_id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`printer_status:${job.printer_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "printer_status",
          filter: `printer_id=eq.${job.printer_id}`,
        },
        (payload) => {
          setPrinterStatus(payload.new as PrinterStatus);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.printer_id]);

  // Direct Moonraker WebSocket — overrides Supabase values with sub-second fresh data
  useEffect(() => {
    if (!moonrakerWsUrl) return;

    const ws = new WebSocket(moonrakerWsUrl);
    // Track running totals for ETA estimate across partial notify_status_update payloads
    let lastProgress = 0;
    let lastPrintDuration = 0;

    function applyStatus(status: Record<string, Record<string, unknown>>) {
      const patch: Partial<PrinterStatus> = {};

      if (status.extruder) {
        if ("temperature" in status.extruder)
          patch.hotend_temp = status.extruder.temperature as number;
        if ("target" in status.extruder)
          patch.hotend_target = status.extruder.target as number;
      }
      if (status.heater_bed) {
        if ("temperature" in status.heater_bed)
          patch.bed_temp = status.heater_bed.temperature as number;
        if ("target" in status.heater_bed)
          patch.bed_target = status.heater_bed.target as number;
      }
      if (status.display_status && "progress" in status.display_status) {
        lastProgress = status.display_status.progress as number;
        setMoonrakerProgress(lastProgress * 100);
      }
      if (status.print_stats) {
        if ("print_duration" in status.print_stats) {
          lastPrintDuration = status.print_stats.print_duration as number;
        }
        const info = status.print_stats.info as
          | { current_layer?: number; total_layer?: number }
          | undefined;
        if (info?.current_layer != null || info?.total_layer != null) {
          setMoonrakerLayers((prev) => ({
            current: info?.current_layer ?? prev.current,
            total: info?.total_layer ?? prev.total,
          }));
        }
      }

      if (lastProgress > 0 && lastPrintDuration > 0) {
        patch.eta_seconds = Math.round(
          lastPrintDuration * (1 / lastProgress - 1),
        );
      }

      if (Object.keys(patch).length > 0) {
        setPrinterStatus((prev) => (prev ? { ...prev, ...patch } : prev));
      }
    }

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "printer.objects.subscribe",
          params: {
            objects: {
              extruder: null,
              heater_bed: null,
              display_status: null,
              print_stats: null,
            },
          },
          id: 1,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data);
      if (msg.result?.status) applyStatus(msg.result.status);
      if (msg.method === "notify_status_update") applyStatus(msg.params[0]);
    };

    return () => {
      ws.close();
    };
  }, [moonrakerWsUrl]);

  const jobActive = !INACTIVE_STATUSES.has(job.status);
  const isPhotoStep = job.pipeline_step === "photobooth";
  const mlStatus =
    !job.pipeline_step || PRE_ML_STEPS.has(job.pipeline_step)
      ? "pending"
      : job.pipeline_step === "ml"
        ? "running"
        : job.status === "complete"
          ? "done"
          : "pending";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <PipelineTracker currentStep={job.pipeline_step} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PrinterMetricsCard
          printerName={initialJob.printer_id ?? "—"}
          jobProgress={moonrakerProgress ?? job.print_progress}
          layerCurrent={moonrakerLayers.current ?? job.layer_current}
          layerTotal={moonrakerLayers.total ?? job.layer_total}
          printerStatus={printerStatus}
        />
        <RobotArmCard />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExperimentCard
          cycles={job.experiment_params?.cycles}
          pressure={job.experiment_params?.pressure_kpa}
        />
        <CameraFeedCard
          live={isPhotoStep}
          showCrosshair={isPhotoStep}
          streamUrl={streamUrl}
        />
      </div>

      <MLCharacterizationCard status={mlStatus} />

      <SystemLogCard
        jobId={job.id}
        initialLogs={initialLogs}
        jobActive={jobActive}
      />
    </div>
  );
}
