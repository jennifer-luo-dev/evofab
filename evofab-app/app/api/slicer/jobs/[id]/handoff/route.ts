import { NextRequest, NextResponse } from "next/server";
import { handoffSlicerJob } from "@/app/lib/slicer-handoff";
import { SlicerClient } from "@/app/lib/slicer-client";
import { createClient } from "@/app/lib/supabase-server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body?.printer_id !== "string" || !body.printer_id) {
    return NextResponse.json(
      {
        error: {
          code: "HANDOFF_INVALID_INPUT",
          message: "printer_id is required.",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  const result = await handoffSlicerJob(id, body.printer_id, {
    supabase: (await createClient()) as never,
    slicer: new SlicerClient(),
  });
  if (result.ok)
    return NextResponse.json(
      { job: result.job, uploaded_only: true },
      { status: 201 },
    );
  return NextResponse.json(
    {
      error: {
        code: result.code,
        message: result.message,
        retryable: result.status === 504,
      },
      job_id: result.jobId,
    },
    { status: result.status },
  );
}
