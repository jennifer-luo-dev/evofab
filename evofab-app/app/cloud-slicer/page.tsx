import { CloudSlicerClient } from "@/app/components/cloud-slicer/CloudSlicerClient";
import { createClient } from "@/app/lib/supabase-server";
import type { MaterialProfile } from "@/app/types/job";
import type { Printer } from "@/app/types/printer";

export default async function CloudSlicerPage() {
  if (process.env.EVOFAB_E2E_MOCK_SUPABASE === "1") {
    return (
      <CloudSlicerClient
        materialProfiles={[
          {
            id: "pla-fgf",
            name: "PLA FGF",
            printer_type: "FGF",
            nozzle_temp: 190,
            bed_temp: 60,
            speed: 18,
            flow_rate: 100,
            fan_speed: 40,
            notes: "Mock profile",
            created_at: "2026-07-08T00:00:00.000Z",
          },
        ]}
        printers={[
          {
            id: "printer-fgf",
            name: "FGF Printer",
            model: "FGF Printer",
            ip: "127.0.0.1",
            port: 7125,
            type: "FGF",
            material: "PLA",
            build_volume: "300x300x400mm",
            webcam_url: null,
            is_active: true,
            created_at: "2026-07-08T00:00:00.000Z",
          },
        ]}
      />
    );
  }

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
