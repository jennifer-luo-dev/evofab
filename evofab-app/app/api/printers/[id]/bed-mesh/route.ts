import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { LevelingError, readBedMesh } from "@/app/lib/printer-leveling";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: printer, error } = await supabase
    .from("printers")
    .select("id, ip, port")
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
    const mesh = await readBedMesh(printer);
    return NextResponse.json({ mesh });
  } catch (error) {
    if (error instanceof LevelingError) {
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
      "LEVELING_MESH_READ_FAILED",
      error instanceof Error ? error.message : "Unable to read bed mesh.",
      true,
    );
  }
}
