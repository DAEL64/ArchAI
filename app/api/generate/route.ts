import { NextResponse } from "next/server";
import { generateFloorPlan } from "@/lib/services/generationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { prompt, params } = await req.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Missing prompt", details: "A text description is required." },
        { status: 400 },
      );
    }

    // `params` (optional structured fields) is forward-compatible with the
    // per-mode input fields; prompt-only requests still work unchanged.
    const result = await generateFloorPlan(prompt, params);
    return NextResponse.json(result);
  } catch (err) {
    console.error("GENERATE ERROR:", err);

    const message =
      err instanceof Error ? err.message : "Unknown generation error";

    return NextResponse.json(
      { error: "generation failed", details: message },
      { status: 500 },
    );
  }
}
