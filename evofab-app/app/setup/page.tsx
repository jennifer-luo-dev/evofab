import { createClient } from "@/app/lib/supabase-server";
import { PrinterGrid } from "@/app/components/setup/PrinterGrid";
import { PrintSettingsPanel } from "@/app/components/setup/PrintSettingsPanel";
import { ExperimentPanel } from "@/app/components/setup/ExperimentPanel";
import { FileUploadZone } from "@/app/components/setup/FileUploadZone";
import { SubmitControls } from "@/app/components/setup/SubmitControls";
import type { PrinterWithStatus } from "@/app/types/printer";
import type { MaterialProfile, Experiment } from "@/app/types/job";

/** Server-rendered setup flow: fetches printers, material profiles, and experiments, then renders the setup form. */
export default async function SetupPage() {
  const supabase = await createClient();

  const [
    { data: printers },
    { data: statuses },
    { data: materialProfiles },
    { data: experiments },
  ] = await Promise.all([
    supabase.from("printers").select("*").eq("is_active", true).order("name"),
    supabase.from("printer_status").select("*"),
    supabase.from("material_profiles").select("*").order("name"),
    supabase.from("experiments").select("*").order("name"),
  ]);

  const statusMap = new Map((statuses ?? []).map((s) => [s.printer_id, s]));
  const printersWithStatus: PrinterWithStatus[] = (printers ?? []).map((p) => ({
    ...p,
    printer_status: statusMap.get(p.id) ?? null,
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8 animate-fade-up">
      <PrinterGrid printers={printersWithStatus} />
      <ExperimentPanel experiments={(experiments as Experiment[]) ?? []} />
      <FileUploadZone />
      <PrintSettingsPanel
        materialProfiles={(materialProfiles as MaterialProfile[]) ?? []}
      />
      <SubmitControls />
    </div>
  );
}
