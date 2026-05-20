import { NextResponse } from "next/server"; // Import this at the top

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3.2-vision",
        stream: false,
        format: "json",
        prompt: `
You are an architectural blueprint expert.

Analyze this blueprint carefully and return ONLY valid JSON.

Extract:
- rooms
- square footage estimates
- number of floors
- dimensions
- likely building purpose
- likely construction materials
- structural elements
- key architectural notes
- confidence

JSON FORMAT:
{
  "rooms":[
    {
      "name":"",
      "estimatedSqft":0,
      "floor":1
    }
  ],
  "dimensions":{
    "totalSqft":0,
    "width":0,
    "depth":0,
    "floors":1
  },
  "materials":[],
  "structuralElements":[],
  "annotations":[],
  "buildingType":"",
  "mainPurpose":"",
  "architecturalInsights":[],
  "confidence":"high"
}
        `,
        images: [imageBase64],
      }),
    });

    const raw = await response.json();

    if (!raw.response) {
      throw new Error(raw.error || "Ollama failed to generate a response");
    }

    // Excellent string sanitization additions here 🎯
    const cleanedString = raw.response
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanedString);
    return NextResponse.json(parsed); // Using NextResponse for clean formatting consistency
  } catch (err) {
    console.error("ANALYZE ERROR:", err);

    // FIX: Corrected options argument positioning for server response status codes
    return NextResponse.json({ error: "analysis failed" }, { status: 500 });
  }
}
