import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  controlRequiresGuard,
  expectedControlConfirmation,
  runPrinterControl,
  type PrinterControlAction,
} from "@/app/lib/printer-control";
import { PrusaLinkDriver } from "@/app/lib/prusalink-driver";
import { MoonrakerDriver } from "@/app/lib/moonraker-driver";
import type { Printer } from "@/app/types/printer";

const ACTIONS = new Set<PrinterControlAction>([
  "start",
  "pause",
  "resume",
  "cancel",
  "emergency_stop",
  "restart",
  "firmware_restart",
]);

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: unknown,
) {
  return NextResponse.json(
    { error: { code, message, retryable, details } },
    { status },
  );
}

function isAction(value: unknown): value is PrinterControlAction {
  return (
    typeof value === "string" && ACTIONS.has(value as PrinterControlAction)
  );
}

function terminalJobPatch(action: PrinterControlAction) {
  if (action === "cancel") {
    return {
      status: "aborted",
      pipeline_step: "printing",
      completed_at: new Date().toISOString(),
    };
  }

  if (action === "emergency_stop") {
    return {
      status: "failed",
      pipeline_step: "printing",
      completed_at: new Date().toISOString(),
    };
  }

  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (!isAction(action)) {
    return errorResponse(
      400,
      "JOB_CONTROL_INVALID_ACTION",
      "Unsupported job control action.",
      false,
      { action },
    );
  }

  if (
    controlRequiresGuard(action) &&
    body?.confirmation !== expectedControlConfirmation(action)
  ) {
    return errorResponse(
      400,
      "JOB_CONTROL_CONFIRMATION_REQUIRED",
      `Type ${expectedControlConfirmation(action)} to continue.`,
      false,
    );
  }

  if (action === "cancel" && body?.confirmed !== true) {
    return errorResponse(
      400,
      "JOB_CONTROL_CONFIRMATION_REQUIRED",
      "Cancel requires confirmation.",
      false,
    );
  }

  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, printer_id, status, prusalink_job_id, file_key")
    .eq("id", id)
    .single();

  if (jobError || !job?.printer_id) {
    return errorResponse(
      404,
      "JOB_NOT_FOUND",
      "Job or job printer not found.",
      false,
      jobError?.message,
    );
  }

  if (action === "cancel" && job.status === "queued") {
    await supabase
      .from("jobs")
      .update({
        status: "aborted",
        pipeline_step: "upload",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const { data: printer, error: printerError } = await supabase
    .from("printers")
    .select("*")
    .eq("id", job.printer_id)
    .single();

  if (printerError || !printer) {
    return errorResponse(
      404,
      "PRINTER_NOT_FOUND",
      "Printer not found.",
      false,
      printerError?.message,
    );
  }

  if (printer.driver_type === "prusalink") {
    if (!(["pause", "resume", "cancel"] as string[]).includes(action)) {
      return errorResponse(
        403,
        "PRUSALINK_CAPABILITY_UNSUPPORTED",
        "This control is not supported by PrusaLink.",
      );
    }
    const driver = new PrusaLinkDriver();
    const observed = await driver
      .observeJob(printer as Printer)
      .catch(() => null);
    if (
      !observed ||
      (job.prusalink_job_id && observed.id !== job.prusalink_job_id)
    ) {
      return errorResponse(
        409,
        "PRUSALINK_STALE_JOB_ID",
        "The observed PrusaLink job no longer matches this job.",
      );
    }
    if (!job.prusalink_job_id) {
      await supabase
        .from("jobs")
        .update({ prusalink_job_id: observed.id })
        .eq("id", id);
    }
    await supabase
      .from("jobs")
      .update({
        last_command: action,
        command_outcome: "pending",
        last_command_code: null,
      })
      .eq("id", id);
    const result =
      action === "pause"
        ? await driver.pause(printer as Printer, observed.id)
        : action === "resume"
          ? await driver.resume(printer as Printer, observed.id)
          : await driver.cancel(printer as Printer, observed.id);
    await supabase
      .from("jobs")
      .update({
        command_outcome: result.outcome,
        last_command_code: result.code ?? null,
        ...(result.outcome === "succeeded" && action === "cancel"
          ? { status: "aborted", completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", id);
    if (result.outcome !== "succeeded") {
      return errorResponse(
        result.outcome === "outcome_unknown" ? 504 : 502,
        result.code ?? "PRUSALINK_CONTROL_FAILED",
        result.outcome === "outcome_unknown"
          ? "Command outcome is unknown; status reconciliation is required."
          : "PrusaLink control failed.",
        result.retryable,
      );
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
  }

  if (printer.driver_type === "moonraker") {
    if (
      !(["start", "pause", "resume", "cancel"] as string[]).includes(action)
    ) {
      return errorResponse(
        403,
        "MOONRAKER_CAPABILITY_UNSUPPORTED",
        "This control is not supported by Moonraker.",
      );
    }
    if (action === "start" && (job.status !== "queued" || !job.file_key)) {
      return errorResponse(
        409,
        "MOONRAKER_START_NOT_READY",
        "Only an uploaded, queued job can be started.",
      );
    }
    const driver = new MoonrakerDriver();
    await supabase
      .from("jobs")
      .update({
        last_command: action,
        command_outcome: "pending",
        last_command_code: null,
      })
      .eq("id", id);
    const result =
      action === "start"
        ? await driver.startPrint(printer as Printer, job.file_key!)
        : action === "pause"
          ? await driver.pausePrint(printer as Printer)
          : action === "resume"
            ? await driver.resumePrint(printer as Printer)
            : await driver.cancelPrint(printer as Printer);
    const patch: Record<string, unknown> = {
      command_outcome: result.outcome,
      last_command_code: result.code ?? null,
    };
    if (result.outcome === "succeeded" && action === "start") {
      patch.status = "printing";
      patch.pipeline_step = "printing";
      patch.started_at = new Date().toISOString();
    }
    if (result.outcome === "succeeded" && action === "cancel") {
      patch.status = "aborted";
      patch.completed_at = new Date().toISOString();
    }
    await supabase.from("jobs").update(patch).eq("id", id);
    if (result.outcome !== "succeeded") {
      return errorResponse(
        result.outcome === "outcome_unknown" ? 504 : 502,
        result.code ?? "MOONRAKER_CONTROL_FAILED",
        result.outcome === "outcome_unknown"
          ? "Command outcome is unknown; printer status will reconcile it. Do not retry blindly."
          : "Moonraker control failed.",
        false,
      );
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
  }

  try {
    await runPrinterControl(printer, action);
    const patch = terminalJobPatch(action);
    if (patch) {
      await supabase.from("jobs").update(patch).eq("id", id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(
      502,
      "JOB_CONTROL_FAILED",
      error instanceof Error ? error.message : "Job control failed.",
      true,
    );
  }
}
