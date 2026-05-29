import { apiFetch } from "./http";
import type { Drawing, DrawingInput, DrawingPatch } from "@/types/drawing";

export const drawingsApi = {
  listForProject: (projectId: string) =>
    apiFetch<Drawing[]>(`/api/drawings?projectId=${projectId}`, {
      cache: "no-store",
    }),

  get: (id: string) =>
    apiFetch<Drawing>(`/api/drawings?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    }),

  create: (projectId: string, input: DrawingInput) =>
    apiFetch<Drawing>("/api/drawings", { json: { projectId, ...input } }),

  update: (id: string, patch: DrawingPatch) =>
    apiFetch<Drawing>("/api/drawings", { method: "PUT", json: { id, ...patch } }),

  remove: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/drawings?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
