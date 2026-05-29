import type {
  BlueprintData,
  BlueprintOverlay,
  ChatMessage,
  FloorPlanModel,
} from "./blueprint";

/* ------------------------------------------------------------------ */
/* Drawing model                                                       */
/*                                                                     */
/* A project holds many drawings — a floor plan, its elevations,       */
/* sections, sketches, interior/landscape studies. Each is a structured*/
/* record (geometry as JSON + at most ONE original raster), so the     */
/* whole workspace is portable and survives a future move off Prisma   */
/* to a standalone backend without changing these shapes.              */
/* ------------------------------------------------------------------ */

export const DRAWING_TYPES = [
  "floor_plan",
  "facade",
  "section",
  "sketch",
  "interior",
  "landscape",
] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];

export type DrawingSource = "uploaded" | "generated" | "edited";

/** Human labels for each mode (UI). */
export const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
  floor_plan: "Floor Plan",
  facade: "Facade / Elevation",
  section: "Section / Cut",
  sketch: "Sketch",
  interior: "Interior Design",
  landscape: "Landscape Design",
};

/**
 * Structured constraints captured from the per-mode input fields, plus the
 * freeform creative prompt. Stored on the drawing so a generation is
 * reproducible and a future backend can re-run it. Everything is optional —
 * minimal forced guidance is the product default; the user may give only a
 * prompt, only fields, or both.
 */
export interface GenerationParams {
  /** freeform creative instruction — always available alongside the fields */
  prompt?: string;
  projectType?: string;
  floors?: number | null;
  totalArea?: number | null;
  buildingWidth?: number | null;
  buildingDepth?: number | null;
  roomCount?: number | null;
  requiredRooms?: string[];
  roomDimensions?: string;
  wallWidth?: number | null;
  floorThickness?: number | null;
  ceilingHeight?: number | null;
  humidity?: number | null;
  climate?: string;
  location?: string;
  style?: string;
  materials?: string[];
  structuralSystem?: string;
  landscapeRequirements?: string;
  interiorPreferences?: string;
  accessibility?: string;
  notes?: string;
  /** forward-compatible: modes may add their own fields */
  [key: string]: unknown;
}

/**
 * A section cut marked on a floor plan. Coordinates are in the plan's FEET
 * space (same as FloorPlanModel) so the marker re-aligns at any zoom and a
 * section can be derived from it later.
 */
export interface PlanCutLine {
  id: string;
  label: string; // e.g. "A-A"
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** side the section looks toward, relative to the cut line */
  direction: "left" | "right" | "up" | "down";
  floorLevel: number;
}

/** A perspective viewpoint marked on a floor plan. */
export interface PlanViewpoint {
  id: string;
  label: string;
  /** camera position, in plan feet */
  x: number;
  y: number;
  /** look direction in degrees (0 = +x / east, 90 = +y) */
  angleDeg: number;
  /** horizontal field of view */
  fovDeg?: number;
  kind: "interior" | "exterior";
  sketchType?: string;
  floorLevel: number;
}

/**
 * Type-specific geometry. `floor_plan` uses `FloorPlanModel`; the other modes'
 * models are added as their slices land. The parent `Drawing.type` is the
 * discriminator the renderer switches on.
 */
export type StructuredData = FloorPlanModel | Record<string, unknown> | null;

export interface Drawing {
  id: string;
  projectId: string;
  type: DrawingType;
  source: DrawingSource;
  name?: string | null;
  /** single original raster for uploaded studies; null for generated vectors */
  imageUrl?: string | null;
  structuredData?: StructuredData;
  /** user edits — vector JSON only, never a re-flattened image */
  overlayData?: BlueprintOverlay | null;
  generationParams?: GenerationParams | null;
  analysisData?: BlueprintData | null;
  cutLines?: PlanCutLine[];
  viewpoints?: PlanViewpoint[];
  createdAt: string;
  updatedAt: string;
}

/** What a client sends to create a drawing (server assigns id/timestamps). */
export type DrawingInput = Partial<Omit<Drawing, "id" | "projectId" | "createdAt" | "updatedAt">> & {
  type: DrawingType;
};

/** What a client sends to patch a drawing. */
export type DrawingPatch = Partial<Omit<Drawing, "id" | "projectId" | "createdAt" | "updatedAt">>;

/* ------------------------------------------------------------------ */
/* Interior design suggestions (textual — possible with the local LLM) */
/* ------------------------------------------------------------------ */

export interface InteriorRequest {
  buildingType?: string;
  room?: string;
  style?: string;
  notes?: string;
}

export interface InteriorSuggestions {
  summary: string;
  furniture: string[];
  lighting: string[];
  materials: string[];
  storage: string[];
  circulation: string[];
}

export interface LandscapeRequest {
  context?: string;
  notes?: string;
}

export interface LandscapeSuggestions {
  summary: string;
  zones: string[];
  planting: string[];
  pathways: string[];
  water: string[];
}

/** Project metadata, separate from its drawings and chat. */
export interface ProjectRecord {
  id: string;
  clientSessionId?: string | null;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Full project as returned by the API: metadata + drawings + messages. The
 * legacy single-blueprint fields (`imageUrl`/`data`/`overlay`) are still
 * mirrored here so the current analyze UI keeps working unchanged while the
 * mode system migrates onto `drawings`.
 */
export interface ProjectWithDrawings extends ProjectRecord {
  drawings: Drawing[];
  messages: ChatMessage[];
  imageUrl: string | null;
  data: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
}
