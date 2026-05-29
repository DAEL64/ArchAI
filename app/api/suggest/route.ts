import { NextResponse } from "next/server";
import {
  suggestInterior,
  suggestLandscape,
} from "@/lib/services/suggestionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result =
      body?.kind === "landscape"
        ? await suggestLandscape(body ?? {})
        : await suggestInterior(body ?? {});
    return NextResponse.json(result);
  } catch (err) {
    console.error("SUGGEST ERROR:", err);
    const message =
      err instanceof Error ? err.message : "Unknown suggestion error";
    return NextResponse.json(
      { error: "suggestion_failed", details: message },
      { status: 500 },
    );
  }
}
