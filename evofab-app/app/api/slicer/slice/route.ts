import { NextRequest, NextResponse } from "next/server";
import { SlicerClient } from "@/app/lib/slicer-client";
import { SlicerError } from "@/app/lib/slicer-errors";
import { resolveSlicerProfileId } from "@/app/lib/slicer-profile-aliases";

const MAX_STL_BYTES = 100 * 1024 * 1024;

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

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const model = form.get("model");
    const profileId = form.get("profile_id");
    const rotationValue = form.get("rotation");
    const supportsValue = form.get("supports");

    if (
      !(model instanceof File) ||
      typeof profileId !== "string" ||
      !profileId
    ) {
      return NextResponse.json(
        {
          error: {
            code: "SLICER_INVALID_INPUT",
            message: "A model STL and material profile are required.",
            retryable: false,
            details: {},
          },
        },
        { status: 400 },
      );
    }

    if (
      !model.name.toLowerCase().endsWith(".stl") ||
      model.size > MAX_STL_BYTES
    ) {
      return NextResponse.json(
        {
          error: {
            code: "SLICER_INVALID_INPUT",
            message: "Upload a .stl file no larger than 100 MB.",
            retryable: false,
            details: { max_upload_bytes: MAX_STL_BYTES },
          },
        },
        { status: 400 },
      );
    }

    const rotation =
      typeof rotationValue === "string" && rotationValue
        ? JSON.parse(rotationValue)
        : null;
    const supports =
      typeof supportsValue === "string" ? supportsValue === "true" : undefined;
    const job = await new SlicerClient().submitSlice({
      model,
      profileId: resolveSlicerProfileId(profileId),
      rotation,
      supports,
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof SlicerError) return slicerErrorResponse(error);
    return NextResponse.json(
      { error: { message: "Unable to submit slice job." } },
      { status: 502 },
    );
  }
}
