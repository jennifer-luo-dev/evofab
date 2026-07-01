"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase";
import { useJob } from "@/app/contexts/JobContext";
import { PipelineTracker } from "@/app/components/monitor/PipelineTracker";
import { PrinterMetricsCard } from "@/app/components/monitor/PrinterMetricsCard";
import { CameraFeedCard } from "@/app/components/monitor/CameraFeedCard";
import { SystemLogCard } from "@/app/components/monitor/SystemLogCard";
import { PrinterControlBar } from "@/app/components/monitor/PrinterControlBar";
import { FaultRecoveryBanner } from "@/app/components/monitor/FaultRecoveryBanner";
import {
  TemperatureChart,
  type TemperaturePoint,
} from "@/app/components/monitor/TemperatureChart";
import { DemoScenarioBar } from "@/app/components/demo/DemoScenarioBar";
import { StatusBadge } from "@/app/components/ui/StatusDot";
import type { Job, LogEntry, PipelineStepId } from "@/app/types/job";
import type { PrinterStatus, PrinterWithStatus } from "@/app/types/printer";

const INACTIVE_STATUSES = new Set(["complete", "failed", "aborted"]);
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
  const [printerName, setPrinterName] = useState("Mock printer");
  const [temperatures, setTemperatures] = useState<TemperaturePoint[]>([]);

  const refreshStatus = useCallback(async () => {
    if (!job.printer_id) return;
    const response = await fetch("/api/printers");
    if (!response.ok) return;
    const printers = (await response.json()).printers as PrinterWithStatus[];
    const printer = printers.find((item) => item.id === job.printer_id);
    if (!printer?.printer_status) return;
    setPrinterName(printer.name);
    setPrinterStatus(printer.printer_status);
    if (
      printer.printer_status.hotend_temp !== null &&
      printer.printer_status.bed_temp !== null
    ) {
      setTemperatures((prev) => [
        ...prev.slice(-24),
        {
          time: new Date().toLocaleTimeString([], {
            minute: "2-digit",
            second: "2-digit",
          }),
          hotend: printer.printer_status!.hotend_temp!,
          bed: printer.printer_status!.bed_temp!,
        },
      ]);
    }
  }, [job.printer_id]);

  useEffect(() => {
    if (!INACTIVE_STATUSES.has(job.status))
      dispatch({ type: "START_JOB", jobId: job.id });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const first = setTimeout(refreshStatus, 0);
    const id = setInterval(refreshStatus, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refreshStatus]);
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
          if (updated.status === "aborted") {
            dispatch({ type: "ABORT_JOB" });
            router.push("/setup");
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id, dispatch, router]);

  const progress = printerStatus?.progress ?? job.print_progress;
  const layerCurrent = printerStatus?.layer_current ?? job.layer_current;
  const layerTotal = printerStatus?.layer_total ?? job.layer_total;
  const status = printerStatus?.status ?? "offline";

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[.24em] text-teal font-mono">
            Live fabrication
          </p>
          <h1 className="text-3xl font-semibold mt-1">{job.filename}</h1>
          <p className="text-xs text-muted mt-2 font-mono">
            Job {job.id.slice(0, 8)} · {printerName}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      <DemoScenarioBar compact />
      {status === "error" && job.printer_id && (
        <FaultRecoveryBanner
          printerId={job.printer_id}
          jobId={job.id}
          onRecovered={refreshStatus}
        />
      )}
      <PipelineTracker currentStep={job.pipeline_step} />
      {job.printer_id && (
        <PrinterControlBar
          printerId={job.printer_id}
          jobId={job.id}
          status={status}
          onRefresh={refreshStatus}
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PrinterMetricsCard
          printerName={printerName}
          jobProgress={progress}
          layerCurrent={layerCurrent}
          layerTotal={layerTotal}
          printerStatus={printerStatus}
        />
        <CameraFeedCard
          live={status === "printing" || status === "paused"}
          showCrosshair={false}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TemperatureChart data={temperatures} />
        <SystemLogCard
          jobId={job.id}
          initialLogs={initialLogs}
          jobActive={!INACTIVE_STATUSES.has(job.status)}
        />
      </div>
    </div>
  );
}
