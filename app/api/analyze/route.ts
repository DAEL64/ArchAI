import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  assertOllamaIsRunning,
  extractJsonObject,
  normalizeBlueprintData,
  ollamaGenerate,
} from "@/lib/blueprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function enhancePanel(buffer: Buffer, width: number): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width,
      // Don't upscale small images: enlarging adds no detail but inflates the
      // vision-token count, which would crowd out the model's JSON output and
      // truncate it. Downscaling large blueprints to `width` still applies.
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({
      quality: 78,
      mozjpeg: true,
    })
    .toBuffer();
}

function labelSvg(label: string, width: number, height = 44): Buffer {
  const safeLabel = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="18" y="29" font-family="Arial, sans-serif" font-size="20" fill="#ffffff" font-weight="700">
        ${safeLabel}
      </text>
    </svg>
  `);
}

/**
 * Ollama in your setup accepts only ONE image.
 * This creates one lighter contact sheet:
 * - full enhanced blueprint
 * - one zoom crop
 *
 * This is intentionally lighter than the older full + 3 crop version,
 * because qwen2.5vl was running on CPU and the bigger image caused fetch failures.
 */
async function createSingleAnalysisImage(imageBase64: string): Promise<string> {
  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const originalBuffer = Buffer.from(cleanBase64, "base64");

  const metadata = await sharp(originalBuffer).rotate().metadata();

  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error("Invalid image metadata. Could not read uploaded image.");
  }

  const targetWidth = 800;
  const cropCount = 1;

  const fullPanel = await enhancePanel(originalBuffer, targetWidth);

  const cropPanels: Buffer[] = [];

  for (let i = 0; i < cropCount; i++) {
    const cropTop = Math.floor(height * 0.15);
    const cropHeight = Math.floor(height * 0.7);

    const cropRaw = await sharp(originalBuffer)
      .rotate()
      .extract({
        left: 0,
        top: Math.max(0, cropTop),
        width,
        height: Math.min(cropHeight, height - cropTop),
      })
      .toBuffer();

    const cropPanel = await enhancePanel(cropRaw, targetWidth);
    cropPanels.push(cropPanel);
  }

  const labeledPanels: Buffer[] = [];

  labeledPanels.push(labelSvg("FULL BLUEPRINT", targetWidth));
  labeledPanels.push(fullPanel);

  cropPanels.forEach((panel, index) => {
    labeledPanels.push(labelSvg(`ZOOM CROP ${index + 1}`, targetWidth));
    labeledPanels.push(panel);
  });

  const panelMetas = await Promise.all(
    labeledPanels.map((panel) => sharp(panel).metadata()),
  );

  const totalHeight = panelMetas.reduce(
    (sum, meta) => sum + (meta.height || 0),
    0,
  );

  const composite: sharp.OverlayOptions[] = [];
  let currentTop = 0;

  for (let i = 0; i < labeledPanels.length; i++) {
    composite.push({
      input: labeledPanels[i],
      left: 0,
      top: currentTop,
    });

    currentTop += panelMetas[i].height || 0;
  }

  const contactSheet = await sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composite)
    .jpeg({
      quality: 72,
      mozjpeg: true,
    })
    .toBuffer();

  return contactSheet.toString("base64");
}

const BLUEPRINT_ANALYSIS_PROMPT = `
You are an architectural blueprint OCR and analysis engine.

You are receiving ONE image. This single image is a contact sheet made from the same blueprint:
- A full enhanced blueprint view.
- One zoomed crop view of the same blueprint.
- Each section may have labels like FULL BLUEPRINT or ZOOM CROP.

Your first task is OCR:
Read visible room labels, dimensions, and annotations from the full view and zoom crop before analyzing.

Do not say text is unreadable if it is visible in the image.
Do not say dimensions are missing if written dimensions are visible.
Do not invent hidden values, but do extract visible values.
Do not create duplicate rooms. If the same room name appears more than once, merge it into one record. Return only one object per unique labeled room.

Return ONLY one valid JSON object.
No markdown.
No comments.
No explanations outside JSON.

Look carefully for:
- ROOM labels
- TOILET labels
- PANTRY labels
- LIFT
- STAIRCASE
- PASSAGE width
- outer dimensions
- dimensions like 9'6"x13', 9'6"x13'8", 7'x4'6", 5'6"x5', 4' WIDE

DIMENSION CONVERSION:
- 9'6" = 9.5
- 13'8" = 13.67
- 15'6" = 15.5
- 4'6" = 4.5
- estimatedSqft = widthFeet * depthFeet
- Round estimatedSqft to nearest whole number.
- Preserve the original dimension text in dimensionText.

DEDUPLICATION RULES:
- Return only one object per unique room label.
- Do not treat the same room from FULL BLUEPRINT and ZOOM CROP as separate rooms.
- If the same room appears more than once, merge it into one room.
- If the same room has conflicting dimensions, choose the dimension closest to the visible room label.
- The final rooms array must not contain duplicate room names.

CONFIDENCE:
- Use "high" only if multiple visible room labels and dimensions are extracted correctly.
- Use "medium" if only some labels/dimensions are extracted.
- Use "low" if the blueprint text is mostly unreadable.

SCHEMA:
{
  "rooms": [
    {
      "name": "Room 1",
      "dimensionText": "9'6\\" x 13'",
      "widthFeet": 9.5,
      "depthFeet": 13,
      "estimatedSqft": 124,
      "floor": 1
    }
  ],
  "dimensions": {
    "totalSqft": null,
    "width": null,
    "depth": null,
    "floors": 1
  },
  "materials": [],
  "structuralElements": [],
  "annotations": [],
  "buildingType": "Residential / lodging floor plan",
  "mainPurpose": "A multi-room residential or lodging floor layout with rooms, toilets, pantry areas, lift, staircase, and central passage.",
  "architecturalInsights": [],
  "confidence": "medium"
}

Include every visible room.
Include toilets, pantry, lift, staircase, passage, and visible outer dimensions inside annotations or structuralElements.
Do not leave buildingType as Unknown if rooms/toilets/pantry/lift/passage are visible.
`;

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing imageBase64" },
        { status: 400 },
      );
    }

    await assertOllamaIsRunning();

    const analysisImage = await createSingleAnalysisImage(imageBase64);

    // Streamed so slow CPU vision inference can't trip undici's fetch timeout.
    const responseText = await ollamaGenerate({
      model: process.env.OLLAMA_VISION_MODEL || "qwen2.5vl:7b",
      format: "json",
      prompt: BLUEPRINT_ANALYSIS_PROMPT,
      images: [analysisImage],
      options: {
        // Large enough to hold the image + prompt AND leave room for the full
        // JSON answer. At 2048 the answer was truncated into invalid JSON.
        num_ctx: 4096,
        temperature: 0,
      },
      keepAlive: "0",
    });

    const jsonString = extractJsonObject(responseText);
    const parsed = JSON.parse(jsonString);
    const normalized = normalizeBlueprintData(parsed);

    return NextResponse.json(normalized);
  } catch (err) {
    console.error("ANALYZE ERROR:", err);

    const message =
      err instanceof Error ? err.message : "Unknown analysis error";

    // Return a clean error envelope only — never a success-shaped
    // BlueprintData body with a 500, which a careless client could mistake
    // for real data. The client reads `details`/`error` from this shape.
    return NextResponse.json(
      { error: "analysis_failed", details: message },
      { status: 500 },
    );
  }
}
