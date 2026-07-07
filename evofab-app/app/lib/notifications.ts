import type { Job } from "@/app/types/job";
import type { PrinterStatus } from "@/app/types/printer";

export type OperatorNotificationTone = "success" | "error" | "warn";

export interface OperatorNotification {
  id: string;
  tone: OperatorNotificationTone;
  title: string;
  body: string;
  createdAt: string;
}

export function notificationForJob(job: Job): OperatorNotification | null {
  if (job.status === "complete") {
    return {
      id: `job:${job.id}:complete`,
      tone: "success",
      title: "Print complete",
      body: job.filename,
      createdAt: job.completed_at ?? new Date().toISOString(),
    };
  }

  if (job.status === "failed") {
    return {
      id: `job:${job.id}:failed`,
      tone: "error",
      title: "Print error",
      body: job.filename,
      createdAt: job.completed_at ?? new Date().toISOString(),
    };
  }

  return null;
}

export function notificationForPrinterStatus(
  status: PrinterStatus,
): OperatorNotification | null {
  if (status.status === "error") {
    return {
      id: `printer:${status.printer_id}:error:${status.updated_at}`,
      tone: "error",
      title: "Printer fault",
      body: status.fault_message ?? "Printer reported an error state.",
      createdAt: status.updated_at,
    };
  }

  if (status.status === "offline") {
    return {
      id: `printer:${status.printer_id}:offline:${status.updated_at}`,
      tone: "warn",
      title: "Printer offline",
      body: "Printer telemetry is stale or unavailable.",
      createdAt: status.updated_at,
    };
  }

  return null;
}
