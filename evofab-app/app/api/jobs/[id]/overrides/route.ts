import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  normalizePrintOverrideError,
  runPrintOverride,
  type PrintOverrideAction,
} from "@/app/lib/printer-overrides";

const ACTIONS = new Set<PrintOverrideAction>([
  "speed_factor",
  "flow_factor",
  "fan_speed",
  "nozzle_target",
  "bed_target",
  "babystep_z",
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

function isAction(value: unknown): value is PrintOverrideAction {
  return typeof value === "string" && ACTIONS.has(value as PrintOverrideAction);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (!isAction(body?.action)) {
    return errorResponse(
      400,
      "PRINT_OVERRIDE_INVALID_ACTION",
      "Unsupported print override action.",
      false,
      { action: body?.action },
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

  if (job.status !== "printing") {
    return errorResponse(
      409,
      "PRINT_OVERRIDE_UNAVAILABLE",
      "No active print.",
      false,
      { job_status: job.status },
    );
  }

  const [{ data: printer, error: printerError }, { data: status }] =
    await Promise.all([
      supabase
        .from("printers")
        .select("id, ip, port")
        .eq("id", job.printer_id)
        .single(),
      supabase
        .from("printer_status")
        .select("status")
        .eq("printer_id", job.printer_id)
        .maybeSingle(),
    ]);

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
    const override = await runPrintOverride(
      printer,
      { status: status?.status ?? "unknown" },
      { action: body.action, value: body?.value },
    );
    return NextResponse.json({ ok: true, override });
  } catch (error) {
    const normalized = normalizePrintOverrideError(error);
    return errorResponse(
      normalized.status,
      normalized.code,
      normalized.message,
      normalized.retryable,
      normalized.details,
    );
  }
}
