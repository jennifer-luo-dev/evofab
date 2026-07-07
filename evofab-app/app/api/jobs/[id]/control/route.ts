import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  controlRequiresGuard,
  expectedControlConfirmation,
  runPrinterControl,
  type PrinterControlAction,
} from "@/app/lib/printer-control";

const ACTIONS = new Set<PrinterControlAction>([
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
  return typeof value === "string" && ACTIONS.has(value as PrinterControlAction);
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
    .select("id, printer_id, status")
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
    .select("ip, port")
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
