import {
  buildMaterialPickerOptions,
  type MaterialPickerOption,
} from "@/app/lib/material-picker";
import { createClient } from "@/app/lib/supabase-server";
import type { Material, MaterialStock } from "@/app/types/material";
import type { MaterialProfile } from "@/app/types/job";

export async function getMaterialPickerOptions(): Promise<
  MaterialPickerOption[]
> {
  const supabase = await createClient();
  const [materials, stock, profiles] = await Promise.all([
    supabase
      .from("materials")
      .select("*")
      .eq("source_status", "verified")
      .eq("is_active", true),
    supabase
      .from("material_stock")
      .select("*")
      .neq("status", "depleted")
      .gt("quantity", 0),
    supabase.from("material_profiles").select("*"),
  ]);
  const failure = [materials, stock, profiles].find(
    (result) => result.error,
  )?.error;
  if (failure) throw new Error(failure.message);
  return buildMaterialPickerOptions(
    (materials.data ?? []) as Material[],
    (stock.data ?? []) as MaterialStock[],
    (profiles.data ?? []) as MaterialProfile[],
  );
}
