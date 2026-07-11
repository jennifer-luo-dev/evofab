import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  readFgfCsv,
  readSdsXlsx,
  reconcile,
  slugify,
} from "../scripts/materials-import";

const fixture = (...parts: string[]) =>
  path.join(process.cwd(), "scripts", "fixtures", ...parts);

test("normalizes stable material slugs", () =>
  assert.equal(slugify(" Bambu PLA Basic @System "), "bambu-pla-basic-system"));

test("parses FGF characterization and source decisions", async () => {
  const rows = await readFgfCsv(fixture("FGF Materials Database.csv"));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].source_status, "verified");
  assert.equal(rows[0].science.airtightness, "pass");
  assert.equal(rows[3].is_active, false);
});

test("parses filament, pellet, and SLA catalog rows from xlsx", async () => {
  const values = JSON.parse(
    await fs.readFile(fixture("materials-sds.json"), "utf8"),
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "materials-sds-"));
  const file = path.join(directory, "sds.xlsx");
  const escape = (value: unknown) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xmlRows = values
    .map(
      (row: unknown[], rowIndex: number) =>
        `<row r="${rowIndex + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${rowIndex + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
  await fs.writeFile(
    file,
    zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheetXml) }),
  );
  const rows = await readSdsXlsx(file);
  assert.deepEqual(
    rows.map((row) => row.technology),
    ["FDM", "FGF", "SLA"],
  );
  assert.equal(rows[2].form, "resin");
  assert.match(rows[0].sds_url ?? "", /^https:/);
});

test("merges duplicate supplier rows and is idempotent", async () => {
  const fgf = await readFgfCsv(fixture("FGF Materials Database.csv"));
  const duplicate = { ...fgf[0], sds_url: "https://example.invalid/sds" };
  const once = reconcile([fgf, [duplicate]]);
  const twice = reconcile([once.rows, once.rows]);
  assert.equal(once.merged, 1);
  assert.equal(once.rows.length, fgf.length);
  assert.equal(once.rows[0].base_chemistry, "Thermolast K");
  assert.equal(once.rows[0].source_status, "verified");
  assert.equal(twice.rows.length, once.rows.length);
});
