import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { MoonrakerClient, MoonrakerError } from "@/app/lib/moonraker";

const ACTIONS = new Set([
  "pause",
  "resume",
  "cancel",
  "emergency-stop",
  "restart",
  "firmware-restart",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { action, jobId } = await request.json();
  if (!ACTIONS.has(action))
    return NextResponse.json(
      { error: "Unknown printer action." },
      { status: 400 },
    );
  const supabase = await createClient();
  const { data: printer } = await supabase
    .from("printers")
    .select("id,ip,port")
    .eq("id", id)
    .single();
  if (!printer)
    return NextResponse.json({ error: "Printer not found." }, { status: 404 });

  try {
    const client = new MoonrakerClient({
      printerId: id,
      ip: printer.ip,
      port: printer.port,
    });
    if (action === "pause") await client.pausePrint();
    if (action === "resume") await client.resumePrint();
    if (action === "cancel") await client.cancelPrint();
    if (action === "emergency-stop") await client.emergencyStop();
    if (action === "restart") await client.restart();
    if (action === "firmware-restart") await client.firmwareRestart();

    if (jobId) {
      const label =
        action === "firmware-restart"
          ? "Firmware restart completed"
          : `Printer command: ${action}`;
      await supabase.from("logs").insert({
        job_id: jobId,
        message: label,
        type: action === "emergency-stop" ? "error" : "info",
      });
      if (action === "cancel")
        await supabase
          .from("jobs")
          .update({ status: "aborted", completed_at: new Date().toISOString() })
          .eq("id", jobId);
    }
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    const payload =
      error instanceof MoonrakerError
        ? error.toJSON()
        : { message: "Printer command failed." };
    return NextResponse.json({ error: payload }, { status: 502 });
  }
}
