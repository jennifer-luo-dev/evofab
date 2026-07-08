import { NextRequest, NextResponse } from "next/server";
import { MoonrakerStatusConnector } from "@/app/lib/moonraker-client";
import { MoonrakerError } from "@/app/lib/moonraker-errors";
import {
  normalizePrinterConnectionTestInput,
  PrinterOnboardingError,
} from "@/app/lib/printer-onboarding";

function errorStatus(code: string): number {
  if (code === "MOONRAKER_TIMEOUT") return 504;
  if (code === "MOONRAKER_OFFLINE") return 502;
  if (code === "MOONRAKER_MALFORMED_RESPONSE") return 502;
  return 400;
}

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

export async function POST(req: NextRequest) {
  try {
    const printer = normalizePrinterConnectionTestInput(await req.json());
    const connector = new MoonrakerStatusConnector();
    const info = await connector.readServerInfo(printer);

    return NextResponse.json({ ok: true, info });
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

    if (error instanceof MoonrakerError) {
      return errorResponse(
        errorStatus(error.code),
        error.code,
        error.message,
        error.retryable,
        error.details,
      );
    }

    return errorResponse(
      400,
      "PRINTER_CONNECTION_TEST_FAILED",
      error instanceof Error
        ? error.message
        : "Unable to test printer connection.",
      true,
    );
  }
}
