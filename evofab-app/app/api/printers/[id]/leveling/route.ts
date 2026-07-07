import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  LevelingError,
  runBedLeveling,
  type LevelingRequest,
} from "@/app/lib/printer-leveling";

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as LevelingRequest;
  const supabase = await createClient();

  const [{ data: printer, error: printerError }, { data: status }] =
    await Promise.all([
      supabase.from("printers").select("id, ip, port").eq("id", id).single(),
      supabase.from("printer_status").select("status").eq("printer_id", id).maybeSingle(),
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
    const result = await runBedLeveling(
      printer,
      { status: status?.status ?? "unknown" },
      body,
    );
    return NextResponse.json({ ok: true, leveling: result });
  } catch (error) {
    if (error instanceof LevelingError) {
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
      "LEVELING_FAILED",
      error instanceof Error ? error.message : "Bed leveling failed.",
      true,
    );
  }
}
