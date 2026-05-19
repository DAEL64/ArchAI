"use client";

import { useState, useCallback, useRef } from "react";
import type { BlueprintData } from "@/types/blueprint";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisState = "idle" | "uploading" | "analyzing" | "done" | "error";
type ActiveTab = "rooms" | "dimensions" | "materials" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded bg-white/5 animate-pulse ${className ?? ""}`}
      style={{ animationDuration: "1.8s" }}
    />
  );
}

// ─── Upload Panel ─────────────────────────────────────────────────────────────

function UploadPanel({
  onFile,
  imageUrl,
  state,
}: {
  onFile: (file: File, b64: string) => void;
  imageUrl: string | null;
  state: AnalysisState;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = useCallback(
    (file: File) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const b64 = result.split(",")[1];
        onFile(file, b64);
      };
      reader.readAsDataURL(file);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex-shrink-0">
        <p className="font-mono text-[10px] tracking-widest uppercase text-white/30">
          01 / Blueprint
        </p>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {imageUrl ? (
          /* Preview */
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 overflow-hidden relative">
              <img
                src={imageUrl}
                alt="Blueprint"
                className="absolute inset-0 w-full h-full object-contain p-3"
              />
              {state === "analyzing" && (
                <div className="absolute inset-0 bg-[#0a0d0f]/70 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-[#4ecdc4]/30 border-t-[#4ecdc4] rounded-full animate-spin" />
                  <p className="font-mono text-xs text-[#4ecdc4]/70 tracking-widest">
                    Analyzing…
                  </p>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-white/5 flex-shrink-0">
              <button
                onClick={() => inputRef.current?.click()}
                className="w-full py-2 border border-white/10 font-mono text-[11px] tracking-widest uppercase text-white/30 hover:border-white/20 hover:text-white/50 transition-all"
              >
                Replace file
              </button>
            </div>
          </div>
        ) : (
          /* Drop zone */
          <div
            className={`absolute inset-4 border-2 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
              dragging
                ? "border-[#4ecdc4]/60 bg-[#4ecdc4]/5"
                : "border-white/10 hover:border-white/20"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div
              className={`w-12 h-12 border flex items-center justify-center transition-colors ${dragging ? "border-[#4ecdc4]/60" : "border-white/15"}`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke={dragging ? "#4ecdc4" : "rgba(255,255,255,0.3)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="text-center px-4">
              <p className="font-mono text-xs text-white/40 tracking-wide mb-1">
                Drop blueprint here
              </p>
              <p className="font-mono text-[10px] text-white/20 tracking-widest">
                PNG · JPG · PDF · TIFF
              </p>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) =>
            e.target.files?.[0] && processFile(e.target.files[0])
          }
        />
      </div>
    </div>
  );
}

// ─── Analysis Panel ────────────────────────────────────────────────────────────

function AnalysisPanel({
  data,
  state,
  messages,
  onSendMessage,
  activeTab,
  setActiveTab,
}: {
  data: BlueprintData | null;
  state: AnalysisState;
  messages: Message[];
  onSendMessage: (msg: string) => void;
  activeTab: ActiveTab;
  setActiveTab: (t: ActiveTab) => void;
}) {
  const [input, setInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: "rooms", label: "Rooms" },
    { key: "dimensions", label: "Dims" },
    { key: "materials", label: "Materials" },
    { key: "chat", label: "Chat" },
  ];

  const send = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const loading = state === "analyzing" || state === "uploading";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex-shrink-0">
        <p className="font-mono text-[10px] tracking-widest uppercase text-white/30">
          03 / Analysis
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 font-mono text-[11px] tracking-widest uppercase transition-all ${
              activeTab === t.key
                ? "text-[#4ecdc4] border-b border-[#4ecdc4]"
                : "text-white/25 hover:text-white/45"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
        {activeTab === "rooms" && (
          <>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-white/5 p-3 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-16" />
                </div>
              ))
            ) : data?.rooms?.length ? (
              data.rooms.map((room, i) => (
                <div
                  key={i}
                  className="border border-white/8 p-3 hover:border-white/15 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-xs text-white/80">
                      {room.name}
                    </p>
                    {room.estimatedSqft && (
                      <span className="font-mono text-[10px] text-[#4ecdc4]/70">
                        {room.estimatedSqft} ft²
                      </span>
                    )}
                  </div>
                  {room.floor !== undefined && (
                    <p className="font-mono text-[10px] text-white/25">
                      Floor {room.floor}
                    </p>
                  )}
                </div>
              ))
            ) : state === "idle" ? (
              <EmptyState text="Upload a blueprint to see rooms" />
            ) : (
              <EmptyState text="No rooms detected" />
            )}
          </>
        )}

        {activeTab === "dimensions" && (
          <>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))
            ) : data?.dimensions ? (
              <div className="space-y-2">
                {[
                  {
                    label: "Total area",
                    value: data.dimensions.totalSqft
                      ? `${data.dimensions.totalSqft} ft²`
                      : null,
                  },
                  {
                    label: "Width",
                    value: data.dimensions.width
                      ? `${data.dimensions.width} ft`
                      : null,
                  },
                  {
                    label: "Depth",
                    value: data.dimensions.depth
                      ? `${data.dimensions.depth} ft`
                      : null,
                  },
                  {
                    label: "Floors",
                    value: data.dimensions.floors?.toString(),
                  },
                  { label: "Building type", value: data.buildingType },
                ]
                  .filter((r) => r.value)
                  .map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between border border-white/5 px-3 py-2.5"
                    >
                      <span className="font-mono text-[11px] text-white/35 tracking-wide">
                        {row.label}
                      </span>
                      <span className="font-mono text-[11px] text-white/80">
                        {row.value}
                      </span>
                    </div>
                  ))}
                {data.confidence && (
                  <div
                    className={`mt-3 px-3 py-2 border font-mono text-[10px] tracking-widest uppercase ${
                      data.confidence === "high"
                        ? "border-[#4ecdc4]/20 text-[#4ecdc4]/60 bg-[#4ecdc4]/5"
                        : data.confidence === "medium"
                          ? "border-yellow-500/20 text-yellow-500/60 bg-yellow-500/5"
                          : "border-red-400/20 text-red-400/60 bg-red-400/5"
                    }`}
                  >
                    Confidence: {data.confidence}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                text={
                  state === "idle"
                    ? "Upload a blueprint to see dimensions"
                    : "No dimensions detected"
                }
              />
            )}
          </>
        )}

        {activeTab === "materials" && (
          <>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))
            ) : data?.materials?.length ? (
              <div className="space-y-1.5">
                {data.materials.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 border border-white/5"
                  >
                    <span className="w-1 h-1 rounded-full bg-[#4ecdc4]/50 flex-shrink-0" />
                    <span className="font-mono text-[11px] text-white/60">
                      {m}
                    </span>
                  </div>
                ))}
                {data.structuralElements?.length ? (
                  <>
                    <p className="font-mono text-[10px] tracking-widest uppercase text-white/20 pt-3 pb-1">
                      Structural
                    </p>
                    {data.structuralElements.map((el, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-2 border border-white/5"
                      >
                        <span className="w-1 h-1 rounded-full bg-white/20 flex-shrink-0" />
                        <span className="font-mono text-[11px] text-white/40">
                          {el}
                        </span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            ) : (
              <EmptyState
                text={
                  state === "idle"
                    ? "Upload a blueprint to see materials"
                    : "No materials detected"
                }
              />
            )}
          </>
        )}

        {activeTab === "chat" && (
          <div className="flex flex-col h-full -mx-4 -my-4">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col gap-2 pt-2">
                  <p className="font-mono text-[10px] text-white/20 tracking-widest uppercase mb-2">
                    Suggested questions
                  </p>
                  {[
                    "What is the total square footage?",
                    "Are there any load-bearing walls?",
                    "What materials are used?",
                    "How many floors does this have?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => onSendMessage(q)}
                      className="text-left px-3 py-2 border border-white/8 font-mono text-[11px] text-white/35 hover:border-[#4ecdc4]/30 hover:text-white/55 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 font-mono text-[11px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#4ecdc4]/10 border border-[#4ecdc4]/20 text-[#4ecdc4]/90"
                        : "bg-white/5 border border-white/8 text-white/65"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat input */}
            <div className="px-4 py-3 border-t border-white/5 flex-shrink-0 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={
                  data
                    ? "Ask about this blueprint…"
                    : "Upload a blueprint first…"
                }
                disabled={!data}
                className="flex-1 bg-white/[0.04] border border-white/10 px-3 py-2 font-mono text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-[#4ecdc4]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <button
                onClick={send}
                disabled={!data || !input.trim()}
                className="px-3 py-2 border border-[#4ecdc4]/30 text-[#4ecdc4] font-mono text-[11px] hover:bg-[#4ecdc4]/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="font-mono text-[11px] text-white/20 tracking-wide">
        {text}
      </p>
    </div>
  );
}

// ─── Viewer Panel ──────────────────────────────────────────────────────────────

function ViewerPanel({
  imageUrl,
  data,
  state,
}: {
  imageUrl: string | null;
  data: BlueprintData | null;
  state: AnalysisState;
}) {
  const [view, setView] = useState<"blueprint" | "3d">("blueprint");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between flex-shrink-0">
        <p className="font-mono text-[10px] tracking-widest uppercase text-white/30">
          02 / Viewer
        </p>
        {imageUrl && (
          <div className="flex gap-1">
            {(["blueprint", "3d"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 font-mono text-[10px] tracking-widest uppercase transition-all ${
                  view === v
                    ? "bg-[#4ecdc4]/10 text-[#4ecdc4] border border-[#4ecdc4]/20"
                    : "text-white/25 border border-transparent hover:text-white/45"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        {!imageUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {/* Blueprint grid placeholder */}
            <div
              className="w-48 h-48 opacity-5"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(78,205,196,1) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(78,205,196,1) 1px, transparent 1px)
                `,
                backgroundSize: "16px 16px",
              }}
            />
            <p className="font-mono text-[11px] text-white/15 tracking-widest absolute">
              Awaiting blueprint
            </p>
          </div>
        ) : view === "blueprint" ? (
          <div
            className="absolute inset-0 overflow-auto flex items-center justify-center p-4"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
              `,
              backgroundSize: "30px 30px",
            }}
          >
            <img
              src={imageUrl}
              alt="Blueprint"
              className="max-w-full max-h-full object-contain"
              style={{ imageRendering: "crisp-edges" }}
            />
            {state === "analyzing" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0d0f]/60">
                <div className="w-10 h-10 border-2 border-[#4ecdc4]/20 border-t-[#4ecdc4] rounded-full animate-spin" />
                <p className="font-mono text-xs text-[#4ecdc4]/80 tracking-widest">
                  Claude is reading your blueprint…
                </p>
              </div>
            )}
          </div>
        ) : (
          /* 3D placeholder — wire in BuildingModel here */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#080b0d]">
            {data?.rooms?.length ? (
              <div className="text-center">
                <p className="font-mono text-xs text-white/30 tracking-widest mb-4">
                  3D model ready
                </p>
                {/* TODO: <BuildingModel rooms={data.rooms} /> */}
                <div className="border border-[#4ecdc4]/10 px-6 py-3">
                  <p className="font-mono text-[11px] text-[#4ecdc4]/40">
                    Import BuildingModel to render
                  </p>
                </div>
              </div>
            ) : (
              <p className="font-mono text-[11px] text-white/20 tracking-widest">
                Analyze blueprint first
              </p>
            )}
          </div>
        )}

        {/* Annotations overlay */}
        {data?.annotations?.length && view === "blueprint" && (
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
            {data.annotations.slice(0, 3).map((note, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-[#0a0d0f]/80 border border-white/10 font-mono text-[10px] text-white/40"
              >
                {note}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Analyze Button ────────────────────────────────────────────────────────────

function AnalyzeBar({
  canAnalyze,
  state,
  onAnalyze,
  data,
}: {
  canAnalyze: boolean;
  state: AnalysisState;
  onAnalyze: () => void;
  data: BlueprintData | null;
}) {
  return (
    <div className="flex-shrink-0 border-t border-white/5 px-4 py-3 flex items-center justify-between bg-[#0a0d0f]">
      <div className="flex items-center gap-3">
        {data && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ecdc4]" />
            <span className="font-mono text-[11px] text-white/40">
              {data.rooms?.length ?? 0} rooms ·{" "}
              {data.buildingType ?? "Unknown type"}
            </span>
          </>
        )}
        {state === "error" && (
          <span className="font-mono text-[11px] text-red-400/70">
            Analysis failed — try again
          </span>
        )}
      </div>
      <button
        onClick={onAnalyze}
        disabled={!canAnalyze || state === "analyzing"}
        className={`px-6 py-2.5 font-mono text-xs tracking-widest uppercase transition-all ${
          canAnalyze && state !== "analyzing"
            ? "bg-[#4ecdc4] text-[#0a0d0f] font-bold hover:bg-white"
            : "border border-white/10 text-white/20 cursor-not-allowed"
        }`}
      >
        {state === "analyzing" ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border border-[#0a0d0f]/30 border-t-[#0a0d0f] rounded-full animate-spin" />
            Analyzing…
          </span>
        ) : data ? (
          "Re-analyze"
        ) : (
          "Analyze Blueprint"
        )}
      </button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>("image/png");
  const [data, setData] = useState<BlueprintData | null>(null);
  const [state, setState] = useState<AnalysisState>("idle");
  const [activeTab, setActiveTab] = useState<ActiveTab>("rooms");
  const [messages, setMessages] = useState<Message[]>([]);

  const handleFile = useCallback((file: File, b64: string) => {
    setImageUrl(URL.createObjectURL(file));
    setImageB64(b64);
    setMediaType(file.type || "image/png");
    setData(null);
    setMessages([]);
    setState("idle");
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imageB64) return;
    setState("analyzing");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageB64, mediaType }),
      });
      if (!res.ok) throw new Error("API error");
      const json: BlueprintData = await res.json();
      setData(json);
      setState("done");
      setActiveTab("rooms");

      const project = {
        id: crypto.randomUUID(),
        name: File.name,
        createdAt: new Date().toISOString(),
        thumbnailUrl: imageUrl,
        data: json,
      };
      const existing = JSON.parse(
        localStorage.getItem("architectai_projects") || "[]",
      );
      localStorage.setItem(
        "architectai_projects",
        JSON.stringify([project, ...existing]),
      );
    } catch {
      setState("error");
    }
  }, [imageB64, mediaType]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!data) return;
      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            blueprintContext: data,
          }),
        });
        if (!res.ok) throw new Error();
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let reply = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          reply += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: reply };
            return updated;
          });
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong." },
        ]);
      }
    },
    [data, messages],
  );

  return (
    <div className="h-full flex flex-col">
      {/* 3-panel grid */}
      <div className="flex-1 overflow-hidden grid grid-cols-[280px_1fr_300px] divide-x divide-white/5">
        {/* Panel 1 — Upload */}
        <UploadPanel onFile={handleFile} imageUrl={imageUrl} state={state} />

        {/* Panel 2 — Viewer */}
        <ViewerPanel imageUrl={imageUrl} data={data} state={state} />

        {/* Panel 3 — Analysis */}
        <AnalysisPanel
          data={data}
          state={state}
          messages={messages}
          onSendMessage={handleSendMessage}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      </div>

      {/* Bottom action bar */}
      <AnalyzeBar
        canAnalyze={!!imageB64}
        state={state}
        onAnalyze={handleAnalyze}
        data={data}
      />
    </div>
  );
}
