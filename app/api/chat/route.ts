// app/api/chat/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { messages, blueprintContext } = await req.json();

    // Compile contextual ground rule string injects
    const systemPrompt = `You are an AI architectural co-pilot inside ArchitectAI.
You are helping a client analyze their blueprint. Here is the validated data payload compiled from the vision extraction engine:

${JSON.stringify(blueprintContext || {}, null, 2)}

Answer queries accurately relative to these specific building constraints, dimensions, material provisions, and room listings. Keep explanations clean and concise.`;

    // Package payload structure to push into Ollama local chat pipeline
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2-vision", // Or your standard text model like llama3.2 / mistral
        messages: ollamaMessages,
        stream: false,
      }),
    });

    const data = await response.json();
    const replyText =
      data.message?.content ||
      "System failed to compute text context linkage response.";

    return new NextResponse(replyText, { status: 200 });
  } catch (error) {
    console.error("CHAT ENDPOINT ERROR:", error);
    return NextResponse.json(
      { error: "Failed to generate model inference stream" },
      { status: 500 },
    );
  }
}
