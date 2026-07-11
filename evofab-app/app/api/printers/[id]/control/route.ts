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
  return (
    typeof value === "string" && ACTIONS.has(value as PrinterControlAction)
  );
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
      "PRINTER_CONTROL_INVALID_ACTION",
      "Unsupported printer control action.",
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
      "PRINTER_CONTROL_CONFIRMATION_REQUIRED",
      `Type ${expectedControlConfirmation(action)} to continue.`,
      false,
    );
  }

  const supabase = await createClient();
  const { data: printer, error } = await supabase
    .from("printers")
    .select("ip, port, driver_type")
    .eq("id", id)
    .single();

  if (error || !printer) {
    return errorResponse(
      404,
      "PRINTER_NOT_FOUND",
      "Printer not found.",
      false,
      error?.message,
    );
  }
  if (printer.driver_type === "prusalink")
    return errorResponse(
      403,
      "PRINTER_READ_ONLY",
      "PrusaLink printers are read-only.",
    );

  try {
    await runPrinterControl(printer, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(
      502,
      "PRINTER_CONTROL_FAILED",
      error instanceof Error ? error.message : "Printer control failed.",
      true,
    );
  }
}
