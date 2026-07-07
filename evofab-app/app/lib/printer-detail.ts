import { getActivePrintersWithStatus } from "@/app/lib/printer-status-source";
import { createClient } from "@/app/lib/supabase-server";
import type { Job, MaterialProfile } from "@/app/types/job";
import type { PrinterWithStatus } from "@/app/types/printer";

export interface PrinterDetailData {
  printer: PrinterWithStatus;
  activeJob: Job | null;
  historyJobs: Job[];
  materialProfiles: MaterialProfile[];
}

const ACTIVE_JOB_STATUSES = [
  "queued",
  "printing",
  "transferring",
  "experimenting",
  "photographing",
  "analysing",
];

export async function getPrinterDetailData(
  printerId: string,
): Promise<PrinterDetailData | null> {
  const supabase = await createClient();
  const [printers, { data: activeJobs }, { data: historyJobs }, { data: materialProfiles }] =
    await Promise.all([
      getActivePrintersWithStatus(),
      supabase
        .from("jobs")
        .select("*")
        .eq("printer_id", printerId)
        .in("status", ACTIVE_JOB_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("jobs")
        .select("*")
        .eq("printer_id", printerId)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase.from("material_profiles").select("*").order("name"),
    ]);

  const printer = printers.find((candidate) => candidate.id === printerId);
  if (!printer) return null;

  return {
    printer,
    activeJob: ((activeJobs as Job[] | null) ?? [])[0] ?? null,
    historyJobs: (historyJobs as Job[] | null) ?? [],
    materialProfiles: (materialProfiles as MaterialProfile[] | null) ?? [],
  };
}
