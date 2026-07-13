import type {
  Material,
  MaterialStock,
  MaterialTechnology,
} from "@/app/types/material";
import type { MaterialProfile } from "@/app/types/job";

export interface MaterialPickerStockSummary {
  unit: MaterialStock["unit"];
  quantity: number;
}
export interface MaterialPickerLot {
  id: string;
  color: string;
  lotLabel: string | null;
  quantity: number;
  unit: MaterialStock["unit"];
}
export interface MaterialPickerOption {
  id: string;
  name: string;
  technology: MaterialTechnology;
  form: Material["form"];
  provider: string | null;
  baseChemistry: string | null;
  nominalHardness: string | null;
  sdsUrl: string | null;
  stock: MaterialPickerStockSummary[];
  lots: MaterialPickerLot[];
  profile: MaterialProfile | null;
  placeholderProfile: boolean;
}

export function hardnessBucket(nominalHardness: string | null): string {
  const match = nominalHardness?.match(/\b(\d{1,3})\s*A\b/i);
  return match ? `${match[1]}A` : "Rigid";
}

export function availableHardnessBuckets(
  options: MaterialPickerOption[],
): string[] {
  return [
    ...new Set(options.map((option) => hardnessBucket(option.nominalHardness))),
  ].sort((a, b) =>
    a === "Rigid" ? 1 : b === "Rigid" ? -1 : Number(a) - Number(b),
  );
}

export function filterMaterialPickerOptionsForHardness(
  options: MaterialPickerOption[],
  hardness: string | null | undefined,
): MaterialPickerOption[] {
  if (!hardness) return [];
  return options.filter(
    (option) => hardnessBucket(option.nominalHardness) === hardness,
  );
}

export function filterMaterialPickerOptionsForTechnology(
  options: MaterialPickerOption[],
  technology: MaterialTechnology | null | undefined,
): MaterialPickerOption[] {
  if (!technology) return [];
  return options.filter((option) => option.technology === technology);
}

export function buildMaterialPickerOptions(
  materials: Material[],
  stock: MaterialStock[],
  profiles: MaterialProfile[],
): MaterialPickerOption[] {
  const profilesByMaterial = new Map(
    profiles
      .filter((profile) => profile.material_id)
      .map((profile) => [profile.material_id as string, profile]),
  );
  return materials
    .flatMap((material) => {
      if (material.source_status !== "verified" || !material.is_active)
        return [];
      const totals = new Map<MaterialStock["unit"], number>();
      const lots: MaterialPickerLot[] = [];
      for (const lot of stock) {
        const quantity = Number(lot.quantity);
        if (
          lot.material_id !== material.id ||
          lot.status === "depleted" ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        )
          continue;
        totals.set(lot.unit, (totals.get(lot.unit) ?? 0) + quantity);
        lots.push({
          id: lot.id,
          color: lot.color,
          lotLabel: lot.lot_label,
          quantity,
          unit: lot.unit,
        });
      }
      if (totals.size === 0) return [];
      const profile = profilesByMaterial.get(material.id) ?? null;
      return [
        {
          id: material.id,
          name: material.name,
          technology: material.technology,
          form: material.form,
          provider: material.provider,
          baseChemistry: material.base_chemistry,
          nominalHardness: material.nominal_hardness,
          sdsUrl: material.sds_url,
          stock: [...totals].map(([unit, quantity]) => ({ unit, quantity })),
          lots: lots.sort(
            (a, b) =>
              a.color.localeCompare(b.color) || a.id.localeCompare(b.id),
          ),
          profile,
          placeholderProfile: profile?.id === "cool-flex",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
