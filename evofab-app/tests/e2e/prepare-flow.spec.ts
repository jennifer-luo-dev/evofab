import { createServer, type Server } from "node:http";
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

let supabaseMock: Server;

test.beforeAll(async () => {
  supabaseMock = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:54321");
    response.setHeader("content-type", "application/json");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "*");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === "/rest/v1/material_profiles") {
      response.end(
        JSON.stringify([
          {
            id: "pla-fgf",
            name: "PLA FGF",
            printer_type: "FGF",
            nozzle_temp: 190,
            bed_temp: 60,
            speed: 18,
            flow_rate: 100,
            fan_speed: 40,
            notes: "Mock profile",
            created_at: "2026-07-08T00:00:00.000Z",
            material_id: "material-pla-fgf",
          },
          {
            id: "cool-flex",
            name: "Flexible Polymer",
            printer_type: "BOTH",
            nozzle_temp: 220,
            bed_temp: 50,
            speed: 25,
            flow_rate: 0.95,
            fan_speed: 35,
            notes: "Temporary placeholder",
            created_at: "2026-07-08T00:00:00.000Z",
            material_id: "material-cool-flex",
          },
        ]),
      );
      return;
    }

    if (url.pathname === "/rest/v1/materials") {
      response.end(
        JSON.stringify([
          {
            id: "material-pla-fgf",
            slug: "pla-pellets",
            name: "PLA Pellets",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            base_chemistry: "PLA",
            nominal_hardness: null,
            source_status: "verified",
            sds_url: "https://example.invalid/pla-sds.pdf",
            science: {},
            is_active: true,
            created_at: "2026-07-08T00:00:00Z",
            updated_at: "2026-07-08T00:00:00Z",
          },
          {
            id: "material-cool-flex",
            slug: "cool-flex",
            name: "Cool Flex",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            base_chemistry: "TPE",
            nominal_hardness: null,
            source_status: "verified",
            sds_url: null,
            science: {},
            is_active: true,
            created_at: "2026-07-08T00:00:00Z",
            updated_at: "2026-07-08T00:00:00Z",
          },
          {
            id: "material-unbound",
            slug: "unbound",
            name: "Unbound Pellet",
            technology: "FGF",
            form: "pellet",
            provider: "EvoFab",
            base_chemistry: "TPU",
            nominal_hardness: "70A",
            source_status: "verified",
            sds_url: null,
            science: {},
            is_active: true,
            created_at: "2026-07-08T00:00:00Z",
            updated_at: "2026-07-08T00:00:00Z",
          },
          {
            id: "material-elastic-resin",
            slug: "elastic-resin",
            name: "Elastic 50A V2",
            technology: "SLA",
            form: "resin",
            provider: "Formlabs",
            base_chemistry: null,
            nominal_hardness: "50A",
            source_status: "verified",
            sds_url: "https://example.invalid/elastic-sds.pdf",
            science: {},
            is_active: true,
            created_at: "2026-07-08T00:00:00Z",
            updated_at: "2026-07-08T00:00:00Z",
          },
        ]),
      );
      return;
    }

    if (url.pathname === "/rest/v1/material_stock") {
      response.end(
        JSON.stringify([
          {
            id: "stock-pla",
            material_id: "material-pla-fgf",
            lot_label: null,
            quantity: 2000,
            unit: "g",
            color: "Natural",
            location: null,
            received_at: "2026-07-08T00:00:00Z",
            received_by: null,
            status: "in_stock",
          },
          {
            id: "stock-flex",
            material_id: "material-cool-flex",
            lot_label: null,
            quantity: 1000,
            unit: "g",
            color: "Clear",
            location: null,
            received_at: "2026-07-08T00:00:00Z",
            received_by: null,
            status: "in_stock",
          },
          {
            id: "stock-unbound",
            material_id: "material-unbound",
            lot_label: null,
            quantity: 500,
            unit: "g",
            color: "Blue",
            location: null,
            received_at: "2026-07-08T00:00:00Z",
            received_by: null,
            status: "in_stock",
          },
          {
            id: "stock-resin",
            material_id: "material-elastic-resin",
            lot_label: null,
            quantity: 1,
            unit: "l",
            color: "Clear",
            location: null,
            received_at: "2026-07-08T00:00:00Z",
            received_by: null,
            status: "in_stock",
          },
        ]),
      );
      return;
    }

    if (url.pathname === "/rest/v1/printers") {
      response.end(
        JSON.stringify([
          {
            id: "printer-fgf",
            name: "FGF Printer",
            model: "FGF Printer",
            ip: "127.0.0.1",
            port: 7125,
            type: "FGF",
            material: "PLA",
            build_volume: "300x300x400mm",
            webcam_url: null,
            is_active: true,
            created_at: "2026-07-08T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    if (url.pathname === "/rest/v1/printer_status") {
      response.end(JSON.stringify([]));
      return;
    }

    response.writeHead(404);
    response.end(
      JSON.stringify({ message: `Unhandled mock path: ${url.pathname}` }),
    );
  });

  await new Promise<void>((resolve) => {
    supabaseMock.listen(54321, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    supabaseMock.close((error) => (error ? reject(error) : resolve()));
  });
});

test("mock prepare flow reaches slice preview", async ({ page }) => {
  await page.goto("/cloud-slicer");
  await expect(
    page.getByRole("heading", { name: "Cloud Slicer" }),
  ).toBeVisible();

  const stl = `solid smoke
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 0 20 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 20 0 0
    vertex 20 20 0
    vertex 0 20 0
  endloop
endfacet
endsolid smoke
`;
  const uploadInput = page.locator('input[type="file"]').first();
  await uploadInput.setInputFiles({
    name: "evofab-smoke.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(stl),
  });
  await expect(
    page.getByText("evofab-smoke.stl", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByLabel("Print target").selectOption("preform:sla");
  await expect(page.getByText("Elastic 50A V2")).toBeVisible();
  await page.getByText("Elastic 50A V2").click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByText("Prepare in PreForm", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/will not slice or create a printer job/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);

  await page.getByLabel("Print target").selectOption("printer:printer-fdm");
  await expect(page.getByLabel("Shore hardness")).toBeDisabled();
  await expect(page.getByText("Rigid", { exact: true })).toBeVisible();

  await page.getByLabel("Print target").selectOption("printer:printer-fgf");
  await expect(page.getByText("Elastic 50A V2")).toHaveCount(0);
  await expect(page.getByLabel("Shore hardness")).toHaveValue("0");
  await page.getByText("Unbound Pellet").click();
  await expect(page.getByText("Profile needed before slicing")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Shore hardness").fill("1");
  await expect(page.getByText("Temporary placeholder profile")).toBeVisible();
  await page.getByText("PLA Pellets").click();
  await page.getByRole("button", { name: "Natural", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByLabel("Add supports").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(page.getByText("Slice complete.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Slice Preview" }),
  ).toBeVisible();
  await expect(page.getByText(/48 reported|reported/)).toBeVisible();
});
