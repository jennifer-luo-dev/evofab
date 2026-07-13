import assert from "node:assert/strict";
import test from "node:test";
import { buildMaterialDashboardItems } from "../app/lib/materials-source";
import { reconcileSeed, seedSpec } from "../scripts/materials-seed-stock";
import type { Material, MaterialStock } from "../app/types/material";

const material = (overrides: Partial<Material> = {}): Material => ({
  id: "material-a",
  slug: "material-a",
  name: "Material A",
  technology: "FGF",
  form: "pellet",
  provider: null,
  base_chemistry: null,
  nominal_hardness: "70A",
  source_status: "verified",
  sds_url: null,
  science: {},
  is_active: true,
  created_at: "",
  updated_at: "",
  ...overrides,
});
const lot = (overrides: Partial<MaterialStock> = {}): MaterialStock => ({
  id: "lot-a",
  material_id: "material-a",
  lot_label: null,
  quantity: 1000,
  unit: "g",
  color: "Natural",
  location: null,
  received_at: "",
  received_by: null,
  status: "in_stock",
  ...overrides,
});

test("dashboard excludes inactive/excluded materials and prioritizes verified in-stock", () => {
  const items = buildMaterialDashboardItems(
    [
      material({ name: "Later" }),
      material({ id: "excluded", slug: "excluded", source_status: "excluded" }),
      material({ id: "low", slug: "low", name: "Earlier" }),
    ],
    [lot(), lot({ id: "low-lot", material_id: "low", status: "low" })],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["material-a", "low"],
  );
  assert.equal(items[1].availability, "low");
});
test("dashboard marks material depleted without a positive available lot", () => {
  assert.equal(
    buildMaterialDashboardItems(
      [material()],
      [lot({ quantity: 0, status: "depleted" })],
    )[0].availability,
    "depleted",
  );
});
test("seed conversions are canonical and reconciliation totals forms", () => {
  assert.deepEqual(
    seedSpec({ id: "x", slug: "x", technology: "FDM", form: "filament" }),
    {
      quantity: 1,
      unit: "spool",
      color: "Black",
      canonicalUnit: "g",
      canonicalQuantity: 1000,
    },
  );
  const report = reconcileSeed([
    { id: "p", slug: "p", technology: "FGF", form: "pellet" },
    { id: "r", slug: "r", technology: "SLA", form: "resin" },
  ]);
  assert.equal(report.rows, 2);
  assert.equal(report.by_technology.FGF, 1);
  assert.equal((report.by_form.pellet as { total: number }).total, 1000);
  assert.equal((report.by_form.resin as { total: number }).total, 1);
});
