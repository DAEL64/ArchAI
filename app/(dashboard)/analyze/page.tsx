"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { BlueprintData } from "@/types/blueprint";

// ─── Types ───────────────────────────────────────────────

type AnalysisState = "idle" | "analyzing" | "done" | "error";
type ActiveTab = "rooms" | "dimensions" | "materials" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
  data: BlueprintData | null;
  messages: Message[];
  imageUrl: string | null; // Keeps track of layout image if safe to store
}

// ─── MAIN PAGE ───────────────────────────────────────────

export default function AnalyzePage() {
  // Active transient file states (Never persisted directly to avoid QuotaExceeded crashes)
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("Blueprint");

  // Project session state
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [data, setData] = useState<BlueprintData | null>(null);
  const [state, setState] = useState<AnalysisState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const [activeTab, setActiveTab] = useState<ActiveTab>("rooms");
  const [isTyping, setIsTyping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── UTILS: LOCAL STORAGE OPERATIONS ─────────────────────

  const getSavedProjects = (): Project[] => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("architectai_projects") || "[]");
    } catch {
      return [];
    }
  };

  const saveProjectUpdate = useCallback(
    (projectId: string, updatedFields: Partial<Project>) => {
      try {
        const existing = getSavedProjects();
        const index = existing.findIndex((p) => p.id === projectId);

        if (index !== -1) {
          existing[index] = { ...existing[index], ...updatedFields };
          localStorage.setItem(
            "architectai_projects",
            JSON.stringify(existing),
          );
        }
      } catch (err) {
        console.error(
          "Failed to save project updates due to storage limits:",
          err,
        );
      }
    },
    [],
  );

  const createNewProjectSession = useCallback(
    (initialData: BlueprintData | null, initialMessages: Message[]): string => {
      const newId = crypto.randomUUID();
      const newProject: Project = {
        id: newId,
        name: fileName || "New Blueprint Analysis",
        createdAt: new Date().toISOString(),
        data: initialData,
        messages: initialMessages,
        // FORCE NULL: Do not attempt to save Base64 strings to LocalStorage.
        // It will crash the 5MB limit and break the save system.
        imageUrl: null,
      };

      try {
        const existing = getSavedProjects();
        localStorage.setItem(
          "architectai_projects",
          JSON.stringify([newProject, ...existing]),
        );
      } catch (err) {
        console.error("Critical Storage Error: Browser memory is full", err);
      }

      setCurrentProjectId(newId);
      return newId;
    },
    [fileName], // Removed imageUrl dependency
  );

  // ─── ROUTING & STATE HYDRATION ───────────────────────────

  // On mount, check if loading an existing project from query params (?id=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("project");

    if (idParam) {
      const target = getSavedProjects().find((p) => p.id === idParam);
      if (target) {
        setCurrentProjectId(target.id);
        setData(target.data);
        setMessages(target.messages);
        setImageUrl(target.imageUrl);
        setState("done");
        return;
      }
    }

    // Always default to clean slate if no explicit ID or if state is broken
    setState("idle");
  }, []);

  // Auto-scroll chat window
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ─── HANDLE FILE ───────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    // Clear state before updating to guarantee fresh drop zones
    setImageUrl(null);
    setImageB64(null);
    setData(null);
    setMessages([]);
    setCurrentProjectId(null);
    setState("idle");

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageUrl(result);
      setImageB64(result.split(",")[1]);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  // ─── ANALYZE PIPELINE ──────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!imageB64 || state === "analyzing") return;

    setState("analyzing");
    const controller = new AbortController();

    // FIX: Pass a specific reason into the abort method to prevent the generic error
    const timeout = setTimeout(() => {
      controller.abort(new Error("Analysis timed out after 90 seconds"));
    }, 300000);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageB64 }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) throw new Error("Analysis failed server-side");

      const parsedData = await res.json();

      setData(parsedData);
      setState("done");
      setActiveTab("rooms");

      // Auto-initialize project save snapshot on analysis completion
      if (!currentProjectId) {
        createNewProjectSession(parsedData, messages);
      } else {
        saveProjectUpdate(currentProjectId, { data: parsedData });
      }
    } catch (err: any) {
      clearTimeout(timeout);

      // FIX: Gracefully catch the AbortError so it doesn't bleed into the console as a crash
      if (err.name === "AbortError" || err.message?.includes("timed out")) {
        console.warn(
          "⚠️ Analysis Pipeline: Request safely aborted because it took longer than 90s.",
        );
        setState("error");
        return; // Exit early so we don't log it as a fatal exception
      }

      console.error("Analysis Pipeline Exception:", err);
      setState("error");
    }
  }, [
    imageB64,
    state,
    currentProjectId,
    messages,
    createNewProjectSession,
    saveProjectUpdate,
  ]);

  // ─── CONVERSATION ENGINE ───────────────────────────────

  const sendMessage = useCallback(async () => {
    if (!input.trim() || state === "analyzing") return;

    const userMsg: Message = { role: "user", content: input.trim() };
    const payloadMessages = [...messages, userMsg];

    setMessages(payloadMessages);
    setInput("");
    setIsTyping(true);

    // Initialize state context tracking
    let activeId = currentProjectId;
    if (!activeId) {
      activeId = createNewProjectSession(data, payloadMessages);
    } else {
      saveProjectUpdate(activeId, { messages: payloadMessages });
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          blueprintContext: data, // Injects parsed telemetry data directly down the pipeline
        }),
      });

      if (!res.ok) throw new Error("Model failed to compute response");
      const modelResponse = await res.text();

      const finalMessages: Message[] = [
        ...payloadMessages,
        { role: "assistant", content: modelResponse },
      ];

      setMessages(finalMessages);
      saveProjectUpdate(activeId, { messages: finalMessages });
    } catch {
      const errorMessages: Message[] = [
        ...payloadMessages,
        {
          role: "assistant",
          content:
            "System was unable to process context or complete the inference loop.",
        },
      ];
      setMessages(errorMessages);
      saveProjectUpdate(activeId, { messages: errorMessages });
    } finally {
      setIsTyping(false);
    }
  }, [
    input,
    messages,
    data,
    currentProjectId,
    state,
    createNewProjectSession,
    saveProjectUpdate,
  ]);

  // ─── RENDER UI ─────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 antialiased font-sans">
      {/* Top Header Controls */}
      <header className="h-14 border-b border-zinc-800 px-6 flex items-center justify-between bg-zinc-900/50 back-drop-blur">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-wider uppercase text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded bg-emerald-500/5">
            System Operational
          </span>
          <h1 className="text-sm font-medium text-zinc-300">{fileName}</h1>
        </div>
        {currentProjectId && (
          <span className="text-xs font-mono text-zinc-500">
            ID: {currentProjectId}
          </span>
        )}
      </header>

      <div className="grid grid-cols-[320px_1fr_400px] flex-1 overflow-hidden">
        {/* LEFT COLUMN: Controls & Input File Handler */}
        <div className="border-r border-zinc-800 p-4 bg-zinc-900/20 flex flex-col gap-4 overflow-y-auto">
          <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
            Blueprint Source
          </h3>

          <div
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 transition rounded-xl p-6 text-center cursor-pointer min-h-[200px] flex flex-col items-center justify-center gap-2 bg-zinc-900/40 group"
          >
            {imageUrl ? (
              <div className="relative w-full h-full max-h-[180px] overflow-hidden rounded-lg">
                <img
                  src={imageUrl}
                  alt="Blueprint workspace snapshot"
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center group-hover:bg-zinc-700 transition text-zinc-400">
                  ↑
                </div>
                <p className="text-xs font-medium text-zinc-400">
                  Drag & Drop file target
                </p>
                <p className="text-[10px] text-zinc-500">
                  Supports raster blueprints (PNG, JPG)
                </p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) =>
              e.target.files?.[0] && handleFile(e.target.files[0])
            }
          />

          <button
            onClick={handleAnalyze}
            disabled={!imageB64 || state === "analyzing"}
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 text-sm font-medium transition shadow-sm font-mono tracking-wide"
          >
            {state === "analyzing" ? "PROCESSING DATA..." : "RUN ANALYSIS"}
          </button>

          <p className="text-xs w-full flex text-center justify-center text-white/50">
            Analysis may take a few minutes, please be patient
          </p>

          {state === "error" && (
            <p className="text-xs text-red-400 font-mono bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg">
              ERR: Execution trace interrupted. Resetting control nodes.
            </p>
          )}
        </div>

        {/* CENTER COLUMN: Parsed Context Evaluation Panels */}
        <div className="p-6 overflow-y-auto flex flex-col bg-zinc-900/10">
          <div className="flex gap-2 border-b border-zinc-800 pb-3 mb-6">
            {(["rooms", "dimensions", "materials"] as ActiveTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`text-xs uppercase font-mono tracking-wider px-3 py-1.5 rounded-md transition ${
                    activeTab === tab
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab}
                </button>
              ),
            )}
          </div>

          {data ? (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-2">
                  Building Context Mapping
                </h2>
                <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                  <p className="text-sm leading-relaxed text-zinc-300">
                    {data.mainPurpose || "Classification omitted."}
                  </p>
                </div>
              </div>

              <div>
                <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-2">
                  Engine Architecture Insights
                </h2>
                <ul className="space-y-2">
                  {data.architecturalInsights?.map((insight, idx) => (
                    <li
                      key={idx}
                      className="text-sm p-3.5 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-zinc-300 leading-relaxed flex gap-3"
                    >
                      <span className="text-emerald-400 font-mono">
                        [{idx + 1}]
                      </span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
              <p className="text-sm font-mono text-zinc-400">
                Awaiting target system telemetry...
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Upload and process a schematic to populate structural indices.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Dedicated Context-Aware Inference Agent */}
        <div className="border-l border-zinc-800 flex flex-col bg-zinc-900/30">
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/40">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400 font-mono">
              Inference Telemetry Chat
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center p-6 text-zinc-500">
                <p className="text-xs leading-relaxed">
                  No execution parameters specified yet. Initialize chat or
                  analysis to spawn a trackable instance inside your{" "}
                  <code className="text-zinc-400">projects</code> stack.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-1 px-1">
                  {m.role}
                </span>
                <div
                  className={`p-3 rounded-xl max-w-[85%] text-sm leading-relaxed border ${
                    m.role === "user"
                      ? "bg-zinc-800 border-zinc-700 text-zinc-100 rounded-tr-none"
                      : "bg-zinc-900 border-zinc-850 text-zinc-300 rounded-tl-none"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 p-2 bg-zinc-900/50 border border-zinc-800 w-16 rounded-full justify-center">
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 border-t border-zinc-800 bg-zinc-900/40 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Query model regarding blueprint composition..."
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-3 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 transition font-sans placeholder:text-zinc-600"
            />
            <button
              onClick={sendMessage}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-4 rounded-xl text-xs font-mono transition"
            >
              EXEC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
