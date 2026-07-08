import { NextRequest, NextResponse } from "next/server";
import {
  ConsoleError,
  sendConsoleCommand,
} from "@/app/lib/printer-console";
import { createClient } from "@/app/lib/supabase-server";

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: unknown,
) {
  return NextResponse.json(
    { error: { code, message, retryable, details } },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const supabase = await createClient();
  const { data: printer, error } = await supabase
    .from("printers")
    .select("ip, port")
    .eq("id", id)
    .single();

  if (error || !printer) {
    return errorResponse(
      404,
      "PRINTER_NOT_FOUND",
      "Printer not found.",
      false,
      error?.message,
    );
  }

  try {
    const consoleResult = await sendConsoleCommand(printer, body?.command);
    return NextResponse.json({ ok: true, console: consoleResult });
  } catch (error) {
    if (error instanceof ConsoleError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        error.retryable,
        error.details,
      );
    }
    return errorResponse(
      502,
      "CONSOLE_SEND_FAILED",
      error instanceof Error ? error.message : "Console command failed.",
      true,
    );
  }
}
