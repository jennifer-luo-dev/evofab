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
      !["spool", "kg", "l"].includes(text(body.unit)) ||
      !text(body.color)
    )
      return NextResponse.json(
        {
          error:
            "Material, color, positive quantity, and valid unit are required",
        },
        { status: 400 },
      );
    const { data, error } = await supabase.rpc("intake_material_stock", {
      p_material_id: text(body.material_id),
      p_quantity: quantity,
      p_unit: text(body.unit),
      p_color: text(body.color),
      p_lot_label: text(body.lot_label) || null,
      p_location: text(body.location) || null,
      p_actor: text(body.actor) || null,
      p_note: text(body.note) || null,
      p_net_weight_grams: number(body.net_weight_grams) || 1000,
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
    const delta = number(body.delta);
    if (
      !text(body.id) ||
      !Number.isFinite(delta) ||
      delta === 0 ||
      !text(body.note)
    )
      return NextResponse.json(
        { error: "Stock id, non-zero delta, and adjustment note are required" },
        { status: 400 },
      );
    const { error } = await supabase.rpc("adjust_material_stock", {
      p_stock_id: text(body.id),
      p_delta: delta,
      p_actor: text(body.actor) || null,
      p_note: text(body.note) || null,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === "retire") {
    if (!text(body.id))
      return NextResponse.json(
        { error: "Material id is required" },
        { status: 400 },
      );
    const { error } = await supabase
      .from("materials")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", text(body.id));
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    const { error: eventError } = await supabase
      .from("material_events")
      .insert({
        material_id: text(body.id),
        event_type: "retired",
        actor: text(body.actor) || null,
        note: text(body.note) || "Catalog material retired",
      });
    if (eventError)
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === "loadout") {
    const printerId = text(body.printer_id);
    const stockId = text(body.stock_id);
    if (!printerId || !stockId)
      return NextResponse.json(
        { error: "Printer and stock lot are required" },
        { status: 400 },
      );
    const { data: lot, error: lotError } = await supabase
      .from("material_stock")
      .select("id,quantity,status")
      .eq("id", stockId)
      .maybeSingle();
    if (lotError)
      return NextResponse.json({ error: lotError.message }, { status: 500 });
    if (!lot || Number(lot.quantity) <= 0 || lot.status === "depleted")
      return NextResponse.json(
        { error: "Only positive, non-depleted lots can be loaded" },
        { status: 400 },
      );
    const { error } = await supabase.from("printer_material_loadout").upsert(
      {
        printer_id: printerId,
        stock_id: stockId,
        loaded_by: text(body.actor) || null,
        note: text(body.note) || null,
        loaded_at: new Date().toISOString(),
      },
      { onConflict: "printer_id" },
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === "clear_loadout") {
    if (!text(body.printer_id))
      return NextResponse.json(
        { error: "Printer is required" },
        { status: 400 },
      );
    const { error } = await supabase
      .from("printer_material_loadout")
      .delete()
      .eq("printer_id", text(body.printer_id));
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
