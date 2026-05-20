// app/api/projects/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

// FETCH ALL PROJECTS (For your Projects page)
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) {
    console.error("GET PROJECTS ERROR:", error);
    return NextResponse.json(
      { error: "Failed to load projects" },
      { status: 500 },
    );
  }
}

// CREATE A NEW PROJECT (Fired immediately after an upload analysis finishes)

export async function POST(req: Request) {
  try {
    const { name, data, imageUrl, messages } = await req.json();

    const newProject = await prisma.project.create({
      data: {
        name: name || "Untitled Blueprint Analysis",
        imageUrl: imageUrl || null,
        data: data || {},
        // FIX: Explicitly create related messages if they exist in the payload
        messages: {
          create:
            messages?.map((msg: any) => ({
              role: msg.role,
              content: msg.content,
            })) || [],
        },
      },
      include: {
        messages: true, // Returns the created messages back to the frontend client
      },
    });

    return NextResponse.json(newProject);
  } catch (error) {
    console.error("CREATE PROJECT ERROR:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}

// UPDATE EXISTING PROJECT OR APPEND MESSAGES
export async function PUT(req: Request) {
  try {
    const { projectId, data, newMessage } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing project ID" },
        { status: 400 },
      );
    }

    const updateData: any = {};
    if (data) updateData.data = data;

    if (newMessage) {
      updateData.messages = {
        create: {
          role: newMessage.role,
          content: newMessage.content,
        },
      };
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("UPDATE PROJECT ERROR:", error);
    return NextResponse.json(
      { error: "Failed to sync updates" },
      { status: 500 },
    );
  }
}

// DELETE A PROJECT
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id)
      return NextResponse.json({ error: "Id required" }, { status: 400 });

    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE PROJECT ERROR:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }
}
