import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { isMaterialsAdminEnabled } from "@/app/lib/materials-admin";
import { getMaterialsSnapshot } from "@/app/lib/materials-source";

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const number = (value: unknown) =>
  typeof value === "number" ? value : Number(value);

export async function GET() {
  try {
    return NextResponse.json(await getMaterialsSnapshot());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load materials",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isMaterialsAdminEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json();
  const action = text(body.action);
  const supabase = await createClient();
  if (action === "intake") {
    const quantity = number(body.quantity);
    if (
      !text(body.material_id) ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !["spool", "kg", "l", "unit"].includes(text(body.unit))
    )
      return NextResponse.json(
        { error: "Material, positive quantity, and valid unit are required" },
        { status: 400 },
      );
    const { data, error } = await supabase.rpc("intake_material_stock", {
      p_material_id: text(body.material_id),
      p_quantity: quantity,
      p_unit: text(body.unit),
      p_lot_label: text(body.lot_label) || null,
      p_location: text(body.location) || null,
      p_actor: text(body.actor) || null,
      p_note: text(body.note) || null,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ stock: data }, { status: 201 });
  }
  if (action === "material") {
    const id = text(body.id);
    if (!id || !text(body.name))
      return NextResponse.json(
        { error: "Material id and name are required" },
        { status: 400 },
      );
    const { error } = await supabase
      .from("materials")
      .update({
        name: text(body.name),
        provider: text(body.provider) || null,
        source_status: text(body.source_status),
        sds_url: text(body.sds_url) || null,
        is_active: Boolean(body.is_active),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === "stock") {
    const quantity = number(body.quantity);
    if (!text(body.id) || !Number.isFinite(quantity) || quantity < 0)
      return NextResponse.json(
        { error: "Stock id and non-negative quantity are required" },
        { status: 400 },
      );
    const { error } = await supabase.rpc("adjust_material_stock", {
      p_stock_id: text(body.id),
      p_quantity: quantity,
      p_status: text(body.status),
      p_actor: text(body.actor) || null,
      p_note: text(body.note) || null,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === "profile") {
    if (!text(body.id))
      return NextResponse.json(
        { error: "Profile id is required" },
        { status: 400 },
      );
    const { error } = await supabase
      .from("material_profiles")
      .update({ material_id: text(body.material_id) || null })
      .eq("id", text(body.id));
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    { error: "Unknown materials action" },
    { status: 400 },
  );
}
