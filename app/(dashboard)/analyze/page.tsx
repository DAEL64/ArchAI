"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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

// ─── INTERNAL COMPONENT WITH HOOKS ───────────────────────

function AnalyzeContent() {
  // Active transient file states
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

  // Next.js Router Hook for URL tracking
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");

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
    [fileName],
  );

  // ─── ROUTING & STATE HYDRATION ───────────────────────────

  useEffect(() => {
    if (idParam) {
      const target = getSavedProjects().find((p) => p.id === idParam);
      if (target) {
        setCurrentProjectId(target.id);
        setData(target.data);
        setMessages(target.messages || []);
        setImageUrl(target.imageUrl);
        setFileName(target.name || "Blueprint");
        setState("done");
        return;
      }
    }

    setState("idle");
    setImageUrl(null);
    setImageB64(null);
    setData(null);
    setMessages([]);
    setCurrentProjectId(null);
    setFileName("Blueprint");
  }, [idParam]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ─── HANDLE FILE ───────────────────────────────────────

  const handleFile = useCallback((file: File) => {
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

    let activeProjectId = currentProjectId;
    if (!activeProjectId) {
      activeProjectId = createNewProjectSession(null, []);
    }

    setState("analyzing");
    const controller = new AbortController();

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

      if (!currentProjectId) {
        createNewProjectSession(parsedData, messages);
      } else {
        saveProjectUpdate(currentProjectId, { data: parsedData });
      }

      window.dispatchEvent(new Event("storage"));
    } catch (err: any) {
      clearTimeout(timeout);

      if (err.name === "AbortError" || err.message?.includes("timed out")) {
        console.warn("⚠️ Analysis Pipeline: Request aborted.");
        setState("error");
        return;
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

    let activeId = currentProjectId;
    if (!activeId) {
      activeId = createNewProjectSession(data, payloadMessages);
    } else {
      saveProjectUpdate(activeId, { messages: payloadMessages });
    }

    window.dispatchEvent(new Event("storage"));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          blueprintContext: data,
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

      window.dispatchEvent(new Event("storage"));
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

      window.dispatchEvent(new Event("storage"));
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
      {/* Top Header */}
      <header className="h-14 border-b border-zinc-800 px-6 flex items-center justify-between bg-zinc-900/50 back-drop-blur flex-shrink-0">
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
        {/* LEFT COLUMN: Input File Handler */}
        <div className="border-r border-zinc-800 p-4 bg-zinc-900/20 flex flex-col gap-4 overflow-y-auto hidden-scrollbar">
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
        <div className="p-6 overflow-y-auto flex flex-col bg-zinc-900/10 hidden-scrollbar">
          <div className="flex gap-2 border-b border-zinc-800 pb-3 mb-6">
            {(["rooms", "dimensions", "materials"] as ActiveTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`text-xs uppercase font-mono tracking-wider px-3 py-1.5 rounded-md transition ${
                    activeTab === tab
                      ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                  }`}
                >
                  {tab}
                </button>
              ),
            )}
          </div>

          {data ? (
            <div className="space-y-6 max-w-3xl">
              {/* Always keep the top-level insights visible as a header */}
              <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800/80 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
                    Project Classification
                  </h2>
                  <span className="text-[10px] uppercase font-mono text-emerald-400/70 border border-emerald-400/20 px-2 py-0.5 rounded">
                    Confidence: {data.confidence || "N/A"}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-zinc-300">
                  {data.mainPurpose || "Classification omitted."}
                </p>
                <div className="text-xs text-zinc-500 font-mono mt-1">
                  Type:{" "}
                  <span className="text-zinc-400">
                    {data.buildingType || "Unknown"}
                  </span>
                </div>
              </div>

              {/* DYNAMIC TAB CONTENT SWITCHER */}

              {/* 1. ROOMS TAB */}
              {activeTab === "rooms" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
                    Detected Spatial Zones
                  </h2>
                  {data.rooms && data.rooms.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {data.rooms.map((room, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1.5"
                        >
                          <span className="text-sm font-medium text-zinc-200 truncate">
                            {room.name || "Unidentified Space"}
                          </span>
                          <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                            <span>Floor {room.floor || 1}</span>
                            <span>
                              {room.estimatedSqft
                                ? `${room.estimatedSqft} sqft`
                                : "Size Est. Pending"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-mono text-zinc-500 italic">
                      No isolated rooms detected in telemetry.
                    </p>
                  )}
                </div>
              )}

              {/* 2. DIMENSIONS TAB */}
              {activeTab === "dimensions" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
                    Structural Mathematics
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Total Area
                      </span>
                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.totalSqft || "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft²</span>
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Width
                      </span>
                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.width || "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft</span>
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Depth
                      </span>
                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.depth || "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft</span>
                      </span>
                    </div>
                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Floors
                      </span>
                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.floors || "1"}
                      </span>
                    </div>
                  </div>

                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mt-6">
                    Key Architectural Notes
                  </h2>
                  <ul className="space-y-2">
                    {data.architecturalInsights?.map((insight, idx) => (
                      <li
                        key={idx}
                        className="text-sm p-3 bg-zinc-900/30 border border-zinc-800/50 rounded-lg text-zinc-300 flex gap-3"
                      >
                        <span className="text-emerald-400/50 font-mono">
                          [{idx + 1}]
                        </span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 3. MATERIALS TAB */}
              {activeTab === "materials" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-3">
                      Identified Construction Materials
                    </h2>
                    {data.materials && data.materials.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {data.materials.map((mat, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1.5 rounded bg-zinc-800 text-xs text-zinc-300 border border-zinc-700"
                          >
                            {mat}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm font-mono text-zinc-500 italic">
                        No materials specified in blueprint text.
                      </p>
                    )}
                  </div>

                  <div>
                    <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-3">
                      Core Structural Elements
                    </h2>
                    {data.structuralElements &&
                    data.structuralElements.length > 0 ? (
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {data.structuralElements.map((elem, idx) => (
                          <li
                            key={idx}
                            className="text-sm p-2.5 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-400 flex items-center gap-2"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                            {elem}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm font-mono text-zinc-500 italic">
                        Structural elements obscured or unclear.
                      </p>
                    )}
                  </div>
                </div>
              )}
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

        {/* RIGHT COLUMN: Chat Bot */}
        <div className="border-l border-zinc-800 flex flex-col bg-zinc-900/30 overflow-hidden">
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/40 flex-shrink-0">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400 font-mono">
              Inference Telemetry Chat
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 hidden-scrollbar">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center p-6 text-zinc-500">
                <p className="text-xs leading-relaxed">
                  No execution parameters specified yet. Initialize chat or
                  analysis to spawn a trackable instance.
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

          <div className="p-3 border-t border-zinc-800 bg-zinc-900/40 flex gap-2 flex-shrink-0">
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

// ─── MAIN EXPORT WITH SUSPENSE BOUNDARY ──────────────────
export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-zinc-950 flex items-center justify-center font-mono text-zinc-500 text-sm">
          Loading Core Architecture...
        </div>
      }
    >
      <AnalyzeContent />
    </Suspense>
  );
}
