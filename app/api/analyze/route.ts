import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic();

const EXTRACTION_PROMPT = `You are an expert architectural analyst. Analyze this blueprint image and extract ALL of the following as valid JSON only — no markdown, no explanation:

{
  "rooms": [{ "name": string, "estimatedSqft": number, "floor": number }],
  "dimensions": { "totalSqft": number, "width": number, "depth": number, "floors": number },
  "materials": [string],
  "structuralElements": [string],
  "annotations": [string],
  "buildingType": string,
  "confidence": "high" | "medium" | "low"
}

If a field cannot be determined, use null. Always return valid JSON.`;

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json();

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ]
    }]
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const data = JSON.parse(text.replace(/```json|```/g, '').trim());
  return NextResponse.json(data);
}