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
  profile: MaterialProfile | null;
  placeholderProfile: boolean;
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
          profile,
          placeholderProfile: profile?.id === "cool-flex",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
