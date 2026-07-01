import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { MoonrakerClient, MoonrakerError } from "@/app/lib/moonraker";
import type { PrintSettings } from "@/app/types/job";

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

function parseSettings(value: FormDataEntryValue | null): PrintSettings | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<PrintSettings>;
    const fields: (keyof PrintSettings)[] = [
      "nozzle_temp",
      "bed_temp",
      "speed",
      "flow_rate",
      "fan_speed",
    ];
    if (
      !fields.every(
        (field) =>
          typeof parsed[field] === "number" && Number.isFinite(parsed[field]),
      )
    ) {
      return null;
    }
    return parsed as PrintSettings;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const form = await req.formData();
  const file = form.get("file");
  const printerId = form.get("printer_id");
  const settings = parseSettings(form.get("settings"));

  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".gcode")) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FILE",
          message: "Upload a valid .gcode file.",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  if (typeof printerId !== "string" || !printerId || !settings) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JOB",
          message: "Printer and print settings are required.",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }

  const experimentId = (form.get("experiment_id") as string) || null;
  const materialProfileId = (form.get("material_profile_id") as string) || null;
  let experimentParams: Record<string, unknown> = {};
  try {
    experimentParams = JSON.parse(
      (form.get("experiment_params") as string) || "{}",
    );
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JOB",
          message: "Experiment parameters are invalid.",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }

  const { data: printer, error: printerError } = await supabase
    .from("printers")
    .select("id,ip,port")
    .eq("id", printerId)
    .single();

  if (printerError || !printer) {
    return NextResponse.json(
      {
        error: {
          code: "PRINTER_NOT_FOUND",
          message: "Printer not found.",
          retryable: false,
        },
      },
      { status: 404 },
    );
  }

  // Persist intent before any command can move or heat a physical printer.
  const { data: intent, error: intentError } = await supabase
    .from("jobs")
    .insert({
      printer_id: printerId,
      experiment_id: experimentId,
      material_profile_id: materialProfileId,
      filename: file.name,
      print_settings: settings,
      experiment_params: experimentParams,
      status: "queued",
      pipeline_step: "upload",
    })
    .select()
    .single();

  if (intentError || !intent) {
    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Unable to record the job safely.",
          retryable: true,
        },
      },
      { status: 500 },
    );
  }

  try {
    const moonraker = new MoonrakerClient({
      printerId,
      ip: printer.ip,
      port: printer.port,
    });
    const fileKey = await moonraker.uploadGcode(file);
    await supabase
      .from("jobs")
      .update({ file_key: fileKey })
      .eq("id", intent.id);
    await moonraker.applyPrintSettings(settings);
    await moonraker.startPrint(fileKey);

    const { data: job, error: updateError } = await supabase
      .from("jobs")
      .update({
        file_key: fileKey,
        status: "printing",
        pipeline_step: "printing",
        started_at: new Date().toISOString(),
      })
      .eq("id", intent.id)
      .select()
      .single();

    if (updateError || !job) {
      throw new Error(
        "The print started, but its job state could not be updated.",
      );
    }

    await supabase.from("logs").insert([
      {
        job_id: job.id,
        message: `Uploaded ${file.name} to Moonraker`,
        type: "success",
      },
      {
        job_id: job.id,
        message: "Applied temperature, speed, flow, and fan overrides",
        type: "info",
      },
      {
        job_id: job.id,
        message: "Print started · telemetry stream connected",
        type: "success",
      },
    ]);

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    await supabase
      .from("jobs")
      .update({ status: "failed", pipeline_step: null })
      .eq("id", intent.id);

    const payload =
      error instanceof MoonrakerError
        ? error.toJSON()
        : {
            code: "JOB_STATE_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "The print could not be started.",
            retryable: false,
            printerId,
          };
    return NextResponse.json(
      { error: payload, jobId: intent.id },
      { status: 502 },
    );
  }
}
