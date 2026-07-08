import { NextResponse } from "next/server";
import { applyPrintSettings, startPrint } from "@/app/lib/moonraker";
import {
  EMPTY_PRINT_SETTINGS,
  mergePrintSettings,
  normalizePrintSettings,
} from "@/app/lib/material-profiles";
import { createClient } from "@/app/lib/supabase-server";
import type { Job } from "@/app/types/job";

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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return errorResponse(
      404,
      "JOB_NOT_FOUND",
      "Job not found.",
      false,
      jobError?.message,
    );
  }

  const original = job as Job;
  if (!original.printer_id || !original.file_key) {
    return errorResponse(
      409,
      "REPRINT_UNAVAILABLE",
      "Re-print requires a printer and stored file key.",
      false,
      { printer_id: original.printer_id, file_key: original.file_key },
    );
  }

  const { data: printer, error: printerError } = await supabase
    .from("printers")
    .select("ip, port")
    .eq("id", original.printer_id)
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

  const settings = mergePrintSettings(
    EMPTY_PRINT_SETTINGS,
    normalizePrintSettings(original.print_settings),
  );

  try {
    await applyPrintSettings(printer.ip, printer.port, settings);
    await startPrint(printer.ip, printer.port, original.file_key);
  } catch (error) {
    return errorResponse(
      502,
      "REPRINT_START_FAILED",
      error instanceof Error ? error.message : "Unable to start re-print.",
      true,
    );
  }

  const { data: nextJob, error: insertError } = await supabase
    .from("jobs")
    .insert({
      printer_id: original.printer_id,
      experiment_id: original.experiment_id,
      material_profile_id: original.material_profile_id,
      filename: original.filename,
      file_key: original.file_key,
      print_settings: original.print_settings,
      experiment_params: original.experiment_params,
      status: "printing",
      pipeline_step: "printing",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    return errorResponse(
      500,
      "REPRINT_JOB_CREATE_FAILED",
      "Re-print started, but job row could not be created.",
      true,
      insertError.message,
    );
  }

  return NextResponse.json({ job: nextJob }, { status: 201 });
}
