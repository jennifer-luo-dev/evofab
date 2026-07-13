import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CatalogMaterial = {
  id: string;
  slug: string;
  technology: "FDM" | "FGF" | "SLA";
  form: "filament" | "pellet" | "resin";
};

export function seedSpec(material: CatalogMaterial) {
  if (material.form === "pellet")
    return {
      quantity: 1,
      unit: "kg",
      color: "Natural",
      canonicalUnit: "g",
      canonicalQuantity: 1000,
    };
  if (material.form === "filament")
    return {
      quantity: 1,
      unit: "spool",
      color: "Black",
      canonicalUnit: "g",
      canonicalQuantity: 1000,
    };
  return {
    quantity: 1,
    unit: "l",
    color: "Clear",
    canonicalUnit: "l",
    canonicalQuantity: 1,
  };
}

export function reconcileSeed(materials: CatalogMaterial[]) {
  const byForm = Object.fromEntries(
    ["pellet", "filament", "resin"].map((form) => {
      const rows = materials.filter((material) => material.form === form);
      const spec = rows[0] ? seedSpec(rows[0]) : null;
      return [
        form,
        {
          rows: rows.length,
          unit: spec?.canonicalUnit ?? (form === "resin" ? "l" : "g"),
          total: rows.reduce(
            (sum, material) => sum + seedSpec(material).canonicalQuantity,
            0,
          ),
        },
      ];
    }),
  );
  const byTechnology = Object.fromEntries(
    ["FDM", "FGF", "SLA"].map((technology) => [
      technology,
      materials.filter((material) => material.technology === technology).length,
    ]),
  );
  return {
    rows: materials.length,
    by_technology: byTechnology,
    by_form: byForm,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "materials:seed-stock requires Supabase URL and service-role key",
    );
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: materials, error: materialsError } = await client
    .from("materials")
    .select("id,slug,technology,form")
    .order("slug");
  if (materialsError) throw materialsError;
  const catalog = (materials ?? []) as CatalogMaterial[];
  if (catalog.length !== 37)
    throw new Error(`Expected 37 catalog materials; found ${catalog.length}`);
  const labels = catalog.map((material) => `v0.7-seed-${material.slug}`);
  const { data: existing, error: existingError } = await client
    .from("material_stock")
    .select("lot_label")
    .in("lot_label", labels);
  if (existingError) throw existingError;
  if ((existing ?? []).length && !dryRun)
    throw new Error("Seed lots already exist; refusing duplicate intake");
  const reconciliation = reconcileSeed(catalog);
  if (!dryRun) {
    for (const material of catalog) {
      const spec = seedSpec(material);
      const { error } = await client.rpc("intake_material_stock", {
        p_material_id: material.id,
        p_quantity: spec.quantity,
        p_unit: spec.unit,
        p_color: spec.color,
        p_lot_label: `v0.7-seed-${material.slug}`,
        p_location: "EvoFab seed inventory",
        p_actor: "v0.7 seed",
        p_note: "Initial v0.7 stock seed",
        p_net_weight_grams: material.form === "filament" ? 1000 : undefined,
      });
      if (error) throw error;
    }
  }
  console.log(
    JSON.stringify(
      {
        dry_run: dryRun,
        existing_seed_lots: (existing ?? []).length,
        ...reconciliation,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
