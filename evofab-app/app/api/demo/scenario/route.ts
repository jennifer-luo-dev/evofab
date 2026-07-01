import { NextRequest, NextResponse } from "next/server";
import { getMoonrakerMode } from "@/app/lib/moonraker";

const ALLOWED = new Set(["ready", "printing", "paused", "offline", "shutdown"]);

export async function POST(request: NextRequest) {
  if (getMoonrakerMode() !== "mock") {
    return NextResponse.json(
      { error: "Demo scenarios are available only in mock mode." },
      { status: 403 },
    );
  }
  const { scenario } = await request.json();
  if (!ALLOWED.has(scenario)) {
    return NextResponse.json(
      { error: "Unknown demo scenario." },
      { status: 400 },
    );
  }
  const base = process.env.MOCK_MOONRAKER_URL ?? "http://127.0.0.1:7125";
  const response = await fetch(`${base}/__mock/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
