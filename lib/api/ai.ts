import { apiFetch } from "./http";
import type { BlueprintData, ChatMessage } from "@/types/blueprint";
import type { GenerationParams } from "@/types/drawing";

export const aiApi = {
  analyze: (imageBase64: string) =>
    apiFetch<BlueprintData>("/api/analyze", { json: { imageBase64 } }),

  generate: (prompt: string, params?: GenerationParams) =>
    apiFetch<BlueprintData>("/api/generate", { json: { prompt, params } }),

  chat: (messages: ChatMessage[], blueprintContext: unknown) =>
    apiFetch<{ reply?: string }>("/api/chat", {
      json: { messages, blueprintContext },
    }),
};
