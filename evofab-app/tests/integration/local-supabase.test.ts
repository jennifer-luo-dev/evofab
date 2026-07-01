// @vitest-environment node

import { describe, expect, it } from "vitest";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isLoopback = (() => {
  try {
    return Boolean(
      supabaseUrl &&
      ["127.0.0.1", "localhost", "::1"].includes(new URL(supabaseUrl).hostname),
    );
  } catch {
    return false;
  }
})();

describe.skipIf(!isLoopback || !anonKey)("local Supabase schema", () => {
  it("contains only the deterministic mock printer fixture", async () => {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/printers?select=id,name,ip,port`,
      {
        headers: {
          apikey: anonKey!,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    );
    expect(response.ok).toBe(true);
    const printers = await response.json();
    expect(printers).toHaveLength(3);
    expect(printers).toContainEqual(
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Mock Sovol Zero",
        ip: "127.0.0.1",
        port: 7125,
      }),
    );
  });
});
