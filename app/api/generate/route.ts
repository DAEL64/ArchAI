import { NextResponse } from "next/server";
import {
  assertOllamaIsRunning,
  extractJsonObject,
  normalizeBlueprintData,
  ollamaGenerate,
} from "@/lib/blueprint";
import {
  buildFloorPlanModel,
  deriveProgram,
  roomsFromModel,
} from "@/lib/floorplan";
import type { BlueprintData } from "@/types/blueprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The model only has to produce the SEMANTIC program — a believable room list
 * with rough sizes and a building footprint. It does NOT place rooms on a grid;
 * a deterministic layout engine (lib/floorplan.ts) does the spatial work
 * (zoning, adjacency, circulation, doors, windows). That division is what makes
 * the output reliable from a small local model.
 */
const BLUEPRINT_GENERATION_PROMPT = `
You are the design brief stage of ArchitectAI. The user describes a building; you
output the ROOM PROGRAM for a single, coherent design as ONE valid JSON object.

A separate engine turns your program into the actual drawing, so you do NOT need
to give coordinates — focus on listing the right rooms at realistic sizes.

Rules:
- Return ONLY one valid JSON object. No markdown, no comments, no prose.
- List EVERY room the building needs, including circulation-supporting spaces:
  entry/foyer, bedrooms, bathrooms, kitchen, living, dining, closets, utility,
  storage, garage, stairs — whatever fits the request. Do not omit bathrooms or
  a kitchen for a home.
- Honour explicit constraints exactly: if the user asks for 3 bedrooms and 2
  bathrooms, output 3 bedrooms and 2 bathrooms. If they give a floor count, set
  dimensions.floors and assign each room a "floor".
- If the request is vague (e.g. "a 3-bedroom house"), fill in sensible defaults:
  entry, living, kitchen/dining, the bedrooms, 1-2 bathrooms, plus storage/utility.
- Give each room realistic widthFeet and depthFeet for its TYPE and set
  estimatedSqft = round(widthFeet * depthFeet). Put a label in dimensionText
  like "12' x 14'".
- Add a "type" to each room from: living, dining, kitchen, entry, family,
  bedroom, master, bathroom, closet, office, stair, lift, garage, utility,
  laundry, storage, balcony.
- dimensions.width / dimensions.depth describe the overall building footprint in
  feet; dimensions.totalSqft is roughly the sum of room areas plus circulation.
- Populate materials and structuralElements realistically.
- architecturalInsights: 2-4 short design notes (flow, daylight, zoning). Do NOT
  claim official code/legal approval.
- buildingType describes the building (e.g. "Single-family residential").
- Set confidence to "high". Never return an empty rooms array.

SCHEMA (return exactly this shape):
{
  "rooms": [
    { "name": "Living Room", "type": "living", "dimensionText": "16' x 14'", "widthFeet": 16, "depthFeet": 14, "estimatedSqft": 224, "floor": 1 }
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

    const cleanPrompt = prompt.trim();

    await assertOllamaIsRunning();

    const responseText = await ollamaGenerate({
      model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
      format: "json",
      system: BLUEPRINT_GENERATION_PROMPT,
      prompt: `Design request: ${cleanPrompt}\n\nReturn the JSON room program now.`,
      options: {
        num_ctx: 4096,
        temperature: 0.6,
      },
      keepAlive: "5m",
    });

    const jsonString = extractJsonObject(responseText);
    const parsed = JSON.parse(jsonString);

    // Empty rooms here is a real (if poor) generation result, not an OCR
    // failure, so we do not append the "vision model failed" insight. The
    // layout engine will backfill any essentials the small model dropped.
    const normalized = normalizeBlueprintData(parsed, {
      warnOnEmptyRooms: false,
    });

    // --- deterministic spatial layout ------------------------------------
    // Turn the (possibly incomplete) program into a complete, count-correct
    // building program, then place it spatially with proper zoning and
    // circulation. The drawing, room list and dimensions are all derived from
    // this single model so they always agree.
    const program = deriveProgram(
      cleanPrompt,
      normalized.rooms,
      normalized.buildingType,
    );

    const floorPlan = buildFloorPlanModel(program, {
      footprintWidth: normalized.dimensions.width,
      footprintHeight: normalized.dimensions.depth,
      floors: normalized.dimensions.floors,
    });

    const planRooms = roomsFromModel(floorPlan);
    const totalSqft = planRooms.reduce(
      (sum, r) => sum + (r.estimatedSqft ?? 0),
      0,
    );

    const insights = [...normalized.architecturalInsights];
    const zoningNote =
      "Layout separates public, private and service zones with a central circulation path so every room has its own access.";
    if (!insights.some((i) => /zone|circulation/i.test(i))) {
      insights.unshift(zoningNote);
    }

    const result: BlueprintData = {
      ...normalized,
      rooms: planRooms,
      dimensions: {
        totalSqft: totalSqft || normalized.dimensions.totalSqft,
        width: floorPlan.buildingFootprint.width,
        depth: floorPlan.buildingFootprint.height,
        floors: floorPlan.floors.length,
      },
      architecturalInsights: insights,
      floorPlan,
    };

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
