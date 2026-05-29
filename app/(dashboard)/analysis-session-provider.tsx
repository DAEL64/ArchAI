"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  BlueprintData,
  BlueprintOverlay,
  ChatMessage,
  SavedProject,
} from "@/types/blueprint";
import type { GenerationParams } from "@/types/drawing";
import { projectsApi } from "@/lib/api/projects";
import { aiApi } from "@/lib/api/ai";
import { ApiError } from "@/lib/api/http";

export type AnalysisState = "idle" | "analyzing" | "generating" | "done" | "error";
export type ActiveTab =
  | "rooms"
  | "dimensions"
  | "materials"
  | "plan"
  | "interior"
  | "landscape";

interface ProjectPayload {
  name?: string;
  imageUrl?: string | null;
  data?: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages?: ChatMessage[];
}

interface AnalysisSessionContextValue {
  imageUrl: string | null;
  imageB64: string | null;
  fileName: string;
  currentProjectId: string | null;
  analysisError: string | null;
  data: BlueprintData | null;
  overlay: BlueprintOverlay | null;
  state: AnalysisState;
  messages: ChatMessage[];
  input: string;
  generatePrompt: string;
  activeTab: ActiveTab;
  isTyping: boolean;
  isProjectLoading: boolean;

  setInput: (value: string) => void;
  setGeneratePrompt: (value: string) => void;
  setActiveTab: (tab: ActiveTab) => void;

  handleFile: (file: File) => void;
  handleAnalyze: () => Promise<void>;
  generateBlueprint: (
    prompt: string,
    params?: GenerationParams,
  ) => Promise<BlueprintData | null>;
  sendMessage: () => Promise<void>;
  loadProjectById: (id: string) => Promise<boolean>;
  saveOverlay: (overlay: BlueprintOverlay | null) => Promise<void>;

  resetForNewAnalysis: () => void;
  resetChatOnly: () => void;
}

const ACTIVE_PROJECT_KEY = "architectai_active_project_id";

/**
 * Matches conversational requests to CREATE a blueprint (vs. questions about
 * an existing one). Requires an action verb followed by a plan-ish noun.
 */
const GENERATE_INTENT =
  /\b(create|generate|design|make|build|draw|sketch|produce)\b[\s\S]*\b(blueprint|floor\s?plans?|floorplans?|layouts?|house|home|apartment|flat|office|building|cabin|studio|villa|bungalow|duplex)\b/i;

const AnalysisSessionContext =
  createContext<AnalysisSessionContextValue | null>(null);

export function useAnalysisSession() {
  const ctx = useContext(AnalysisSessionContext);

  if (!ctx) {
    throw new Error(
      "useAnalysisSession must be used inside AnalysisSessionProvider",
    );
  }

  return ctx;
}

function notifyProjectRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("architectai-projects-updated"));
  }
}

function rememberActiveProject(id: string | null) {
  if (typeof window === "undefined") return;

  if (id) {
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } else {
    sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

export function AnalysisSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("Blueprint");

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [data, setData] = useState<BlueprintData | null>(null);
  const [overlay, setOverlay] = useState<BlueprintOverlay | null>(null);
  const [state, setState] = useState<AnalysisState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("rooms");
  const [isTyping, setIsTyping] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);

  // Single-flight guards. Refs (not state) so concurrent callers share them
  // synchronously regardless of render timing — this is what prevents the
  // duplicate-project bug.
  const runningJobRef = useRef<Promise<void> | null>(null);
  const creatingProjectRef = useRef<Promise<SavedProject> | null>(null);
  const hasTriedSessionRestoreRef = useRef(false);

  // Lazy, stable per-session id (regenerated only by "New Chat").
  const clientSessionIdRef = useRef<string | null>(null);
  if (clientSessionIdRef.current === null) {
    clientSessionIdRef.current = crypto.randomUUID();
  }

  // Synchronous mirror of currentProjectId so async flows never read a stale
  // value between a create and a follow-up action.
  const currentProjectIdRef = useRef<string | null>(null);

  const commitProjectId = useCallback((id: string | null) => {
    currentProjectIdRef.current = id;
    setCurrentProjectId(id);
    rememberActiveProject(id);
  }, []);

  const createProject = useCallback(
    async (payload: ProjectPayload): Promise<SavedProject> => {
      const project = await projectsApi.create({
        clientSessionId: clientSessionIdRef.current ?? "",
        name: payload.name || "New Blueprint Analysis",
        imageUrl: payload.imageUrl ?? null,
        data: payload.data ?? null,
        overlay: payload.overlay ?? null,
        messages: payload.messages ?? [],
      });

      commitProjectId(project.id);
      notifyProjectRefresh();

      return project;
    },
    [commitProjectId],
  );

  const updateProject = useCallback(
    async (projectId: string, payload: ProjectPayload): Promise<SavedProject> => {
      const project = await projectsApi.update(projectId, payload);

      rememberActiveProject(project.id);
      notifyProjectRefresh();

      return project;
    },
    [],
  );

  /**
   * Returns the active project id, creating exactly one project if none
   * exists yet. ALL creation paths (analyze, generate, chat) funnel through
   * here so there is never more than one in-flight create per session.
   */
  const ensureProjectSession = useCallback(
    async (payload: ProjectPayload): Promise<string> => {
      if (currentProjectIdRef.current) return currentProjectIdRef.current;

      if (creatingProjectRef.current) {
        const project = await creatingProjectRef.current;
        return project.id;
      }

      const creationPromise = createProject(payload);
      creatingProjectRef.current = creationPromise;

      try {
        const project = await creationPromise;
        return project.id;
      } finally {
        creatingProjectRef.current = null;
      }
    },
    [createProject],
  );

  const loadProjectById = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        setIsProjectLoading(true);

        const project = await projectsApi.get(id);

        commitProjectId(project.id);
        setData(project.data);
        setOverlay(project.overlay ?? null);
        setMessages(project.messages || []);
        setImageUrl(project.imageUrl || null);
        setImageB64(null);
        setFileName(project.name || "Blueprint");
        setState(project.data ? "done" : "idle");
        setActiveTab("rooms");

        return true;
      } catch (err) {
        // A deleted/deep-linked-missing project is an expected 404, not an
        // error worth logging.
        if (!(err instanceof ApiError) || err.status !== 404) {
          console.error("Failed to hydrate project:", err);
        }
        return false;
      } finally {
        setIsProjectLoading(false);
      }
    },
    [commitProjectId],
  );

  useEffect(() => {
    async function restoreActiveProject() {
      if (hasTriedSessionRestoreRef.current) return;
      hasTriedSessionRestoreRef.current = true;

      if (currentProjectIdRef.current) return;

      // A "start new" (?new) or deep-link (?id) load must NOT re-hydrate the
      // stale sessionStorage project, or the old chat flashes back in.
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get("new") || sp.get("id")) return;
      }

      const savedId =
        typeof window !== "undefined"
          ? sessionStorage.getItem(ACTIVE_PROJECT_KEY)
          : null;

      if (!savedId) return;

      const found = await loadProjectById(savedId);

      if (!found) {
        rememberActiveProject(null);
      }
    }

    restoreActiveProject();
  }, [loadProjectById]);

  const handleFile = useCallback(
    (file: File) => {
      /*
        Important: do NOT clear currentProjectId here. "Run New Analysis" lets
        the user upload a new blueprint inside the same project/conversation.
        "New Chat" is what clears currentProjectId and starts fresh.
      */
      setImageUrl(null);
      setImageB64(null);

      // Keep old stats visible while the new file is prepared; analysis will
      // replace data only after it succeeds.
      setState(data ? "done" : "idle");
      setActiveTab("rooms");

      const reader = new FileReader();

      reader.onload = (e) => {
        const result = e.target?.result as string;

        setImageUrl(result);
        setImageB64(result.split(",")[1]);
        setFileName(file.name || "Blueprint");
        setState(data ? "done" : "idle");
      };

      reader.readAsDataURL(file);
    },
    [data],
  );

  const handleAnalyze = useCallback(async () => {
    if (!imageB64) return;

    // Shared hard lock across analyze + generate: prevents duplicate jobs.
    if (runningJobRef.current) {
      return runningJobRef.current;
    }

    const projectAtStart = currentProjectIdRef.current;

    const job = (async () => {
      setState("analyzing");
      setAnalysisError(null);

      try {
        const parsedData = await aiApi.analyze(imageB64);

        setData(parsedData);
        setState("done");
        setActiveTab("rooms");

        const payload: ProjectPayload = {
          name: fileName || "Blueprint",
          imageUrl,
          data: parsedData,
          messages,
        };

        const targetId = projectAtStart ?? (await ensureProjectSession(payload));

        await updateProject(targetId, payload);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown analysis error";

        console.error("Analysis Pipeline Exception:", err);
        setAnalysisError(message);
        setState("error");
      } finally {
        runningJobRef.current = null;
      }
    })();

    runningJobRef.current = job;
    return job;
  }, [imageB64, fileName, imageUrl, messages, ensureProjectSession, updateProject]);

  const generateBlueprint = useCallback(
    async (
      prompt: string,
      params?: GenerationParams,
    ): Promise<BlueprintData | null> => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt) return null;

      if (runningJobRef.current) {
        await runningJobRef.current;
      }

      const projectAtStart = currentProjectIdRef.current;
      const generatedName =
        cleanPrompt.length > 48 ? `${cleanPrompt.slice(0, 48)}…` : cleanPrompt;

      let result: BlueprintData | null = null;

      const job = (async () => {
        setState("generating");
        setAnalysisError(null);
        setFileName(generatedName);

        try {
          const parsedData = await aiApi.generate(cleanPrompt, params);
          // Persist the constraints alongside the blueprint so the form can be
          // prefilled when the project is reopened.
          if (params) parsedData.generationParams = params;

          result = parsedData;

          setData(parsedData);
          setImageUrl(null);
          setImageB64(null);
          setState("done");
          setActiveTab("rooms");

          const payload: ProjectPayload = {
            name: generatedName,
            imageUrl: null,
            data: parsedData,
            messages,
          };

          const targetId =
            projectAtStart ?? (await ensureProjectSession(payload));

          await updateProject(targetId, payload);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown generation error";

          console.error("Generation Pipeline Exception:", err);
          setAnalysisError(message);
          setState("error");
          result = null;
        } finally {
          runningJobRef.current = null;
        }
      })();

      runningJobRef.current = job;
      await job;

      return result;
    },
    [messages, ensureProjectSession, updateProject],
  );

  const sendMessage = useCallback(async () => {
    if (!input.trim()) return;

    const userText = input.trim();

    const userMsg: ChatMessage = { role: "user", content: userText };
    const payloadMessages = [...messages, userMsg];

    setMessages(payloadMessages);
    setInput("");
    setIsTyping(true);

    let activeProjectId = currentProjectIdRef.current;

    try {
      // Conversational blueprint generation: when there is no blueprint yet
      // and the user asks to CREATE one, generate it and reply, instead of a
      // plain chat turn. Once a blueprint exists, chat stays Q&A (use the
      // Generate panel or New Chat to make another).
      if (
        state !== "analyzing" &&
        state !== "generating" &&
        !data &&
        GENERATE_INTENT.test(userText)
      ) {
        const generated = await generateBlueprint(userText);

        const replyContent = generated
          ? `Done — I generated a ${generated.buildingType.toLowerCase()} blueprint with ${
              generated.rooms.length
            } room${generated.rooms.length === 1 ? "" : "s"}${
              generated.dimensions.totalSqft
                ? ` (~${generated.dimensions.totalSqft} sqft)`
                : ""
            }. The rooms, dimensions, and materials panels on the left are now populated. Ask me to adjust anything.`
          : "I tried to generate a blueprint but the generation request failed. Please confirm Ollama is running and try again.";

        const finalMessages: ChatMessage[] = [
          ...payloadMessages,
          { role: "assistant", content: replyContent },
        ];

        setMessages(finalMessages);

        const targetId = currentProjectIdRef.current;
        if (targetId) {
          await updateProject(targetId, { messages: finalMessages });
        }
        return;
      }

      // Every conversation is persisted as one project ("chat"), created
      // exactly once via the shared single-flight guard so it survives a
      // reload. We persist again after the model replies (and in the catch on
      // failure), so no turn is lost without double-writing on every keystroke.
      activeProjectId = await ensureProjectSession({
        name: fileName || "Blueprint",
        imageUrl,
        data,
        messages: payloadMessages,
      });

      const context =
        data ||
        (state === "analyzing"
          ? {
              status: "analysis_running",
              note: "Blueprint analysis is still running. Answer generally and explain that blueprint-specific values will become available after analysis completes.",
            }
          : {
              status: "no_blueprint_analysis_yet",
              note: "No completed blueprint analysis is available yet. Answer generally. You can also offer to generate a blueprint if the user describes a building they want.",
            });

      const { reply } = await aiApi.chat(payloadMessages, context);

      const finalMessages: ChatMessage[] = [
        ...payloadMessages,
        {
          role: "assistant",
          content: reply || "No response was returned by the model.",
        },
      ];

      setMessages(finalMessages);

      if (activeProjectId) {
        await updateProject(activeProjectId, { messages: finalMessages });
      }
    } catch (err) {
      console.error("Chat failed:", err);

      const errorMessages: ChatMessage[] = [
        ...payloadMessages,
        {
          role: "assistant",
          content:
            "I could not process this request right now. Please check that Ollama is running and try again.",
        },
      ];

      setMessages(errorMessages);

      if (activeProjectId) {
        try {
          await updateProject(activeProjectId, { messages: errorMessages });
        } catch {
          // ignore secondary persistence failure
        }
      }
    } finally {
      setIsTyping(false);
    }
  }, [
    input,
    messages,
    imageUrl,
    data,
    state,
    fileName,
    ensureProjectSession,
    updateProject,
    generateBlueprint,
  ]);

  const resetForNewAnalysis = useCallback(() => {
    /*
      Same project, same conversation. Let the user upload a new blueprint.
      Keep old analysis visible until a new file is selected.
    */
    setImageB64(null);
    setState(data ? "done" : "idle");
    setActiveTab("rooms");
    setInput("");
  }, [data]);

  const resetChatOnly = useCallback(() => {
    /*
      NEW CHAT: completely new conversation/session. The next upload, generate,
      or message creates a brand-new project.
    */
    setImageUrl(null);
    setImageB64(null);
    setData(null);
    setOverlay(null);
    setMessages([]);
    commitProjectId(null);
    setFileName("Blueprint");
    setState("idle");
    setActiveTab("rooms");
    setInput("");
    setGeneratePrompt("");
    setIsTyping(false);
    setAnalysisError(null);

    runningJobRef.current = null;
    creatingProjectRef.current = null;

    clientSessionIdRef.current = crypto.randomUUID();
  }, [commitProjectId]);

  /**
   * Persists the blueprint edit overlay. Creates the project on first save if
   * none exists yet (e.g. the user uploaded an image and annotated it before
   * running analysis) — routed through the same single-flight guard so it
   * never spawns a duplicate. Only the small overlay JSON is written; the
   * original image is never re-encoded or duplicated.
   */
  const saveOverlay = useCallback(
    async (next: BlueprintOverlay | null) => {
      setOverlay(next);

      try {
        const id =
          currentProjectIdRef.current ??
          (await ensureProjectSession({
            name: fileName || "Blueprint",
            imageUrl,
            data,
            overlay: next,
            messages,
          }));

        await updateProject(id, { overlay: next });
      } catch (err) {
        console.error("Failed to save blueprint overlay:", err);
      }
    },
    [fileName, imageUrl, data, messages, ensureProjectSession, updateProject],
  );

  return (
    <AnalysisSessionContext.Provider
      value={{
        imageUrl,
        imageB64,
        fileName,
        currentProjectId,
        data,
        overlay,
        state,
        messages,
        input,
        generatePrompt,
        activeTab,
        isTyping,
        isProjectLoading,
        analysisError,

        setInput,
        setGeneratePrompt,
        setActiveTab,

        handleFile,
        handleAnalyze,
        generateBlueprint,
        sendMessage,
        loadProjectById,
        saveOverlay,

        resetForNewAnalysis,
        resetChatOnly,
      }}
    >
      {children}
    </AnalysisSessionContext.Provider>
  );
}
