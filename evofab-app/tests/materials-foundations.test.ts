import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260712010000_materials_foundations.sql",
  ),
  "utf8",
);
test("intake writes stock and its received event in one function", () => {
  const body =
    sql.match(
      /CREATE OR REPLACE FUNCTION intake_material_stock[\s\S]*?\$\$;/,
    )?.[0] ?? "";
  assert.match(body, /INSERT INTO material_stock/);
  assert.match(body, /INSERT INTO material_events/);
  assert.match(body, /'received'/);
});
test("material events reject update and delete", () => {
  assert.match(sql, /BEFORE UPDATE OR DELETE ON material_events/);
  assert.match(sql, /append-only/);
});
test("catalog supports SLA without adding an SLA print path", () => {
  assert.match(sql, /technology IN \('FDM', 'FGF', 'SLA'\)/);
  assert.match(
    sql,
    /printers_type_check CHECK \(type IN \('FGF', 'FDM', 'SLA'\)\)/,
  );
});
