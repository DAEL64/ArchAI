import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BlueprintData, BlueprintOverlay, ChatMessage } from "@/types/blueprint";
import type { ProjectWithDrawings } from "@/types/drawing";
import { listForProject, synthesizeLegacyDrawing } from "./drawingService";

/*
 * Data-access layer for projects (metadata + chat + the legacy single-blueprint
 * fields). The ONLY place — together with drawingService — that touches Prisma
 * for project data. API routes are thin adapters over these functions, so a
 * future move to a standalone backend is a change here, not in the UI.
 */

// MongoDB ObjectIds are 24 hex chars. Validating up front turns a thrown
// Prisma P2023 ("malformed ObjectID") into a clean 400.
export const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export interface ProjectInput {
  clientSessionId?: string | null;
  name?: string;
  imageUrl?: string | null;
  data?: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages?: ChatMessage[];
}

export interface ProjectPatch {
  name?: string;
  imageUrl?: string | null;
  data?: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages?: ChatMessage[];
  newMessage?: ChatMessage;
}

function normalizeMessages(messages: unknown): { role: string; content: string }[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string",
    )
    .map((msg) => ({ role: msg.role, content: msg.content }));
}

const PROJECT_INCLUDE = {
  messages: { orderBy: { createdAt: "asc" as const } },
};

type ProjectRow = {
  id: string;
  clientSessionId: string | null;
  name: string;
  imageUrl: string | null;
  data: unknown;
  overlay: unknown;
  createdAt: Date;
  updatedAt: Date;
  messages?: { role: string; content: string }[];
};

/** Combine a project row with its drawings into the API shape. */
function serialize(
  project: ProjectRow,
  drawings: ProjectWithDrawings["drawings"],
): ProjectWithDrawings {
  return {
    id: project.id,
    clientSessionId: project.clientSessionId ?? null,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    // legacy mirror — current analyze UI still reads these directly
    imageUrl: project.imageUrl ?? null,
    data: (project.data ?? null) as BlueprintData | null,
    overlay: (project.overlay ?? null) as BlueprintOverlay | null,
    drawings,
    messages: ((project.messages ?? []) as { role: string; content: string }[]).map(
      (m) => ({ role: m.role as ChatMessage["role"], content: m.content }),
    ),
  };
}

export async function listProjects(): Promise<ProjectWithDrawings[]> {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: PROJECT_INCLUDE,
  });
  // List stays lean: we don't ship every project's full drawings (they can
  // carry base64 images). The legacy mirror is enough for cards/sidebar;
  // getProject() returns the full drawings for the opened project.
  return projects.map((p) => serialize(p as ProjectRow, []));
}

/** Last-ditch lookup used by the create route's error path: if a create throws
 *  after a concurrent request already made the session's project, return it. */
export async function findProjectBySession(
  clientSessionId: string,
): Promise<ProjectWithDrawings | null> {
  const existing = await prisma.project.findFirst({
    where: { clientSessionId },
    include: PROJECT_INCLUDE,
  });
  if (!existing) return null;
  const drawings = await listForProject(existing.id, existing);
  return serialize(existing as ProjectRow, drawings);
}

export async function getProject(id: string): Promise<ProjectWithDrawings | null> {
  const project = await prisma.project.findUnique({
    where: { id },
    include: PROJECT_INCLUDE,
  });
  if (!project) return null;
  const drawings = await listForProject(project.id, project);
  return serialize(project as ProjectRow, drawings);
}

export async function createProject(input: ProjectInput): Promise<ProjectWithDrawings> {
  const { clientSessionId, name, data, imageUrl, overlay, messages } = input;
  const hasSession =
    typeof clientSessionId === "string" && clientSessionId.length > 0;

  // Idempotency: one project per client session. The client single-flights
  // creation (analysis-session-provider.tsx); this is the fast path for retries.
  if (hasSession) {
    const existing = await prisma.project.findFirst({
      where: { clientSessionId },
      include: PROJECT_INCLUDE,
    });
    if (existing) {
      const drawings = await listForProject(existing.id, existing);
      return serialize(existing as ProjectRow, drawings);
    }
  }

  const created = await prisma.project.create({
    // JSON columns (data/overlay) hold app-domain shapes Prisma can't type, and
    // messages is a nested relation write — cast past both.
    data: {
      clientSessionId: hasSession ? clientSessionId : null,
      name: name || "Untitled Blueprint Analysis",
      imageUrl: imageUrl || null,
      data: data ?? null,
      overlay: overlay ?? null,
      messages: { create: normalizeMessages(messages) },
    } as unknown as Prisma.ProjectCreateInput,
    include: PROJECT_INCLUDE,
  });

  // Self-heal the findFirst-then-create race (no unique index needed): keep the
  // canonical row (smallest ObjectId = oldest) and delete the rest. Every
  // concurrent caller computes the same survivor, so the returned id exists.
  if (hasSession) {
    const dupes = await prisma.project.findMany({
      where: { clientSessionId },
      orderBy: { id: "asc" },
      include: PROJECT_INCLUDE,
    });
    if (dupes.length > 1) {
      const [canonical, ...extras] = dupes;
      await prisma.project.deleteMany({
        where: { id: { in: extras.map((p) => p.id) } },
      });
      const drawings = await listForProject(canonical.id, canonical);
      return serialize(canonical as ProjectRow, drawings);
    }
  }

  const drawings = await listForProject(created.id, created);
  return serialize(created as ProjectRow, drawings);
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<ProjectWithDrawings> {
  const { name, data, imageUrl, overlay, messages, newMessage } = patch;
  // Mixed scalar + JSON + nested-relation writes; typed loosely like the
  // original route, then handed to Prisma.
  const updateData: Record<string, unknown> = {};

  if (typeof name === "string") updateData.name = name;
  if (typeof imageUrl === "string" || imageUrl === null) {
    updateData.imageUrl = imageUrl;
  }
  if (data !== undefined) updateData.data = data;
  if (overlay !== undefined) updateData.overlay = overlay;

  if (Array.isArray(messages)) {
    updateData.messages = {
      deleteMany: {},
      create: normalizeMessages(messages),
    };
  } else if (newMessage) {
    const normalized = normalizeMessages([newMessage]);
    if (normalized.length > 0) {
      updateData.messages = { create: normalized[0] };
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: updateData as unknown as Prisma.ProjectUpdateInput,
    include: PROJECT_INCLUDE,
  });
  const drawings = await listForProject(updated.id, updated);
  return serialize(updated as ProjectRow, drawings);
}

export async function deleteProject(id: string): Promise<void> {
  // Drawings cascade via the relation's onDelete: Cascade.
  await prisma.project.delete({ where: { id } });
}

export { synthesizeLegacyDrawing };
