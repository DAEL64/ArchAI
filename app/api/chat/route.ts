import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { messages, blueprintContext } = await req.json();

    const safeMessages = Array.isArray(messages) ? messages : [];

    const systemPrompt = `You are an AI architectural co-pilot inside ArchitectAI.

You help the user understand architectural blueprints, room layouts, dimensions, materials, structural notes, and design implications.

Blueprint context:
${JSON.stringify(blueprintContext || {}, null, 2)}

Rules:
- If blueprintContext.status is "analysis_running", explain that the analysis is still running and blueprint-specific values will be available after it finishes.
- If exact dimensions are null or missing, do not invent measurements.
- If the user asks for numbers that are not available, say they are not visible or not confidently extracted.
- Stay grounded in the provided blueprintContext.
- Keep answers concise, helpful, and practical.
- Do not claim professional code/legal/building approval.
`;

    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      ...safeMessages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      })),
    ];

    const ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
        messages: ollamaMessages,
        stream: false,
        keep_alive: "5m",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Ollama chat request failed");
    }

    const data = await response.json();

    const reply =
      data.message?.content ||
      "I could not generate a response from the current blueprint context.";

    return NextResponse.json({ reply }, { status: 200 });
  } catch (error) {
    console.error("CHAT ENDPOINT ERROR:", error);

    return NextResponse.json(
      { error: "Failed to generate model inference response" },
      { status: 500 },
    );
  }
}
