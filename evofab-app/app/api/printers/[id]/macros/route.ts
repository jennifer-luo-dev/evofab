import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  listCuratedMacros,
  MacroError,
  runCuratedMacro,
} from "@/app/lib/printer-macros";

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

async function loadPrinterAndStatus(id: string) {
  const supabase = await createClient();
  const [{ data: printer, error: printerError }, { data: status }] =
    await Promise.all([
      supabase
        .from("printers")
        .select("id, ip, port, driver_type")
        .eq("id", id)
        .single(),
      supabase
        .from("printer_status")
        .select("status")
        .eq("printer_id", id)
        .maybeSingle(),
    ]);

  if (printerError || !printer) {
    throw new MacroError({
      code: "PRINTER_NOT_FOUND",
      message: "Printer not found.",
      status: 404,
      details: printerError?.message,
    });
  }
  if (printer.driver_type === "prusalink") {
    throw new MacroError({
      code: "PRINTER_READ_ONLY",
      message: "PrusaLink printers are read-only.",
      status: 403,
    });
  }

  return {
    printer,
    status: { status: status?.status ?? "unknown" },
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { status } = await loadPrinterAndStatus(id);
    return NextResponse.json({ macros: listCuratedMacros(status) });
  } catch (error) {
    if (error instanceof MacroError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        error.retryable,
        error.details,
      );
    }
    return errorResponse(500, "MACROS_FAILED", "Unable to load macros.", true);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const { printer, status } = await loadPrinterAndStatus(id);
    const macro = await runCuratedMacro(printer, status, body?.macro_id);
    return NextResponse.json({ ok: true, macro });
  } catch (error) {
    if (error instanceof MacroError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        error.retryable,
        error.details,
      );
    }
    return errorResponse(
      502,
      "MACRO_FAILED",
      error instanceof Error ? error.message : "Macro command failed.",
      true,
    );
  }
}
