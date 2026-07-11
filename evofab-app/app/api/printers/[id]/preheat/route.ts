import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  PreheatError,
  listPreheatPresets,
  runPreheatPreset,
} from "@/app/lib/printer-preheat";
import type { MaterialProfile } from "@/app/types/job";

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

async function loadPrinterStatusAndProfiles(id: string) {
  const supabase = await createClient();
  const [
    { data: printer, error: printerError },
    { data: status },
    { data: profiles, error: profilesError },
  ] = await Promise.all([
    supabase
      .from("printers")
      .select("id, ip, port, type, driver_type")
      .eq("id", id)
      .single(),
    supabase
      .from("printer_status")
      .select("status")
      .eq("printer_id", id)
      .maybeSingle(),
    supabase.from("material_profiles").select("*").order("name"),
  ]);

  if (printerError || !printer) {
    throw new PreheatError({
      code: "PRINTER_NOT_FOUND",
      message: "Printer not found.",
      status: 404,
      details: printerError?.message,
    });
  }
  if (printer.driver_type === "prusalink") {
    throw new PreheatError({
      code: "PRINTER_READ_ONLY",
      message: "PrusaLink printers are read-only.",
      status: 403,
    });
  }

  if (profilesError) {
    throw new PreheatError({
      code: "PREHEAT_PROFILES_UNAVAILABLE",
      message: "Unable to load material profiles.",
      status: 500,
      retryable: true,
      details: profilesError.message,
    });
  }

  return {
    printer,
    status: { status: status?.status ?? "unknown" },
    profiles: (profiles as MaterialProfile[] | null) ?? [],
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { printer, status, profiles } =
      await loadPrinterStatusAndProfiles(id);
    return NextResponse.json({
      presets: listPreheatPresets(profiles, printer.type, status),
    });
  } catch (error) {
    if (error instanceof PreheatError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        error.retryable,
        error.details,
      );
    }
    return errorResponse(
      500,
      "PREHEAT_FAILED",
      "Unable to load preheat presets.",
      true,
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const { printer, status, profiles } =
      await loadPrinterStatusAndProfiles(id);
    const preset = await runPreheatPreset(
      printer,
      status,
      profiles,
      body?.preset_id,
    );
    return NextResponse.json({ ok: true, preset });
  } catch (error) {
    if (error instanceof PreheatError) {
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
      "PREHEAT_FAILED",
      error instanceof Error ? error.message : "Preheat command failed.",
      true,
    );
  }
}
