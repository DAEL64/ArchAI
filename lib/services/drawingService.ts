import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  BlueprintData,
  BlueprintOverlay,
} from "@/types/blueprint";
import type {
  Drawing,
  DrawingInput,
  DrawingPatch,
  DrawingSource,
  DrawingType,
  GenerationParams,
  PlanCutLine,
  PlanViewpoint,
  StructuredData,
} from "@/types/drawing";

/*
 * The ONLY module that reads/writes Drawing rows. Routes and other services go
 * through here, so swapping Prisma for a remote backend later means changing
 * just this file (and projectService) — never the UI.
 */

const LEGACY_PREFIX = "legacy:";

/** A legacy project's single blueprint is surfaced as a synthetic drawing with
 *  this id, so the UI can treat every project uniformly. Writes to it are
 *  routed back to the project's legacy fields (see projectService). */
export function legacyDrawingId(projectId: string): string {
  return `${LEGACY_PREFIX}${projectId}`;
}
export function isLegacyDrawingId(id: string): boolean {
  return id.startsWith(LEGACY_PREFIX);
}
export function projectIdFromLegacyDrawingId(id: string): string {
  return id.slice(LEGACY_PREFIX.length);
}

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function serialize(d: {
  id: string;
  projectId: string;
  type: string;
  source: string | null;
  name: string | null;
  imageUrl: string | null;
  structuredData: unknown;
  overlayData: unknown;
  generationParams: unknown;
  analysisData: unknown;
  cutLines: unknown;
  viewpoints: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Drawing {
  return {
    id: d.id,
    projectId: d.projectId,
    type: d.type as DrawingType,
    source: (d.source ?? "generated") as DrawingSource,
    name: d.name ?? null,
    imageUrl: d.imageUrl ?? null,
    structuredData: (d.structuredData ?? null) as StructuredData,
    overlayData: (d.overlayData ?? null) as BlueprintOverlay | null,
    generationParams: (d.generationParams ?? null) as GenerationParams | null,
    analysisData: (d.analysisData ?? null) as BlueprintData | null,
    cutLines: (d.cutLines ?? []) as PlanCutLine[],
    viewpoints: (d.viewpoints ?? []) as PlanViewpoint[],
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

/**
 * Present a legacy project's single blueprint as a floor_plan Drawing so old
 * and new projects look identical to the UI. Pure — read-only synthesis, never
 * persisted (the row is created for real only when the project is next saved
 * through the drawing path).
 */
export function synthesizeLegacyDrawing(project: {
  id: string;
  imageUrl?: string | null;
  data?: unknown;
  overlay?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): Drawing | null {
  const data = (project.data ?? null) as BlueprintData | null;
  const hasImage =
    typeof project.imageUrl === "string" && project.imageUrl.length > 0;

  if (!data && !hasImage) return null;

  return {
    id: legacyDrawingId(project.id),
    projectId: project.id,
    type: "floor_plan",
    source: hasImage ? "uploaded" : "generated",
    name: null,
    imageUrl: hasImage ? project.imageUrl ?? null : null,
    structuredData: data?.floorPlan ?? null,
    overlayData: (project.overlay ?? null) as BlueprintOverlay | null,
    generationParams: null,
    analysisData: data,
    cutLines: [],
    viewpoints: [],
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
  };
}

/**
 * All drawings for a project. Real Drawing rows if any exist; otherwise the
 * legacy blueprint synthesized as one floor_plan drawing. Pass the already-
 * loaded project as `legacyProject` to avoid a second query in the legacy path.
 */
export async function listForProject(
  projectId: string,
  legacyProject?: {
    id: string;
    imageUrl?: string | null;
    data?: unknown;
    overlay?: unknown;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  } | null,
): Promise<Drawing[]> {
  const rows = await prisma.drawing.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length > 0) return rows.map(serialize);

  const legacy =
    legacyProject ??
    (await prisma.project.findUnique({ where: { id: projectId } }));
  if (!legacy) return [];

  const synth = synthesizeLegacyDrawing(legacy);
  return synth ? [synth] : [];
}

export async function getDrawing(id: string): Promise<Drawing | null> {
  if (isLegacyDrawingId(id)) {
    const projectId = projectIdFromLegacyDrawingId(id);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    return project ? synthesizeLegacyDrawing(project) : null;
  }
  const row = await prisma.drawing.findUnique({ where: { id } });
  return row ? serialize(row) : null;
}

function writableFields(input: DrawingInput | DrawingPatch) {
  // Whitelist — never trust arbitrary keys into the DB document.
  const out: Record<string, unknown> = {};
  if (input.type !== undefined) out.type = input.type;
  if (input.source !== undefined) out.source = input.source;
  if (input.name !== undefined) out.name = input.name;
  if (input.imageUrl !== undefined) out.imageUrl = input.imageUrl;
  if (input.structuredData !== undefined) out.structuredData = input.structuredData;
  if (input.overlayData !== undefined) out.overlayData = input.overlayData;
  if (input.generationParams !== undefined) out.generationParams = input.generationParams;
  if (input.analysisData !== undefined) out.analysisData = input.analysisData;
  if (input.cutLines !== undefined) out.cutLines = input.cutLines;
  if (input.viewpoints !== undefined) out.viewpoints = input.viewpoints;
  return out;
}

export async function createDrawing(
  projectId: string,
  input: DrawingInput,
): Promise<Drawing> {
  const row = await prisma.drawing.create({
    // JSON fields carry app-domain shapes Prisma can't type; the writable-field
    // whitelist above keeps this safe despite the cast.
    data: {
      projectId,
      source: "generated", // default; overridden by writableFields if supplied
      ...writableFields(input),
      type: input.type, // required — guarantee it's present last
    } as unknown as Prisma.DrawingUncheckedCreateInput,
  });
  return serialize(row);
}

export async function updateDrawing(
  id: string,
  patch: DrawingPatch,
): Promise<Drawing> {
  const row = await prisma.drawing.update({
    where: { id },
    data: writableFields(patch) as unknown as Prisma.DrawingUncheckedUpdateInput,
  });
  return serialize(row);
}

export async function deleteDrawing(id: string): Promise<void> {
  await prisma.drawing.delete({ where: { id } });
}
