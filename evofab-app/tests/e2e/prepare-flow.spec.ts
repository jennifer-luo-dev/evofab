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

  await page.locator("select").selectOption("pla-fgf");
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
