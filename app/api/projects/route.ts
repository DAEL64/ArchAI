import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// MongoDB ObjectIds are 24 hex chars. Validating up front turns a thrown
// Prisma P2023 ("malformed ObjectID") into a clean 400.
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function normalizeMessages(messages: any[]) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string",
    )
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
}

function serializeProject(project: any) {
  return {
    id: project.id,
    name: project.name,
    clientSessionId: project.clientSessionId ?? null,
    imageUrl: project.imageUrl ?? null,
    data: project.data ?? null,
    overlay: project.overlay ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    messages:
      project.messages?.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })) ?? [],
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      if (!OBJECT_ID_RE.test(id)) {
        return NextResponse.json(
          { error: "Invalid project id" },
          { status: 400 },
        );
      }

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!project) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 },
        );
      }

      return NextResponse.json(serializeProject(project));
    }

    const projects = await prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json(projects.map(serializeProject));
  } catch (error) {
    console.error("GET PROJECTS ERROR:", error);

    return NextResponse.json(
      { error: "Failed to load projects" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: any = {};

  try {
    body = await req.json();

    const { clientSessionId, name, data, imageUrl, overlay, messages } = body;

    const hasSession =
      typeof clientSessionId === "string" && clientSessionId.length > 0;

    // Idempotency: one project per client session. The client single-flights
    // creation (see analysis-session-provider.tsx) — this is the fast path for
    // ordinary retries.
    if (hasSession) {
      const existingProject = await prisma.project.findFirst({
        where: { clientSessionId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (existingProject) {
        return NextResponse.json(serializeProject(existingProject));
      }
    }

    const newProject = await prisma.project.create({
      data: {
        clientSessionId: hasSession ? clientSessionId : null,
        name: name || "Untitled Blueprint Analysis",
        imageUrl: imageUrl || null,
        data: data || null,
        overlay: overlay ?? null,
        messages: {
          create: normalizeMessages(messages),
        },
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // Self-heal the findFirst-then-create race (no unique index needed): if
    // concurrent requests slipped past the check above and created multiple
    // rows for one session, keep the canonical row (smallest ObjectId = oldest)
    // and delete the rest. Every concurrent caller computes the same survivor,
    // so the id we return always still exists.
    if (hasSession) {
      const dupes = await prisma.project.findMany({
        where: { clientSessionId },
        orderBy: { id: "asc" },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (dupes.length > 1) {
        const [canonical, ...extras] = dupes;

        await prisma.project.deleteMany({
          where: { id: { in: extras.map((p) => p.id) } },
        });

        return NextResponse.json(serializeProject(canonical));
      }
    }

    return NextResponse.json(serializeProject(newProject));
  } catch (error) {
    console.error("CREATE PROJECT ERROR:", error);

    const clientSessionId = body?.clientSessionId;

    if (clientSessionId) {
      const existingProject = await prisma.project.findFirst({
        where: { clientSessionId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (existingProject) {
        return NextResponse.json(serializeProject(existingProject));
      }
    }

    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const { projectId, name, data, imageUrl, overlay, messages, newMessage } =
      await req.json();

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { error: "Missing project ID" },
        { status: 400 },
      );
    }

    if (!OBJECT_ID_RE.test(projectId)) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 },
      );
    }

    const updateData: any = {};

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
        updateData.messages = {
          create: normalized[0],
        };
      }
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json(serializeProject(updated));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 },
      );
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

    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025 = record to delete does not exist.
      if (error.code === "P2025") {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 },
        );
      }
    }

    console.error("DELETE PROJECT ERROR:", error);

    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }
}
