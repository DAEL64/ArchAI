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
import type { GenerationParams } from "@/types/drawing";

/*
 * AI generation orchestration. The model produces only the SEMANTIC program
 * (room list + rough sizes); the deterministic layout engine (lib/floorplan.ts)
 * does the spatial work. Kept behind this service so the route is a thin
 * adapter and the pipeline can later move to a remote model backend.
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

/** Fold the structured fields into an explicit constraint block appended to the
 *  user's freeform prompt, so the model honours them without us forcing a rigid
 *  template (the freeform prompt still leads). */
function paramsToConstraintLines(params?: GenerationParams): string {
  if (!params) return "";
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`- ${label}: ${value.join(", ")}`);
    } else {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add("Project type", params.projectType);
  add("Floors", params.floors);
  add("Total area (sqft)", params.totalArea);
  add("Building width (ft)", params.buildingWidth);
  add("Building depth (ft)", params.buildingDepth);
  add("Room count", params.roomCount);
  add("Required rooms", params.requiredRooms);
  add("Specific room dimensions", params.roomDimensions);
  add("Style", params.style);
  add("Materials", params.materials);
  add("Structural system", params.structuralSystem);
  add("Location / context", params.location);
  add("Climate", params.climate);
  add("Accessibility", params.accessibility);
  add("Notes", params.notes);
  if (lines.length === 0) return "";
  return `\n\nHard constraints (honour exactly where given):\n${lines.join("\n")}`;
}

export async function generateFloorPlan(
  prompt: string,
  params?: GenerationParams,
): Promise<BlueprintData> {
  const cleanPrompt = prompt.trim();

  await assertOllamaIsRunning();

  const responseText = await ollamaGenerate({
    model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
    format: "json",
    system: BLUEPRINT_GENERATION_PROMPT,
    prompt: `Design request: ${cleanPrompt}${paramsToConstraintLines(
      params,
    )}\n\nReturn the JSON room program now.`,
    options: {
      num_ctx: 4096,
      temperature: 0.6,
    },
    keepAlive: "5m",
  });

  const jsonString = extractJsonObject(responseText);
  const parsed = JSON.parse(jsonString);

  // Empty rooms here is a real (if poor) generation result, not an OCR failure,
  // so we don't append the "vision model failed" insight. The layout engine
  // backfills any essentials the small model dropped.
  const normalized = normalizeBlueprintData(parsed, { warnOnEmptyRooms: false });

  // --- deterministic spatial layout --------------------------------------
  // Turn the (possibly incomplete) program into a complete, count-correct
  // building program, then place it spatially with zoning and circulation.
  // Structured field values, when given, override the model's footprint/floors.
  const program = deriveProgram(
    `${cleanPrompt} ${params?.projectType ?? ""}`,
    normalized.rooms,
    normalized.buildingType,
  );

  const floorPlan = buildFloorPlanModel(program, {
    footprintWidth: params?.buildingWidth ?? normalized.dimensions.width,
    footprintHeight: params?.buildingDepth ?? normalized.dimensions.depth,
    floors: params?.floors ?? normalized.dimensions.floors,
  });

  const planRooms = roomsFromModel(floorPlan);
  const totalSqft = planRooms.reduce((sum, r) => sum + (r.estimatedSqft ?? 0), 0);

  const insights = [...normalized.architecturalInsights];
  const zoningNote =
    "Layout separates public, private and service zones with a central circulation path so every room has its own access.";
  if (!insights.some((i) => /zone|circulation/i.test(i))) {
    insights.unshift(zoningNote);
  }

  return {
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
}
