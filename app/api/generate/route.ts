import { NextResponse } from "next/server";
import {
  assertOllamaIsRunning,
  extractJsonObject,
  normalizeBlueprintData,
  ollamaGenerate,
} from "@/lib/blueprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BLUEPRINT_GENERATION_PROMPT = `
You are an architectural blueprint GENERATION engine inside ArchitectAI.

The user gives a natural-language request describing a building or floor plan they want.
Your job is to DESIGN a plausible, internally consistent floor plan and return it as ONE valid JSON object.

Rules:
- Return ONLY one valid JSON object. No markdown, no comments, no prose outside the JSON.
- Invent a sensible, realistic layout that satisfies the request (room count, building type, style, size).
- Give each room realistic widthFeet and depthFeet for its type, and set estimatedSqft = round(widthFeet * depthFeet).
- Put a human-readable size in dimensionText, e.g. "12' x 14'".
- Set dimensions.width, dimensions.depth, dimensions.floors and dimensions.totalSqft to reflect the overall building (totalSqft is roughly the sum of room areas plus circulation).
- Populate materials and structuralElements with realistic choices for this kind of building.
- Use architecturalInsights for 2-4 short design notes (flow, light, code-style suggestions). Do NOT claim official code/legal approval.
- buildingType must describe the building (e.g. "Single-family residential", "Small office", "Cafe / retail").
- Set confidence to "high" because this is a generated design.
- Do NOT leave rooms empty.

SCHEMA (return exactly this shape):
{
  "rooms": [
    { "name": "Living Room", "dimensionText": "16' x 14'", "widthFeet": 16, "depthFeet": 14, "estimatedSqft": 224, "floor": 1 }
  ],
  "dimensions": { "totalSqft": 1200, "width": 40, "depth": 30, "floors": 1 },
  "materials": ["Concrete slab", "Timber framing", "Drywall"],
  "structuralElements": ["Load-bearing exterior walls", "Central staircase"],
  "annotations": ["North-facing entry"],
  "buildingType": "Single-family residential",
  "mainPurpose": "A compact two-bedroom single-family home.",
  "architecturalInsights": ["Open-plan kitchen/living maximizes daylight."],
  "confidence": "high"
}
`;

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Missing prompt", details: "A text description is required." },
        { status: 400 },
      );
    }

    await assertOllamaIsRunning();

    const responseText = await ollamaGenerate({
      model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
      format: "json",
      system: BLUEPRINT_GENERATION_PROMPT,
      prompt: `Design request: ${prompt.trim()}\n\nReturn the JSON blueprint now.`,
      options: {
        num_ctx: 4096,
        temperature: 0.6,
      },
      keepAlive: "5m",
    });

    const jsonString = extractJsonObject(responseText);
    const parsed = JSON.parse(jsonString);

    // Empty rooms here is a real (if poor) generation result, not an OCR
    // failure, so we do not append the "vision model failed" insight.
    const normalized = normalizeBlueprintData(parsed, {
      warnOnEmptyRooms: false,
    });

    return NextResponse.json(normalized);
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
