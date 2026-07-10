import { expect, test } from "@playwright/test";

test.skip(
  process.env.EVOFAB_HOST_E2E !== "1",
  "Run explicitly against the production lab host",
);

test("production prepare flow slices through the real host", async ({
  page,
}) => {
  const stlPath = process.env.EVOFAB_HOST_STL;
  if (!stlPath) {
    throw new Error("EVOFAB_HOST_STL must point to the acceptance cube STL");
  }

  const slicerResponses: Array<{ url: string; status: number; body: string }> =
    [];
  page.on("response", async (response) => {
    if (!response.url().includes("/api/slicer/")) return;
    slicerResponses.push({
      url: response.url(),
      status: response.status(),
      body: await response.text(),
    });
  });

  await page.goto("/cloud-slicer");
  await expect(
    page.getByRole("heading", { name: "Cloud Slicer" }),
  ).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles(stlPath);
  await expect(page.getByText("cube_20mm.stl", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  const materialSelect = page.locator("select");
  const materialOptions = await materialSelect
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => ({
          value: option.getAttribute("value") ?? "",
          label: option.textContent ?? "",
        }))
        .filter(({ value }) => value.length > 0),
    );
  expect(materialOptions.length).toBeGreaterThan(0);
  const material = materialOptions[0];
  console.log(
    `Host material profile: ${material.value} (${material.label.trim()})`,
  );
  await materialSelect.selectOption(material.value);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  const started = Date.now();
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(page.getByText("Slice complete.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("heading", { name: "Slice Preview" }),
  ).toBeVisible();

  const gcodeResponse = slicerResponses.find(({ url }) =>
    url.endsWith("/gcode"),
  );
  expect(gcodeResponse?.status).toBe(200);
  expect(gcodeResponse?.body.length).toBeGreaterThan(0);
  expect(gcodeResponse?.body).toMatch(/^G1[^;\r\n]*\sE[-+]?\d/m);
  expect(Date.now() - started).toBeLessThan(60_000);
});
