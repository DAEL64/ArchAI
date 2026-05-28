import type {
  BlueprintData,
  BlueprintRoom,
  ConfidenceLevel,
} from "@/types/blueprint";

/**
 * Shared blueprint parsing/normalization helpers.
 *
 * Used by BOTH the vision analysis route (/api/analyze) and the
 * text-to-blueprint generation route (/api/generate) so the data shape,
 * dimension math, and de-duplication behave identically everywhere.
 */

export function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No valid JSON object found in model response");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item == null) return "";
      return String(item).trim();
    })
    .filter(Boolean);
}

export function normalizeConfidence(value: unknown): ConfidenceLevel {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "low";
}

export function calculateSqft(
  widthFeet: number | null,
  depthFeet: number | null,
) {
  if (widthFeet === null || depthFeet === null) return null;
  return Math.round(widthFeet * depthFeet);
}

interface NormalizeOptions {
  /**
   * When true (vision OCR), an explanatory insight is appended if no rooms
   * were extracted, because empty rooms usually means the model failed to
   * read the image. For text generation an empty result is a real answer,
   * not a failure, so callers pass false.
   */
  warnOnEmptyRooms?: boolean;
}

export function normalizeBlueprintData(
  input: any,
  options: NormalizeOptions = {},
): BlueprintData {
  const { warnOnEmptyRooms = true } = options;

  const rooms = Array.isArray(input?.rooms)
    ? input.rooms.map((room: any, index: number) => {
        const widthFeet = toNumberOrNull(room?.widthFeet);
        const depthFeet = toNumberOrNull(room?.depthFeet);

        const estimatedSqft =
          toNumberOrNull(room?.estimatedSqft) ??
          calculateSqft(widthFeet, depthFeet);

        return {
          name:
            typeof room?.name === "string" && room.name.trim()
              ? room.name.trim()
              : `Room ${index + 1}`,
          dimensionText:
            typeof room?.dimensionText === "string" && room.dimensionText.trim()
              ? room.dimensionText.trim()
              : null,
          widthFeet,
          depthFeet,
          estimatedSqft,
          floor: Math.max(1, Math.floor(toNumberOrNull(room?.floor) ?? 1)),
        };
      })
    : [];

  const dedupedRooms = Array.from(
    new Map(
      rooms.map((room: BlueprintRoom) => [
        room.name.toLowerCase().trim(),
        room,
      ]),
    ).values(),
  ) as BlueprintRoom[];

  const architecturalInsights = toStringArray(input?.architecturalInsights);

  if (dedupedRooms.length === 0 && warnOnEmptyRooms) {
    architecturalInsights.push(
      "No rooms were extracted. This usually means the vision model failed to read the blueprint text.",
    );
  }

  return {
    rooms: dedupedRooms,
    dimensions: {
      totalSqft: toNumberOrNull(input?.dimensions?.totalSqft),
      width: toNumberOrNull(input?.dimensions?.width),
      depth: toNumberOrNull(input?.dimensions?.depth),
      floors: Math.max(
        1,
        Math.floor(toNumberOrNull(input?.dimensions?.floors) ?? 1),
      ),
    },
    materials: toStringArray(input?.materials),
    structuralElements: toStringArray(input?.structuralElements),
    annotations: toStringArray(input?.annotations),
    buildingType:
      typeof input?.buildingType === "string" && input.buildingType.trim()
        ? input.buildingType.trim()
        : "Unknown",
    mainPurpose:
      typeof input?.mainPurpose === "string" && input.mainPurpose.trim()
        ? input.mainPurpose.trim()
        : "Blueprint purpose could not be determined with confidence.",
    architecturalInsights,
    confidence: normalizeConfidence(input?.confidence),
  };
}

export function getOllamaBaseUrl() {
  return process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
}

export async function assertOllamaIsRunning() {
  const ollamaBaseUrl = getOllamaBaseUrl();

  try {
    const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Ollama responded with status ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `Ollama is not reachable at ${ollamaBaseUrl}. Original error: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

interface OllamaGenerateParams {
  model: string;
  prompt: string;
  system?: string;
  images?: string[];
  format?: "json";
  options?: Record<string, unknown>;
  keepAlive?: string | number;
}

/**
 * Calls Ollama's /api/generate in STREAMING mode and accumulates the text.
 *
 * Why streaming: a CPU vision model (qwen2.5vl) can take several minutes to
 * answer. With `stream:false`, Node's fetch (undici) waits for the whole
 * response and trips its ~5-minute headersTimeout — surfacing as the opaque
 * "fetch failed" TypeError. Streaming sends bytes continuously, so neither the
 * header nor the body idle-timeout fires regardless of how long inference runs.
 */
export async function ollamaGenerate(
  params: OllamaGenerateParams,
): Promise<string> {
  const baseUrl = getOllamaBaseUrl();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        stream: true,
        ...(params.system ? { system: params.system } : {}),
        ...(params.images ? { images: params.images } : {}),
        ...(params.format ? { format: params.format } : {}),
        ...(params.options ? { options: params.options } : {}),
        keep_alive: params.keepAlive ?? "5m",
      }),
    });
  } catch (err) {
    // undici throws TypeError("fetch failed") on connection-level failures.
    throw new Error(
      `Could not reach Ollama at ${baseUrl} for model "${params.model}". ` +
        `It may have crashed, run out of memory, or dropped the connection ` +
        `(${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Ollama returned HTTP ${res.status}`);
  }

  if (!res.body) {
    throw new Error("Ollama returned no response stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let streamError: string | null = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed) as { response?: string; error?: string };
      if (typeof obj.response === "string") output += obj.response;
      if (obj.error) streamError = obj.error;
    } catch {
      // ignore non-JSON keep-alive lines
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
  } catch (err) {
    throw new Error(
      `Lost connection to Ollama mid-stream ` +
        `(${err instanceof Error ? err.message : "unknown"}). ` +
        `The model may have run out of memory.`,
    );
  }

  consumeLine(buffer);

  if (streamError && !output) throw new Error(streamError);
  if (!output) throw new Error("Ollama returned an empty response");

  return output;
}
