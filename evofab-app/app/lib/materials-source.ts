import { createClient } from "@/app/lib/supabase-server";
import type {
  Material,
  MaterialAvailability,
  MaterialDashboardItem,
  MaterialsSnapshot,
} from "@/app/types/material";

export function availabilityForLots(
  stock: MaterialsSnapshot["stock"],
): MaterialAvailability {
  const available = stock.filter(
    (lot) => lot.status !== "depleted" && Number(lot.quantity) > 0,
  );
  if (available.length === 0) return "depleted";
  return available.every((lot) => lot.status === "low") ? "low" : "in_stock";
}

export function buildMaterialDashboardItems(
  materials: Material[],
  stock: MaterialsSnapshot["stock"],
): MaterialDashboardItem[] {
  return materials
    .filter(
      (material) => material.is_active && material.source_status !== "excluded",
    )
    .map((material) => {
      const lots = stock.filter((lot) => lot.material_id === material.id);
      return {
        ...material,
        stock: lots,
        availability: availabilityForLots(lots),
        colors: [...new Set(lots.map((lot) => lot.color).filter(Boolean))],
      };
    })
    .sort((a, b) => {
      const priority = (item: MaterialDashboardItem) =>
        item.source_status === "verified" && item.availability === "in_stock"
          ? 0
          : 1;
      return priority(a) - priority(b) || a.name.localeCompare(b.name);
    });
}

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

export async function getMaterialDashboardItems(): Promise<
  MaterialDashboardItem[]
> {
  const snapshot = await getMaterialsSnapshot();
  return buildMaterialDashboardItems(snapshot.materials, snapshot.stock);
}

export async function getMaterialBySlug(slug: string) {
  const snapshot = await getMaterialsSnapshot();
  const supabase = await createClient();
  const { data: printers, error: printersError } = await supabase
    .from("printers")
    .select("id,name,type")
    .eq("is_active", true)
    .order("name");
  if (printersError) throw new Error(printersError.message);
  const material = snapshot.materials.find(
    (candidate) =>
      candidate.slug === slug &&
      candidate.is_active &&
      candidate.source_status !== "excluded",
  );
  if (!material) return null;
  const stock = snapshot.stock.filter((lot) => lot.material_id === material.id);
  return {
    ...material,
    stock,
    events: snapshot.events.filter(
      (event) => event.material_id === material.id,
    ),
    printers: printers ?? [],
    availability: availabilityForLots(stock),
  };
}
