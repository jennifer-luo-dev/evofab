// route.ts (api/print-profiles)
// Lists print profiles (`print_profiles` — see evofab-app/supabase/schema.sql)
// — backs the pipeline builder's print settings picker for `printer` steps
// (StepDraftForm's embedded PrintSettingsPanel).

import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";

/** GET /api/print-profiles — Returns all print profiles, ordered by name. */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("print_profiles")
    .select("*")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printProfiles: data ?? [] });
}
