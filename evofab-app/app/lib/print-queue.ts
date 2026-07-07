import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPrintSettings, startPrint } from "@/app/lib/moonraker";
import {
  EMPTY_PRINT_SETTINGS,
  mergePrintSettings,
  normalizePrintSettings,
} from "@/app/lib/material-profiles";
import type { Job } from "@/app/types/job";

type QueueSupabaseClient = Pick<SupabaseClient, "from">;

export async function startNextQueuedJob(
  supabase: QueueSupabaseClient,
  printerId: string,
): Promise<Job | null> {
  const { data: activeJobs, error: activeError } = await supabase
    .from("jobs")
    .select("id")
    .eq("printer_id", printerId)
    .in("status", ["printing", "transferring", "experimenting", "photographing", "analysing"])
    .limit(1);

  if (activeError) {
    throw new Error(`Unable to check active jobs: ${activeError.message}`);
  }
  if ((activeJobs ?? []).length > 0) return null;

  const [{ data: printer, error: printerError }, { data: queuedJobs, error }] =
    await Promise.all([
      supabase.from("printers").select("ip, port").eq("id", printerId).single(),
      supabase
        .from("jobs")
        .select("*")
        .eq("printer_id", printerId)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1),
    ]);

  if (printerError || !printer) {
    throw new Error(printerError?.message ?? "Printer not found.");
  }
  if (error) {
    throw new Error(`Unable to read queued jobs: ${error.message}`);
  }

  const job = ((queuedJobs as Job[] | null) ?? [])[0];
  if (!job?.file_key) return null;

  const settings = mergePrintSettings(
    EMPTY_PRINT_SETTINGS,
    normalizePrintSettings(job.print_settings),
  );
  await applyPrintSettings(printer.ip, printer.port, settings);
  await startPrint(printer.ip, printer.port, job.file_key);

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "printing",
      pipeline_step: "printing",
      started_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Unable to start queued job: ${updateError.message}`);
  }

  return updated as Job;
}
