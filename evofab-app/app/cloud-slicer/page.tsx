import { CloudSlicerClient } from "@/app/components/cloud-slicer/CloudSlicerClient";
import { getActivePrintersWithStatus } from "@/app/lib/printer-status-source";
import { createClient } from "@/app/lib/supabase-server";
import type { MaterialProfile } from "@/app/types/job";

export default async function CloudSlicerPage() {
  const supabase = await createClient();
  const [printers, { data: materialProfiles, error }] = await Promise.all([
    getActivePrintersWithStatus(),
    supabase.from("material_profiles").select("*").order("name"),
  ]);

  if (error) {
    throw new Error(`Unable to load material profiles: ${error.message}`);
  }

  return (
    <CloudSlicerClient
      materialProfiles={(materialProfiles as MaterialProfile[] | null) ?? []}
      printers={printers}
    />
  );
}
