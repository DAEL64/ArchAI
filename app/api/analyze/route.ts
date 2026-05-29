import { NextResponse } from "next/server";
import { analyzeImage } from "@/lib/services/analysisService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }

    const normalized = await analyzeImage(imageBase64);
    return NextResponse.json(normalized);
  } catch (err) {
    console.error("ANALYZE ERROR:", err);

    const message =
      err instanceof Error ? err.message : "Unknown analysis error";

    // Clean error envelope only — never a success-shaped body with a 500.
    return NextResponse.json(
      { error: "analysis_failed", details: message },
      { status: 500 },
    );
  }
}
