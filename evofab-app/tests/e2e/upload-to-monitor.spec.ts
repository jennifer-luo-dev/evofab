import { test, expect } from "@playwright/test";

test("uploads G-code to the mock printer and opens monitoring", async ({
  page,
}) => {
  await page.goto("/setup");
  await page.request.post("/api/demo/scenario", {
    data: { scenario: "ready" },
  });
  const printer = page.getByRole("button", { name: /Mock Sovol Zero/i });
  await expect(printer).toBeEnabled({ timeout: 15_000 });
  await printer.click();
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/prusa-header.gcode");
  await expect(page.getByText(/Settings detected · PrusaSlicer/)).toBeVisible();
  await page.getByRole("button", { name: /Submit Job/i }).click();
  await expect(page).toHaveURL(/\/monitor\/[0-9a-f-]+$/);
  await expect(page.getByText("Live fabrication")).toBeVisible();
  await expect(
    page.getByText(/Print started · telemetry stream connected/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await expect(page.locator('[title="Paused"]')).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole("button", { name: "▶ Resume", exact: true }).click();
  await expect(page.locator('[title="Printing"]')).toBeVisible({
    timeout: 5_000,
  });

  await page.getByRole("button", { name: /MCU Fault/i }).click();
  await expect(page.getByText(/Klipper reports: SHUTDOWN/)).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole("button", { name: /Firmware restart/i }).click();
  await expect(page.locator('[title="Idle"]')).toBeVisible({ timeout: 5_000 });
});
