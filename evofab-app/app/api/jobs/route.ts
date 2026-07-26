import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  EMPTY_PRINT_SETTINGS,
  mergePrintSettings,
  normalizePrintSettings,
  profileSupportsPrinterType,
  settingsFromMaterialProfile,
} from "@/app/lib/material-profiles";
import { startNextQueuedJob } from "@/app/lib/print-queue";
import type { MaterialProfile, PrintSettings } from "@/app/types/job";
import { PrusaLinkDriver } from "@/app/lib/prusalink-driver";
import { MoonrakerDriver } from "@/app/lib/moonraker-driver";
import { SlicerClient } from "@/app/lib/slicer-client";
import { validatePrusaUploadArtifact } from "@/app/lib/prusalink-upload-trust";
import type { Printer } from "@/app/types/printer";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const form = await req.formData();

  const file = form.get("file") as File;
  const printer_id = form.get("printer_id") as string;
  const experiment_id = (form.get("experiment_id") as string) || null;
  const material_profile_id =
    (form.get("material_profile_id") as string) || null;
  const submittedSettings = normalizePrintSettings(
    JSON.parse((form.get("settings") as string) || "{}"),
  );
  const prepareSettings = JSON.parse(
    (form.get("prepare_settings") as string) || "{}",
  );
  const experiment_params = JSON.parse(
    (form.get("experiment_params") as string) || "{}",
  );
  const sourceSlicerJobId = (form.get("source_slicer_job_id") as string) || "";
  const previewHash = (form.get("preview_hash") as string) || null;

  const [{ data: printer, error: printerError }, { data: printerStatus }] =
    await Promise.all([
      supabase.from("printers").select("*").eq("id", printer_id).single(),
      supabase
        .from("printer_status")
        .select("status")
        .eq("printer_id", printer_id)
        .maybeSingle(),
    ]);

  if (printerError || !printer) {
    return NextResponse.json({ error: "Printer not found" }, { status: 404 });
  }

  let settings: PrintSettings = mergePrintSettings(
    EMPTY_PRINT_SETTINGS,
    submittedSettings,
  );
  if (material_profile_id) {
    const { data: materialProfile, error: materialProfileError } =
      await supabase
        .from("material_profiles")
        .select("*")
        .eq("id", material_profile_id)
        .single();

    if (materialProfileError || !materialProfile) {
      return NextResponse.json(
        { error: "Material profile not found" },
        { status: 404 },
      );
    }

    const profile = materialProfile as MaterialProfile;
    if (!profileSupportsPrinterType(profile, printer.type)) {
      return NextResponse.json(
        { error: "Material profile is not available for this printer type" },
        { status: 400 },
      );
    }

    settings = mergePrintSettings(
      settingsFromMaterialProfile(profile),
      submittedSettings,
    );
  }

  const shouldStartNow = printerStatus?.status === "idle";

  if (printer.driver_type === "prusalink") {
    if (!shouldStartNow) {
      return NextResponse.json(
        {
          error: {
            code: "PRUSALINK_NOT_IDLE",
            message: "Printer 9 must be idle before upload.",
            retryable: true,
          },
        },
        { status: 409 },
      );
    }

    if (!sourceSlicerJobId) {
      return NextResponse.json(
        {
          error: {
            code: "PREVIEW_EVIDENCE_REQUIRED",
            message:
              "A verified source slicer job is required before Prusa upload.",
            retryable: false,
          },
        },
        { status: 409 },
      );
    }
    const trust = await validatePrusaUploadArtifact({
      slicer: new SlicerClient(),
      slicerJobId: sourceSlicerJobId,
      submittedGcode: await file.text(),
      submittedHash: previewHash,
    }).catch(() => ({
      ok: false as const,
      code: "PREVIEW_VALIDATION_FAILED",
      message: "Unable to validate the source slicer artifact before upload.",
    }));
    if (!trust.ok) {
      return NextResponse.json(
        {
          error: { code: trust.code, message: trust.message, retryable: false },
        },
        { status: 409 },
      );
    }

    const { data: job, error: createError } = await supabase
      .from("jobs")
      .insert({
        printer_id,
        experiment_id,
        material_profile_id,
        filename: file.name,
        file_key: null,
        print_settings: { ...settings, prepare: prepareSettings },
        experiment_params,
        status: "queued",
        pipeline_step: "upload",
        command_outcome: "pending",
        last_command: "upload",
      })
      .select()
      .single();
    if (createError || !job)
      return NextResponse.json(
        { error: createError?.message ?? "Unable to create job" },
        { status: 500 },
      );

    const driver = new PrusaLinkDriver();
    const device = printer as Printer;
    try {
      const storage = await driver.discoverStorage(device);
      const upload = await driver.uploadFile(device, storage, file);
      if (upload.outcome !== "succeeded") {
        await supabase
          .from("jobs")
          .update({
            status: upload.outcome === "failed" ? "failed" : "queued",
            command_outcome: upload.outcome,
            last_command_code: upload.code,
            completed_at:
              upload.outcome === "failed" ? new Date().toISOString() : null,
          })
          .eq("id", job.id);
        return NextResponse.json(
          {
            error: {
              code: upload.code,
              message:
                upload.outcome === "outcome_unknown"
                  ? "Upload outcome is unknown; status reconciliation is required."
                  : "PrusaLink upload failed.",
              retryable: upload.retryable,
            },
            job_id: job.id,
          },
          { status: upload.outcome === "outcome_unknown" ? 504 : 502 },
        );
      }
      const verify = await driver.verifyStoredFile(device, storage, file.name);
      if (verify.outcome !== "succeeded") {
        await supabase
          .from("jobs")
          .update({
            status: verify.outcome === "failed" ? "failed" : "queued",
            command_outcome: verify.outcome,
            last_command_code: verify.code ?? "PRUSALINK_FILE_NOT_VERIFIED",
            completed_at:
              verify.outcome === "failed" ? new Date().toISOString() : null,
          })
          .eq("id", job.id);
        return NextResponse.json(
          {
            error: {
              code: verify.code ?? "PRUSALINK_FILE_NOT_VERIFIED",
              message:
                verify.outcome === "outcome_unknown"
                  ? "Stored-file verification is unknown; status reconciliation is required."
                  : "PrusaLink did not verify the stored file.",
              retryable: verify.retryable,
            },
            job_id: job.id,
          },
          { status: verify.outcome === "outcome_unknown" ? 504 : 502 },
        );
      }
      const fileKey = `${storage}/${file.name}`;
      const { data: uploadedJob } = await supabase
        .from("jobs")
        .update({
          file_key: fileKey,
          last_command: "upload",
          command_outcome: "succeeded",
          last_command_code: null,
        })
        .eq("id", job.id)
        .select()
        .single();
      return NextResponse.json(
        { job: uploadedJob ?? job, uploaded_only: true },
        { status: 201 },
      );
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "PRUSALINK_DISPATCH_FAILED";
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          command_outcome: "failed",
          last_command_code: code,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return NextResponse.json(
        {
          error: {
            code,
            message: "PrusaLink dispatch failed.",
            retryable: false,
          },
          job_id: job.id,
        },
        { status: 502 },
      );
    }
  }

  if (printer.driver_type !== "moonraker") {
    return NextResponse.json(
      { error: "This printer does not support the prepared-print flow." },
      { status: 400 },
    );
  }
  if (!shouldStartNow) {
    return NextResponse.json(
      {
        error: {
          code: "MOONRAKER_NOT_IDLE",
          message: "Printer must be idle before upload.",
          retryable: true,
        },
      },
      { status: 409 },
    );
  }

  const { data: createdJob, error: createError } = await supabase
    .from("jobs")
    .insert({
      printer_id,
      experiment_id,
      material_profile_id,
      filename: file.name,
      file_key: null,
      print_settings: { ...settings, prepare: prepareSettings },
      experiment_params,
      status: "queued",
      pipeline_step: "upload",
      command_outcome: "pending",
      last_command: "upload",
    })
    .select()
    .single();

  if (createError || !createdJob)
    return NextResponse.json(
      { error: createError?.message ?? "Unable to create job" },
      { status: 500 },
    );

  const driver = new MoonrakerDriver();
  const path = `evofab/${createdJob.id}-${file.name}`;
  const upload = await driver.uploadFile(printer as Printer, file, path);
  if (upload.outcome !== "succeeded" || !upload.path) {
    await supabase
      .from("jobs")
      .update({
        status: upload.outcome === "failed" ? "failed" : "queued",
        command_outcome: upload.outcome,
        last_command_code: upload.code ?? null,
        completed_at:
          upload.outcome === "failed" ? new Date().toISOString() : null,
      })
      .eq("id", createdJob.id);
    return NextResponse.json(
      {
        error: {
          code: upload.code ?? "MOONRAKER_UPLOAD_FAILED",
          message:
            upload.outcome === "outcome_unknown"
              ? "Upload outcome is unknown; reconcile printer status before trying again."
              : "Moonraker upload failed.",
          retryable: false,
        },
        job_id: createdJob.id,
      },
      { status: upload.outcome === "outcome_unknown" ? 504 : 502 },
    );
  }
  const verify = await driver.verifyStoredFile(printer as Printer, upload.path);
  if (verify.outcome !== "succeeded") {
    await supabase
      .from("jobs")
      .update({
        status: verify.outcome === "failed" ? "failed" : "queued",
        command_outcome: verify.outcome,
        last_command_code: verify.code ?? null,
        completed_at:
          verify.outcome === "failed" ? new Date().toISOString() : null,
      })
      .eq("id", createdJob.id);
    return NextResponse.json(
      {
        error: {
          code: verify.code ?? "MOONRAKER_FILE_NOT_VERIFIED",
          message:
            verify.outcome === "outcome_unknown"
              ? "File verification outcome is unknown; reconcile printer status before trying again."
              : "Moonraker did not verify the uploaded file.",
          retryable: false,
        },
        job_id: createdJob.id,
      },
      { status: verify.outcome === "outcome_unknown" ? 504 : 502 },
    );
  }
  const { data: uploadedJob } = await supabase
    .from("jobs")
    .update({
      file_key: upload.path,
      command_outcome: "succeeded",
      last_command: "upload",
      last_command_code: null,
    })
    .eq("id", createdJob.id)
    .select()
    .single();
  return NextResponse.json(
    { job: uploadedJob ?? createdJob, uploaded_only: true },
    { status: 201 },
  );
}
