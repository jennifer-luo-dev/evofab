import { MoonrakerDriver } from "@/app/lib/moonraker-driver";
import type { PrinterFileDriver } from "@/app/lib/printer-driver";
import type { SlicerJob } from "@/app/lib/slicer-client";
import type { Printer } from "@/app/types/printer";

type QueryResult<T> = { data: T | null; error: { message: string } | null };

export interface SlicerHandoffSupabase {
  from(table: "printers" | "jobs"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { single(): Promise<QueryResult<unknown>> };
    };
    insert(values: Record<string, unknown>): {
      select(): { single(): Promise<QueryResult<unknown>> };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<QueryResult<unknown>>;
    };
  };
}

export interface SlicerHandoffDependencies {
  supabase: SlicerHandoffSupabase;
  slicer: Pick<SlicerHandoffSlicer, "getJob" | "fetchGcode">;
  createDriver?: (printer: Printer) => PrinterFileDriver;
  now?: () => Date;
}

export interface SlicerHandoffSlicer {
  getJob(jobId: string): Promise<SlicerJob>;
  fetchGcode(jobId: string): Promise<string>;
}

export type SlicerHandoffResult =
  | { ok: true; job: unknown }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      jobId?: string;
    };

function filenameFor(slicerJobId: string): string {
  return `slice-${slicerJobId.replace(/[^A-Za-z0-9._-]/g, "_")}.gcode`;
}

export async function handoffSlicerJob(
  slicerJobId: string,
  printerId: string,
  dependencies: SlicerHandoffDependencies,
): Promise<SlicerHandoffResult> {
  const { data: printerData, error: printerError } = await dependencies.supabase
    .from("printers")
    .select("*")
    .eq("id", printerId)
    .single();
  const printer = printerData as Printer | null;
  if (printerError || !printer) {
    return {
      ok: false,
      status: 404,
      code: "PRINTER_NOT_FOUND",
      message: "Printer not found.",
    };
  }
  if (printer.driver_type !== "moonraker") {
    return {
      ok: false,
      status: 403,
      code: "PRINTER_CAPABILITY_UNSUPPORTED",
      message: "This printer does not support the Moonraker slicer handoff.",
    };
  }

  const slicerJob = await dependencies.slicer.getJob(slicerJobId);
  if (slicerJob.status !== "done" || slicerJob.result?.engine === "mock") {
    return {
      ok: false,
      status: 409,
      code: "SLICER_JOB_NOT_READY",
      message: "A completed real slicer job is required before handoff.",
    };
  }

  const filename = filenameFor(slicerJobId);
  const { data: createdJob, error: createError } = await dependencies.supabase
    .from("jobs")
    .insert({
      printer_id: printerId,
      filename,
      file_key: null,
      print_settings: {},
      experiment_params: {},
      status: "queued",
      pipeline_step: "upload",
      command_outcome: "pending",
      last_command: "upload",
    })
    .select()
    .single();
  const job = createdJob as { id: string } | null;
  if (createError || !job) {
    return {
      ok: false,
      status: 500,
      code: "JOB_CREATE_FAILED",
      message: "Unable to create handoff job.",
    };
  }

  const update = (values: Record<string, unknown>) =>
    dependencies.supabase.from("jobs").update(values).eq("id", job.id);
  const driver = dependencies.createDriver?.(printer) ?? new MoonrakerDriver();
  if (
    !driver.capabilities.has("upload_file") ||
    !driver.capabilities.has("verify_file")
  ) {
    await update({
      status: "failed",
      command_outcome: "failed",
      last_command_code: "PRINTER_CAPABILITY_UNSUPPORTED",
      completed_at: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    return {
      ok: false,
      status: 403,
      code: "PRINTER_CAPABILITY_UNSUPPORTED",
      message: "Printer upload is unsupported.",
      jobId: job.id,
    };
  }

  let gcode: string;
  try {
    gcode = await dependencies.slicer.fetchGcode(slicerJobId);
  } catch {
    await update({
      status: "failed",
      command_outcome: "failed",
      last_command_code: "SLICER_GCODE_FETCH_FAILED",
      completed_at: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    return {
      ok: false,
      status: 502,
      code: "SLICER_GCODE_FETCH_FAILED",
      message: "Unable to fetch slicer G-code.",
      jobId: job.id,
    };
  }

  const upload = await driver.uploadFile(
    printer,
    new File([gcode], filename, { type: "text/x.gcode" }),
    filename,
  );
  if (upload.outcome !== "succeeded" || !upload.path) {
    await update({
      status: upload.outcome === "failed" ? "failed" : "queued",
      command_outcome: upload.outcome,
      last_command_code: upload.code ?? null,
      completed_at:
        upload.outcome === "failed"
          ? (dependencies.now ?? (() => new Date()))().toISOString()
          : null,
    });
    return {
      ok: false,
      status: upload.outcome === "outcome_unknown" ? 504 : 502,
      code: upload.code ?? "MOONRAKER_UPLOAD_FAILED",
      message:
        upload.outcome === "outcome_unknown"
          ? "Upload outcome is unknown; status reconciliation is required."
          : "Moonraker upload failed.",
      jobId: job.id,
    };
  }

  const verified = await driver.verifyStoredFile(printer, upload.path);
  if (verified.outcome !== "succeeded") {
    await update({
      status: verified.outcome === "failed" ? "failed" : "queued",
      command_outcome: verified.outcome,
      last_command_code: verified.code ?? "MOONRAKER_FILE_NOT_VERIFIED",
      completed_at:
        verified.outcome === "failed"
          ? (dependencies.now ?? (() => new Date()))().toISOString()
          : null,
    });
    return {
      ok: false,
      status: verified.outcome === "outcome_unknown" ? 504 : 502,
      code: verified.code ?? "MOONRAKER_FILE_NOT_VERIFIED",
      message:
        verified.outcome === "outcome_unknown"
          ? "Verification outcome is unknown; status reconciliation is required."
          : "Moonraker upload could not be verified.",
      jobId: job.id,
    };
  }

  const { data: uploadedJob } = await dependencies.supabase
    .from("jobs")
    .update({
      file_key: upload.path,
      command_outcome: "succeeded",
      last_command: "upload",
      last_command_code: null,
    })
    .eq("id", job.id);
  return { ok: true, job: uploadedJob ?? job };
}
