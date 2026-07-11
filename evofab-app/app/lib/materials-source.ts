import { createClient } from "@/app/lib/supabase-server";
import type { MaterialsSnapshot } from "@/app/types/material";

export async function getMaterialsSnapshot(): Promise<MaterialsSnapshot> {
  const supabase = await createClient();
  const [materials, stock, events, profiles] = await Promise.all([
    supabase.from("materials").select("*").order("name"),
    supabase
      .from("material_stock")
      .select("*")
      .order("received_at", { ascending: false }),
    supabase
      .from("material_events")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("material_profiles")
      .select("id,name,printer_type,material_id")
      .order("name"),
  ]);
  const failure = [materials, stock, events, profiles].find(
    (result) => result.error,
  )?.error;
  if (failure) throw new Error(failure.message);
  return {
    materials: materials.data ?? [],
    stock: stock.data ?? [],
    events: events.data ?? [],
    profiles: profiles.data ?? [],
  } as MaterialsSnapshot;
}
