import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { getMoonrakerMode } from "@/app/lib/moonraker-config";
import {
  injectMockMoonrakerFault,
  mockPrinterKey,
} from "@/app/lib/mock-moonraker";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (getMoonrakerMode() !== "mock") {
    return NextResponse.json(
      {
        error: {
          code: "MOCK_FAULT_DISABLED",
          message: "Fault injection is available only in mock mode.",
          retryable: false,
        },
      },
      { status: 403 },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const supabase = await createClient();
  const { data: printer, error } = await supabase
    .from("printers")
    .select("id, ip, port, driver_type")
    .eq("id", id)
    .single();

  if (error || !printer) {
    return NextResponse.json(
      {
        error: {
          code: "PRINTER_NOT_FOUND",
          message: "Printer not found.",
          retryable: false,
          details: error?.message,
        },
      },
      { status: 404 },
    );
  }
  if (printer.driver_type === "prusalink") {
    return NextResponse.json(
      {
        error: {
          code: "PRINTER_READ_ONLY",
          message: "PrusaLink printers are read-only.",
          retryable: false,
        },
      },
      { status: 403 },
    );
  }

  injectMockMoonrakerFault(
    mockPrinterKey(printer),
    typeof body?.message === "string" ? body.message : undefined,
    typeof body?.mcu === "string" ? body.mcu : undefined,
  );

  return NextResponse.json({ ok: true });
}
