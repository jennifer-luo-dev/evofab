import { NextResponse } from "next/server";
import { SlicerClient } from "@/app/lib/slicer-client";
import { SlicerError } from "@/app/lib/slicer-errors";

function slicerErrorResponse(error: SlicerError) {
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const gcode = await new SlicerClient().fetchGcode(id);
    return new NextResponse(gcode, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.gcode"`,
      },
    });
  } catch (error) {
    if (error instanceof SlicerError) return slicerErrorResponse(error);
    return NextResponse.json(
      { error: { message: "Unable to fetch slicer G-code." } },
      { status: 502 },
    );
  }
}
