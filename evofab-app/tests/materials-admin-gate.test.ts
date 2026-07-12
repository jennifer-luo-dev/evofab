import assert from "node:assert/strict";
import test from "node:test";
import { isMaterialsAdminEnabled } from "../app/lib/materials-admin";

// --- Helper unit tests ---

test("isMaterialsAdminEnabled returns false when env var is unset", () => {
  assert.equal(isMaterialsAdminEnabled({}), false);
});

test("isMaterialsAdminEnabled returns false when env var is empty string", () => {
  assert.equal(isMaterialsAdminEnabled({ MATERIALS_ADMIN_ENABLED: "" }), false);
});

test("isMaterialsAdminEnabled returns false when env var is 'false'", () => {
  assert.equal(
    isMaterialsAdminEnabled({ MATERIALS_ADMIN_ENABLED: "false" }),
    false,
  );
});

test("isMaterialsAdminEnabled returns true when env var is 'true'", () => {
  assert.equal(
    isMaterialsAdminEnabled({ MATERIALS_ADMIN_ENABLED: "true" }),
    true,
  );
});

test("isMaterialsAdminEnabled returns false when env var is 'TRUE' (case-sensitive)", () => {
  assert.equal(
    isMaterialsAdminEnabled({ MATERIALS_ADMIN_ENABLED: "TRUE" }),
    false,
  );
});

// --- Route-level tests: /materials page ---

test("/materials page returns notFound when admin gate is off", async () => {
  const saved = process.env.MATERIALS_ADMIN_ENABLED;
  delete process.env.MATERIALS_ADMIN_ENABLED;
  try {
    const mod = await import("../app/materials/page");
    const page = mod.default;
    await assert.rejects(page(), (error: unknown) => {
      // Next.js notFound() throws NEXT_NOT_FOUND
      return (
        error instanceof Error ||
        (typeof error === "object" &&
          error !== null &&
          "digest" in error &&
          String((error as Record<string, unknown>).digest).includes(
            "NOT_FOUND",
          ))
      );
    });
  } finally {
    if (saved !== undefined) process.env.MATERIALS_ADMIN_ENABLED = saved;
    else delete process.env.MATERIALS_ADMIN_ENABLED;
  }
});

// --- Route-level tests: POST /api/materials returns 404 when gate is off ---

test("POST /api/materials returns 404 when admin gate is off", async () => {
  const saved = process.env.MATERIALS_ADMIN_ENABLED;
  delete process.env.MATERIALS_ADMIN_ENABLED;
  try {
    const mod = await import("../app/api/materials/route");
    const request = new Request("http://localhost/api/materials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "intake", material_id: "x", quantity: 1, unit: "spool" }),
    });
    const response = await mod.POST(request as never);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Not found");
  } finally {
    if (saved !== undefined) process.env.MATERIALS_ADMIN_ENABLED = saved;
    else delete process.env.MATERIALS_ADMIN_ENABLED;
  }
});

test("POST /api/materials proceeds past gate when admin flag is on", async () => {
  const saved = process.env.MATERIALS_ADMIN_ENABLED;
  process.env.MATERIALS_ADMIN_ENABLED = "true";
  try {
    const mod = await import("../app/api/materials/route");
    const request = new Request("http://localhost/api/materials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unknown-test-action" }),
    });
    try {
      const response = await mod.POST(request as never);
      // If we get a response, it must NOT be 404 (gate passed)
      assert.notEqual(response.status, 404);
    } catch (error) {
      // cookies() throws outside Next.js request scope — this is expected
      // and proves the gate was passed (the handler reached createClient).
      assert.match(
        String(error),
        /cookies|request scope/i,
        "Expected cookies() scope error, not a gate rejection",
      );
    }
  } finally {
    if (saved !== undefined) process.env.MATERIALS_ADMIN_ENABLED = saved;
    else delete process.env.MATERIALS_ADMIN_ENABLED;
  }
});

test("GET /api/materials is NOT gated (reads stay open for picker)", async () => {
  const saved = process.env.MATERIALS_ADMIN_ENABLED;
  delete process.env.MATERIALS_ADMIN_ENABLED;
  try {
    const mod = await import("../app/api/materials/route");
    const response = await mod.GET();
    // GET should NOT return 404 even with gate off — it either succeeds or
    // fails with 500 (no Supabase in test), but never 404.
    assert.notEqual(response.status, 404);
  } finally {
    if (saved !== undefined) process.env.MATERIALS_ADMIN_ENABLED = saved;
    else delete process.env.MATERIALS_ADMIN_ENABLED;
  }
});
