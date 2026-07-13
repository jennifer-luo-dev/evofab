import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMaterialPickerOptions,
  availableHardnessBuckets,
  filterMaterialPickerOptionsForHardness,
  hardnessBucket,
  filterMaterialPickerOptionsForTechnology,
} from "../app/lib/material-picker";
import type { Material, MaterialStock } from "../app/types/material";
import type { MaterialProfile } from "../app/types/job";

const material = (overrides: Partial<Material> = {}): Material => ({
  id: "material-a",
  slug: "material-a",
  name: "Material A",
  technology: "FGF",
  form: "pellet",
  provider: "Provider",
  base_chemistry: "TPE",
  nominal_hardness: "50A",
  source_status: "verified",
  sds_url: "https://example.invalid/sds.pdf",
  science: {},
  is_active: true,
  created_at: "2026-07-12T00:00:00Z",
  updated_at: "2026-07-12T00:00:00Z",
  ...overrides,
});
const lot = (overrides: Partial<MaterialStock> = {}): MaterialStock => ({
  id: "stock-a",
  material_id: "material-a",
  lot_label: null,
  quantity: 1,
  unit: "g",
  color: "Natural",
  location: null,
  received_at: "2026-07-12T00:00:00Z",
  received_by: null,
  status: "in_stock",
  ...overrides,
});
const profile = (
  overrides: Partial<MaterialProfile> = {},
): MaterialProfile => ({
  id: "profile-a",
  name: "Profile A",
  printer_type: "FGF",
  nozzle_temp: 200,
  bed_temp: 50,
  speed: 20,
  flow_rate: 1,
  fan_speed: 0,
  notes: null,
  created_at: "2026-07-12T00:00:00Z",
  material_id: "material-a",
  ...overrides,
});

test("picker includes only verified active materials with positive non-depleted stock", () => {
  assert.equal(
    buildMaterialPickerOptions([material()], [lot()], [profile()]).length,
    1,
  );
  assert.equal(
    buildMaterialPickerOptions(
      [material({ source_status: "excluded" })],
      [lot()],
      [],
    ).length,
    0,
  );
  assert.equal(
    buildMaterialPickerOptions(
      [material({ source_status: "supplier" })],
      [lot()],
      [],
    ).length,
    0,
  );
  assert.equal(
    buildMaterialPickerOptions([material({ is_active: false })], [lot()], [])
      .length,
    0,
  );
  assert.equal(buildMaterialPickerOptions([material()], [], []).length, 0);
  assert.equal(
    buildMaterialPickerOptions([material()], [lot({ status: "depleted" })], [])
      .length,
    0,
  );
  assert.equal(
    buildMaterialPickerOptions([material()], [lot({ quantity: 0 })], []).length,
    0,
  );
});

test("picker aggregates positive lots and preserves unbound materials", () => {
  const options = buildMaterialPickerOptions(
    [material()],
    [
      lot(),
      lot({ id: "stock-b", quantity: 2 }),
      lot({ id: "stock-c", quantity: -1 }),
    ],
    [],
  );
  assert.equal(options.length, 1);
  assert.deepEqual(options[0].stock, [{ unit: "g", quantity: 3 }]);
  assert.equal(options[0].profile, null);
});

test("picker binds profiles and flags only cool-flex as placeholder", () => {
  const ordinary = buildMaterialPickerOptions(
    [material()],
    [lot()],
    [profile()],
  )[0];
  const placeholder = buildMaterialPickerOptions(
    [material()],
    [lot()],
    [profile({ id: "cool-flex" })],
  )[0];
  assert.equal(ordinary.profile?.id, "profile-a");
  assert.equal(ordinary.placeholderProfile, false);
  assert.equal(placeholder.profile?.id, "cool-flex");
  assert.equal(placeholder.placeholderProfile, true);
});

test("technology remains explicit for client target filtering", () => {
  const options = buildMaterialPickerOptions(
    [
      material(),
      material({
        id: "resin",
        slug: "resin",
        technology: "SLA",
        form: "resin",
      }),
    ],
    [lot(), lot({ id: "resin-stock", material_id: "resin", unit: "l" })],
    [],
  );
  assert.deepEqual(options.map((option) => option.technology).sort(), [
    "FGF",
    "SLA",
  ]);
  assert.deepEqual(
    filterMaterialPickerOptionsForTechnology(options, "FGF").map(
      (option) => option.id,
    ),
    ["material-a"],
  );
  assert.deepEqual(
    filterMaterialPickerOptionsForTechnology(options, "FDM"),
    [],
  );
  assert.deepEqual(filterMaterialPickerOptionsForTechnology(options, null), []);
});

test("picker normalizes Shore-A hardness and uses Rigid for non-elastomers", () => {
  assert.equal(hardnessBucket("70 A"), "70A");
  assert.equal(hardnessBucket(null), "Rigid");
  const options = buildMaterialPickerOptions(
    [material(), material({ id: "rigid", nominal_hardness: null })],
    [lot(), lot({ id: "rigid-lot", material_id: "rigid" })],
    [],
  );
  assert.deepEqual(availableHardnessBuckets(options), ["50A", "Rigid"]);
  assert.deepEqual(
    filterMaterialPickerOptionsForHardness(options, "Rigid").map(
      (option) => option.id,
    ),
    ["rigid"],
  );
});
