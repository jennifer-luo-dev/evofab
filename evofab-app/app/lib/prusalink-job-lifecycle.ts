import type { PrinterStatus } from "@/app/types/printer";

export interface PrusaLifecyclePatch {
  status?: "printing" | "complete" | "failed" | "aborted";
  command_outcome?: "succeeded" | "failed" | "outcome_unknown";
  completed_at?: string;
  print_progress?: number;
}

export function prusaLifecyclePatch(
  status: PrinterStatus,
  job: {
    status: string;
    command_outcome?: string | null;
    last_command?: string | null;
  },
  now = new Date(),
): PrusaLifecyclePatch | null {
  const state = status.print_state?.toLowerCase() ?? "";
  if (state === "printing" || state === "paused") {
    return {
      status: "printing",
      command_outcome: "succeeded",
      print_progress: status.progress,
    };
  }
  if (["finished", "complete", "completed"].includes(state)) {
    return {
      status: "complete",
      command_outcome: "succeeded",
      print_progress: 100,
      completed_at: now.toISOString(),
    };
  }
  if (["stopped", "cancelled", "canceled"].includes(state)) {
    return {
      status: "aborted",
      command_outcome: "succeeded",
      completed_at: now.toISOString(),
    };
  }
  if (["error", "attention"].includes(state)) {
    return {
      status: "failed",
      command_outcome: "failed",
      completed_at: now.toISOString(),
    };
  }
  if (job.status === "printing" && status.status === "idle") {
    return job.last_command === "cancel"
      ? {
          status: "aborted",
          command_outcome: "succeeded",
          completed_at: now.toISOString(),
        }
      : { command_outcome: "outcome_unknown" };
  }
  return null;
}
