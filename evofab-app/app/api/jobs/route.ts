import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import {
  uploadGcode,
  applyPrintSettings,
  startPrint,
} from "@/app/lib/moonraker";
import {
  EMPTY_PRINT_SETTINGS,
  mergePrintSettings,
  normalizePrintSettings,
  profileSupportsPrinterType,
  settingsFromMaterialProfile,
} from "@/app/lib/material-profiles";
import { startNextQueuedJob } from "@/app/lib/print-queue";
import type { MaterialProfile, PrintSettings } from "@/app/types/job";

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

  const [{ data: printer, error: printerError }, { data: printerStatus }] =
    await Promise.all([
      supabase.from("printers").select("ip, port, type").eq("id", printer_id).single(),
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

  // Upload file to Moonraker; busy printers keep the job queued until idle.
  let fileKey: string;
  try {
    fileKey = await uploadGcode(printer.ip, printer.port, file);
    if (shouldStartNow) {
      await applyPrintSettings(printer.ip, printer.port, settings);
      await startPrint(printer.ip, printer.port, fileKey);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      printer_id,
      experiment_id,
      material_profile_id,
      filename: file.name,
      file_key: fileKey,
      print_settings: { ...settings, prepare: prepareSettings },
      experiment_params,
      status: shouldStartNow ? "printing" : "queued",
      pipeline_step: shouldStartNow ? "printing" : "upload",
      started_at: shouldStartNow ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!shouldStartNow && printerStatus?.status === "idle") {
    await startNextQueuedJob(supabase, printer_id);
  }
  return NextResponse.json({ job }, { status: 201 });
}
