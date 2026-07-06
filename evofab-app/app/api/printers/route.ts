import { NextRequest, NextResponse } from "next/server";
import {
  initialPrinterStatus,
  normalizePrinterOnboardingInput,
  PrinterOnboardingError,
} from "@/app/lib/printer-onboarding";
import { getActivePrintersWithStatus } from "@/app/lib/printer-status-source";
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

export async function GET() {
  try {
    const printers = await getActivePrintersWithStatus();
    return NextResponse.json({ printers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load printers.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = normalizePrinterOnboardingInput(await req.json());
    const supabase = await createClient();
    const { data: printer, error } = await supabase
      .from("printers")
      .insert(input)
      .select()
      .single();

    if (error || !printer) {
      return errorResponse(
        500,
        "PRINTER_CREATE_FAILED",
        "Unable to create printer.",
        true,
        error?.message,
      );
    }

    const { error: statusError } = await supabase
      .from("printer_status")
      .upsert(initialPrinterStatus(printer.id), { onConflict: "printer_id" });

    if (statusError) {
      return errorResponse(
        500,
        "PRINTER_STATUS_CREATE_FAILED",
        "Printer was created, but its initial status row could not be created.",
        true,
        statusError.message,
      );
    }

    return NextResponse.json({ printer }, { status: 201 });
  } catch (error) {
    if (error instanceof PrinterOnboardingError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        false,
        error.details,
      );
    }
    return errorResponse(
      400,
      "PRINTER_INVALID_INPUT",
      "Unable to read printer onboarding request.",
      false,
    );
  }
}
