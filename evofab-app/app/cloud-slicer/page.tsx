import { CloudSlicerClient } from "@/app/components/cloud-slicer/CloudSlicerClient";
import { createClient } from "@/app/lib/supabase-server";
import type { MaterialProfile } from "@/app/types/job";
import type { Printer } from "@/app/types/printer";

export default async function CloudSlicerPage() {
  const supabase = await createClient();
  const [
    { data: materialProfiles, error },
    { data: printers, error: printersError },
  ] = await Promise.all([
    supabase.from("material_profiles").select("*").order("name"),
    supabase.from("printers").select("*").eq("is_active", true).order("name"),
  ]);

  if (error) {
    throw new Error(`Unable to load material profiles: ${error.message}`);
  }
  if (printersError) {
    throw new Error(`Unable to load printers: ${printersError.message}`);
  }

  return (
    <CloudSlicerClient
      materialProfiles={(materialProfiles as MaterialProfile[] | null) ?? []}
      printers={(printers as Printer[] | null) ?? []}
    />
  );
}
