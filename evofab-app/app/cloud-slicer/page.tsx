import { CloudSlicerClient } from "@/app/components/cloud-slicer/CloudSlicerClient";
import { createClient } from "@/app/lib/supabase-server";
import type { MaterialProfile } from "@/app/types/job";
import type { Printer } from "@/app/types/printer";
import { getMaterialPickerOptions } from "@/app/lib/material-picker-server";

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
            material_id: "material-pla-fgf",
          },
          {
            id: "cool-flex",
            name: "Flexible Polymer",
            printer_type: "BOTH",
            nozzle_temp: 220,
            bed_temp: 50,
            speed: 25,
            flow_rate: 0.95,
            fan_speed: 35,
            notes: "Temporary placeholder",
            created_at: "2026-07-08T00:00:00.000Z",
            material_id: "material-cool-flex",
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
        materialOptions={[
          {
            id: "material-pla-fgf",
            name: "PLA Pellets",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            baseChemistry: "PLA",
            nominalHardness: null,
            sdsUrl: "https://example.invalid/pla-sds.pdf",
            stock: [{ unit: "kg", quantity: 2 }],
            profile: {
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
              material_id: "material-pla-fgf",
            },
            placeholderProfile: false,
          },
          {
            id: "material-cool-flex",
            name: "Cool Flex",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            baseChemistry: "TPE",
            nominalHardness: null,
            sdsUrl: null,
            stock: [{ unit: "kg", quantity: 1 }],
            profile: {
              id: "cool-flex",
              name: "Flexible Polymer",
              printer_type: "BOTH",
              nozzle_temp: 220,
              bed_temp: 50,
              speed: 25,
              flow_rate: 0.95,
              fan_speed: 35,
              notes: "Temporary placeholder",
              created_at: "2026-07-08T00:00:00.000Z",
              material_id: "material-cool-flex",
            },
            placeholderProfile: true,
          },
          {
            id: "material-unbound",
            name: "Unbound Pellet",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            baseChemistry: "TPU",
            nominalHardness: "70A",
            sdsUrl: null,
            stock: [{ unit: "kg", quantity: 0.5 }],
            profile: null,
            placeholderProfile: false,
          },
          {
            id: "material-elastic-resin",
            name: "Elastic 50A V2",
            technology: "SLA",
            form: "resin",
            provider: "Formlabs",
            baseChemistry: null,
            nominalHardness: "50A",
            sdsUrl: "https://example.invalid/elastic-sds.pdf",
            stock: [{ unit: "l", quantity: 1 }],
            profile: null,
            placeholderProfile: false,
          },
        ]}
        materialOptionsError={null}
      />
    );
  }

  const supabase = await createClient();
  const [
    { data: materialProfiles, error },
    { data: printers, error: printersError },
    materialOptionsResult,
  ] = await Promise.all([
    supabase.from("material_profiles").select("*").order("name"),
    supabase.from("printers").select("*").eq("is_active", true).order("name"),
    getMaterialPickerOptions()
      .then((data) => ({ data, error: null }))
      .catch((caught) => ({
        data: [],
        error:
          caught instanceof Error
            ? caught.message
            : "Unable to load available materials",
      })),
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
      materialOptions={materialOptionsResult.data}
      materialOptionsError={materialOptionsResult.error}
    />
  );
}
