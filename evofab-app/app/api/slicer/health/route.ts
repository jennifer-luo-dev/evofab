import { NextResponse } from "next/server";
import { SlicerClient } from "@/app/lib/slicer-client";
import { SlicerError } from "@/app/lib/slicer-errors";

export async function GET() {
  try {
    const health = await new SlicerClient().health();
    return NextResponse.json({ health });
  } catch (error) {
    if (error instanceof SlicerError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
          },
        },
        { status: error.status ?? 502 },
      );
    }

    return NextResponse.json(
      { error: { message: "Unable to read slicer health." } },
      { status: 502 },
    );
  }
}
