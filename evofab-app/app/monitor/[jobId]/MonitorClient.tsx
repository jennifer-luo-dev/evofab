"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
import { RuntimeOverridePanel } from "@/app/components/monitor/RuntimeOverridePanel";
import { appendTemperaturePoint } from "@/app/lib/temperature-series";
import type { Job, LogEntry, PipelineStepId } from "@/app/types/job";
import type { PrinterStatus } from "@/app/types/printer";

const TemperatureChart = dynamic(
  () =>
    import("@/app/components/monitor/TemperatureChart").then(
      (module) => module.TemperatureChart,
    ),
  { ssr: false },
);

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
}

export function MonitorClient({
  initialJob,
  initialLogs,
  initialPrinterStatus,
}: Props) {
  const router = useRouter();
  const { dispatch } = useJob();
  const [job, setJob] = useState<Job>(initialJob);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(
    initialPrinterStatus,
  );
  const [temperatureSeries, setTemperatureSeries] = useState(() =>
    appendTemperaturePoint([], initialPrinterStatus),
  );
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);

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
          const nextStatus = payload.new as PrinterStatus;
          setPrinterStatus(nextStatus);
          setTemperatureSeries((series) =>
            appendTemperaturePoint(series, nextStatus),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.printer_id]);

  const jobActive = !INACTIVE_STATUSES.has(job.status);
  const printerFaulted = printerStatus?.status === "error";
  const isPhotoStep = job.pipeline_step === "photobooth";
  const mlStatus =
    !job.pipeline_step || PRE_ML_STEPS.has(job.pipeline_step)
      ? "pending"
      : job.pipeline_step === "ml"
        ? "running"
        : job.status === "complete"
          ? "done"
          : "pending";

  async function runJobControl(
    action:
      | "pause"
      | "resume"
      | "cancel"
      | "emergency_stop"
      | "restart"
      | "firmware_restart",
  ) {
    if (controlBusy) return;

    const body: Record<string, unknown> = { action };
    if (action === "cancel") {
      if (!window.confirm("Cancel this print job?")) return;
      body.confirmed = true;
    }

    if (action === "restart" || action === "firmware_restart") {
      const expected = action === "restart" ? "RESTART" : "FIRMWARE_RESTART";
      const typed = window.prompt(`Type ${expected} to continue.`);
      if (typed !== expected) {
        setControlMessage(`${expected} was not confirmed.`);
        return;
      }
      body.confirmation = expected;
    }

    setControlBusy(true);
    setControlMessage(null);

    try {
      const response = await fetch(`/api/jobs/${job.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Printer control failed.");
      }
      setControlMessage("Command accepted.");
    } catch (error) {
      setControlMessage(
        error instanceof Error ? error.message : "Printer control failed.",
      );
    } finally {
      setControlBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <PipelineTracker currentStep={job.pipeline_step} />

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Print Controls
            </h2>
            <p className="mt-1 text-xs text-muted">
              {printerStatus?.print_state ?? job.status}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runJobControl("pause")}
              disabled={
                !jobActive ||
                controlBusy ||
                printerStatus?.status !== "printing"
              }
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              Pause
            </button>
            <button
              onClick={() => runJobControl("resume")}
              disabled={
                !jobActive || controlBusy || printerStatus?.status !== "paused"
              }
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              Resume
            </button>
            <button
              onClick={() => runJobControl("cancel")}
              disabled={!jobActive || controlBusy}
              className="rounded-md border border-amber/50 bg-amber/10 px-3 py-1.5 text-xs font-semibold text-amber transition-colors hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => runJobControl("emergency_stop")}
              disabled={!jobActive || controlBusy}
              className="rounded-md border border-red/50 bg-red/10 px-3 py-1.5 text-xs font-semibold text-red transition-colors hover:bg-red/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              software e-stop
            </button>
            <button
              onClick={() => runJobControl("restart")}
              disabled={!printerFaulted || controlBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              RESTART
            </button>
            <button
              onClick={() => runJobControl("firmware_restart")}
              disabled={!printerFaulted || controlBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              FIRMWARE_RESTART
            </button>
          </div>
        </div>
        {controlMessage && (
          <p className="mt-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
            {controlMessage}
          </p>
        )}
        {printerStatus?.fault_message && (
          <div className="mt-3 rounded-md border border-red/30 bg-red/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-red">
              Klipper fault
              {printerStatus.fault_mcu ? ` · ${printerStatus.fault_mcu}` : ""}
            </p>
            <p className="mt-1 text-sm text-red">
              {printerStatus.fault_message}
            </p>
          </div>
        )}
      </section>

      <RuntimeOverridePanel
        jobId={job.id}
        jobActive={jobActive}
        printerStatus={printerStatus}
      />

      <TemperatureChart series={temperatureSeries} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PrinterMetricsCard
          printerName={initialJob.printer_id ?? "—"}
          jobProgress={job.print_progress}
          layerCurrent={job.layer_current}
          layerTotal={job.layer_total}
          printerStatus={printerStatus}
        />
        <RobotArmCard />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExperimentCard
          cycles={job.experiment_params?.cycles}
          pressure={job.experiment_params?.pressure_kpa}
        />
        <CameraFeedCard live={isPhotoStep} showCrosshair={isPhotoStep} />
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
