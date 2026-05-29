import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { OBJECT_ID_RE } from "@/lib/services/projectService";
import {
  createDrawing,
  deleteDrawing,
  getDrawing,
  isLegacyDrawingId,
  listForProject,
  updateDrawing,
} from "@/lib/services/drawingService";

export const dynamic = "force-dynamic";

/*
 * HTTP adapter for drawings — the multi-drawing model (floor plans, facades,
 * sections, sketches, interior/landscape studies). Legacy single-blueprint
 * projects surface their one drawing here too (synthesized, read-only); writes
 * to a synthesized "legacy:" drawing are rejected — those still flow through
 * the projects route's legacy fields until a project is migrated.
 */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const projectId = searchParams.get("projectId");

    if (id) {
      const drawing = await getDrawing(id);
      if (!drawing) {
        return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
      }
      return NextResponse.json(drawing);
    }

    if (projectId) {
      if (!OBJECT_ID_RE.test(projectId)) {
        return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
      }
      return NextResponse.json(await listForProject(projectId));
    }

    return NextResponse.json(
      { error: "projectId or id required" },
      { status: 400 },
    );
  } catch (error) {
    console.error("GET DRAWINGS ERROR:", error);
    return NextResponse.json({ error: "Failed to load drawings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { projectId, ...input } = await req.json();

    if (!projectId || !OBJECT_ID_RE.test(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }
    if (!input.type) {
      return NextResponse.json({ error: "Drawing type required" }, { status: 400 });
    }

    const drawing = await createDrawing(projectId, input);
    return NextResponse.json(drawing);
  } catch (error) {
    console.error("CREATE DRAWING ERROR:", error);
    return NextResponse.json({ error: "Failed to create drawing" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { id, ...patch } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Missing drawing id" }, { status: 400 });
    }
    if (isLegacyDrawingId(id)) {
      return NextResponse.json(
        { error: "Legacy drawings are edited via the project's blueprint fields" },
        { status: 400 },
      );
    }
    if (!OBJECT_ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid drawing id" }, { status: 400 });
    }

    const updated = await updateDrawing(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }
    console.error("UPDATE DRAWING ERROR:", error);
    return NextResponse.json({ error: "Failed to update drawing" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Id required" }, { status: 400 });
    }
    if (isLegacyDrawingId(id)) {
      return NextResponse.json(
        { error: "Legacy drawings cannot be deleted directly" },
        { status: 400 },
      );
    }
    if (!OBJECT_ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid drawing id" }, { status: 400 });
    }

    await deleteDrawing(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }
    console.error("DELETE DRAWING ERROR:", error);
    return NextResponse.json({ error: "Failed to delete drawing" }, { status: 500 });
  }
}
