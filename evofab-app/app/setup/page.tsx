import { createClient } from "@/app/lib/supabase-server";
import { PrinterGrid } from "@/app/components/setup/PrinterGrid";
import { PrintSettingsPanel } from "@/app/components/setup/PrintSettingsPanel";
import { ExperimentPanel } from "@/app/components/setup/ExperimentPanel";
import { FileUploadZone } from "@/app/components/setup/FileUploadZone";
import { SubmitControls } from "@/app/components/setup/SubmitControls";
import type { PrinterWithStatus } from "@/app/types/printer";
import type { MaterialProfile, Experiment } from "@/app/types/job";
import { DemoScenarioBar } from "@/app/components/demo/DemoScenarioBar";

export default async function SetupPage() {
  const supabase = await createClient();

  const [
    { data: printers },
    { data: statuses },
    { data: materialProfiles },
    { data: experiments },
  ] = await Promise.all([
    supabase
      .from("printers")
      .select("id,name,model,type,material,build_volume,is_active,created_at")
      .eq("is_active", true)
      .order("name"),
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-teal">
            Printer command center
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">
            Prepare a fabrication run
          </h1>
          <p className="text-sm text-muted mt-2">
            Select, inspect, tune, and launch from one workspace.
          </p>
        </div>
        <span className="hidden md:block px-3 py-1 rounded-full border border-green/20 bg-green/10 text-green text-xs">
          ● Local simulator
        </span>
      </div>
      <DemoScenarioBar />
      <PrinterGrid printers={printersWithStatus} />
      <ExperimentPanel experiments={(experiments as Experiment[]) ?? []} />
      <PrintSettingsPanel
        materialProfiles={(materialProfiles as MaterialProfile[]) ?? []}
      />
      <FileUploadZone />
      <SubmitControls />
    </div>
  );
}
