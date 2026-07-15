import type { PrinterStatus } from "@/app/types/printer";

export interface MoonrakerLifecyclePatch {
  status?: "printing" | "complete" | "aborted" | "failed";
  pipeline_step?: "printing";
  command_outcome?: "succeeded" | "failed" | "outcome_unknown";
  completed_at?: string;
  started_at?: string;
  print_progress?: number;
  layer_current?: number | null;
  layer_total?: number | null;
}

export function moonrakerLifecyclePatch(
  status: PrinterStatus,
  job: {
    status: string;
    command_outcome?: string | null;
    last_command?: string | null;
    filename?: string | null;
    file_key?: string | null;
  },
  now = new Date(),
): MoonrakerLifecyclePatch | null {
  const printState = status.print_state?.toLowerCase() ?? "";
  const activeFilename = basename(status.filename);
  const queuedFilename = basename(job.filename ?? job.file_key);
  const common = {
    print_progress: status.progress,
    layer_current: status.layer_current,
    layer_total: status.layer_total,
  };
  if (status.status === "printing" || status.status === "paused") {
    if (
      job.status === "queued" &&
      (!activeFilename || !queuedFilename || activeFilename !== queuedFilename)
    ) {
      return null;
    }
    return {
      ...common,
      status: "printing",
      pipeline_step: "printing",
      command_outcome: "succeeded",
      ...(job.status === "queued" ? { started_at: now.toISOString() } : {}),
    };
  }
  if (status.status === "error") {
    return {
      ...common,
      status: "failed",
      command_outcome: "failed",
      completed_at: now.toISOString(),
    };
  }
  if (
    job.status === "printing" &&
    ["cancelled", "canceled", "stopped"].includes(printState)
  ) {
    return {
      ...common,
      status: "aborted",
      command_outcome: "succeeded",
      completed_at: now.toISOString(),
    };
  }
  if (
    job.status === "printing" &&
    ["complete", "completed", "finished"].includes(printState)
  ) {
    return {
      ...common,
      status: "complete",
      command_outcome: "succeeded",
      completed_at: now.toISOString(),
    };
  }
  if (status.status === "idle" && job.status === "printing") {
    return job.last_command === "cancel"
      ? {
          ...common,
          status: "aborted",
          command_outcome: "succeeded",
          completed_at: now.toISOString(),
        }
      : {
          command_outcome: "outcome_unknown",
        };
  }
  return null;
}

function basename(value: string | null | undefined): string | null {
  const normalized = value?.trim().replaceAll("\\", "/");
  if (!normalized) return null;
  return normalized.split("/").at(-1)?.toLowerCase() ?? null;
}
