import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  OBJECT_ID_RE,
  createProject,
  deleteProject,
  findProjectBySession,
  getProject,
  listProjects,
  updateProject,
} from "@/lib/services/projectService";

export const dynamic = "force-dynamic";

/*
 * HTTP adapter for project data. All persistence lives in projectService /
 * drawingService; this file only translates between HTTP and those calls, so
 * the contract can move to a standalone backend without touching the UI.
 */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      if (!OBJECT_ID_RE.test(id)) {
        return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
      }
      const project = await getProject(id);
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json(project);
    }

    return NextResponse.json(await listProjects());
  } catch (error) {
    console.error("GET PROJECTS ERROR:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { clientSessionId?: string } = {};

  try {
    body = await req.json();
    const project = await createProject(body);
    return NextResponse.json(project);
  } catch (error) {
    console.error("CREATE PROJECT ERROR:", error);

    // If a concurrent request already created this session's project, return it
    // instead of a 500.
    const clientSessionId = body?.clientSessionId;
    if (typeof clientSessionId === "string" && clientSessionId.length > 0) {
      try {
        const existing = await findProjectBySession(clientSessionId);
        if (existing) return NextResponse.json(existing);
      } catch {
        // fall through to the error response
      }
    }

    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { projectId, ...patch } = await req.json();

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "Missing project ID" }, { status: 400 });
    }
    if (!OBJECT_ID_RE.test(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const updated = await updateProject(projectId, patch);
    return NextResponse.json(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    console.error("UPDATE PROJECT ERROR:", error);
    return NextResponse.json(
      { error: "Failed to sync project updates" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Id required" }, { status: 400 });
    }
    if (!OBJECT_ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    await deleteProject(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    console.error("DELETE PROJECT ERROR:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
