import {
  assertOllamaIsRunning,
  extractJsonObject,
  ollamaGenerate,
} from "@/lib/blueprint";
import type {
  InteriorRequest,
  InteriorSuggestions,
  LandscapeRequest,
  LandscapeSuggestions,
} from "@/types/drawing";

/*
 * Interior-design suggestions. This is a TEXTUAL capability — well within the
 * local chat model — so it's a real feature now (unlike photoreal interior
 * renders, which need an image backend). Behind a service like the other AI
 * orchestration so the route stays thin.
 */

const SYSTEM = `You are an interior design assistant inside ArchitectAI.
Given a room and an optional style, suggest practical, creative interior design ideas.

Return ONLY one valid JSON object with these keys:
- "summary": a one-sentence design direction (string)
- "furniture": string[]   (key pieces + rough placement)
- "lighting": string[]    (layers / fixtures)
- "materials": string[]   (palette / finishes)
- "storage": string[]     (storage solutions)
- "circulation": string[] (flow / layout improvements)

3-6 concise items per array. No markdown, no prose outside the JSON.
Respect the user's style; if none is given, be creative and state your chosen direction in the summary.
Do NOT claim official code/legal/building approval.`;

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function suggestInterior(
  req: InteriorRequest,
): Promise<InteriorSuggestions> {
  await assertOllamaIsRunning();

  const userMsg = `Building: ${req.buildingType || "residential"}
Room: ${req.room || "living room"}
Style: ${req.style || "(no preference — choose a fitting direction)"}
Notes: ${req.notes || "(none)"}

Return the JSON suggestions now.`;

  const text = await ollamaGenerate({
    model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
    format: "json",
    system: SYSTEM,
    prompt: userMsg,
    options: { num_ctx: 4096, temperature: 0.7 },
    keepAlive: "5m",
  });

  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    furniture: arr(parsed.furniture),
    lighting: arr(parsed.lighting),
    materials: arr(parsed.materials),
    storage: arr(parsed.storage),
    circulation: arr(parsed.circulation),
  };
}

const LANDSCAPE_SYSTEM = `You are a landscape design assistant inside ArchitectAI.
Given a site description / notes, suggest practical landscape design ideas.

Return ONLY one valid JSON object with these keys:
- "summary": a one-sentence site strategy (string)
- "zones": string[]    (how to use flat / sloped areas, outdoor rooms)
- "planting": string[] (trees, greenery, screening — climate-appropriate)
- "pathways": string[] (circulation, access, paving)
- "water": string[]    (drainage, runoff, water features)

3-6 concise items per array. No markdown, no prose outside the JSON.
Reason about slope, sun, access and drainage from the notes if given.
Do NOT claim official code/legal/survey approval.`;

export async function suggestLandscape(
  req: LandscapeRequest,
): Promise<LandscapeSuggestions> {
  await assertOllamaIsRunning();

  const userMsg = `Site notes: ${req.notes || "(none given — propose a sensible general scheme)"}
Context: ${req.context || "(none)"}

Return the JSON suggestions now.`;

  const text = await ollamaGenerate({
    model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
    format: "json",
    system: LANDSCAPE_SYSTEM,
    prompt: userMsg,
    options: { num_ctx: 4096, temperature: 0.7 },
    keepAlive: "5m",
  });

  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    zones: arr(parsed.zones),
    planting: arr(parsed.planting),
    pathways: arr(parsed.pathways),
    water: arr(parsed.water),
  };
}
