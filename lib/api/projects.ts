import { apiFetch } from "./http";
import type {
  BlueprintData,
  BlueprintOverlay,
  ChatMessage,
} from "@/types/blueprint";
import type { ProjectWithDrawings } from "@/types/drawing";

export interface CreateProjectPayload {
  clientSessionId: string;
  name?: string;
  imageUrl?: string | null;
  data?: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages?: ChatMessage[];
}

export interface UpdateProjectPayload {
  name?: string;
  imageUrl?: string | null;
  data?: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages?: ChatMessage[];
  newMessage?: ChatMessage;
}

export const projectsApi = {
  list: () =>
    apiFetch<ProjectWithDrawings[]>("/api/projects", { cache: "no-store" }),

  get: (id: string) =>
    apiFetch<ProjectWithDrawings>(`/api/projects?id=${id}`, {
      cache: "no-store",
    }),

  create: (payload: CreateProjectPayload) =>
    apiFetch<ProjectWithDrawings>("/api/projects", { json: payload }),

  update: (projectId: string, payload: UpdateProjectPayload) =>
    apiFetch<ProjectWithDrawings>("/api/projects", {
      method: "PUT",
      json: { projectId, ...payload },
    }),

  remove: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/projects?id=${id}`, {
      method: "DELETE",
    }),
};
