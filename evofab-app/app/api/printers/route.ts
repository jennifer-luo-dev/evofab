import { NextResponse } from "next/server";
import { getActivePrintersWithStatus } from "@/app/lib/printer-status-source";

export async function GET() {
  try {
    const printers = await getActivePrintersWithStatus();
    return NextResponse.json({ printers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load printers.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
