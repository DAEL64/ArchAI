"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { GenerationParams } from "@/types/drawing";
import { useAnalysisSession } from "../analysis-session-provider";
import { ConstraintsForm } from "../constraints-form";
import { InteriorPanel } from "../interior-panel";
import { LandscapePanel } from "../landscape-panel";
import { PlanView } from "../plan-view";

function AnalyzeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const newParam = searchParams.get("new");

  const {
    imageUrl,
    imageB64,
    fileName,
    currentProjectId,
    data,
    overlay,
    state,
    analysisError,
    messages,
    input,
    generatePrompt,
    activeTab,
    isTyping,
    isProjectLoading,

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
  } = useAnalysisSession();

  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // On phones the three panes can't share the screen, so we show one at a time
  // via a segmented control. On lg+ all three render side by side (this state
  // is then irrelevant). Default to the controls pane so upload/generate are
  // immediately reachable.
  const [mobilePane, setMobilePane] = useState<"source" | "work" | "chat">(
    "source",
  );

  // Optional structured constraints for generation (req #9). Prefilled from a
  // loaded project's saved params; never forced.
  const [genParams, setGenParams] = useState<GenerationParams>({});
  useEffect(() => {
    if (data?.generationParams) setGenParams(data.generationParams);
  }, [data?.generationParams]);

  const isBusy = state === "analyzing" || state === "generating";

  // When analysis/generation/loading finishes, surface the result pane on
  // mobile so the user isn't left staring at the controls.
  useEffect(() => {
    if (state === "done") setMobilePane("work");
  }, [state]);

  // "Start new" entry points (?new=1) clear the restored session, then we drop
  // the flag from the URL so a refresh doesn't keep wiping state.
  useEffect(() => {
    if (!newParam) return;
    resetChatOnly();
    router.replace("/analyze");
  }, [newParam, resetChatOnly, router]);

  useEffect(() => {
    async function hydrateFromUrl() {
      if (newParam) return;
      if (!idParam) return;
      if (idParam === currentProjectId) return;

      const found = await loadProjectById(idParam);

      if (!found) {
        router.replace("/analyze");
      }
    }

    hydrateFromUrl();
  }, [idParam, newParam, currentProjectId, loadProjectById, router]);

  // Only auto-scroll once a conversation exists, so an empty chat doesn't yank
  // the layout on first paint.
  useEffect(() => {
    if (messages.length === 0) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const tabs = [
    "rooms",
    "dimensions",
    "materials",
    "plan",
    "interior",
    "landscape",
  ] as const;
  const tabLabels: Record<(typeof tabs)[number], string> = {
    rooms: "Rooms",
    dimensions: "Dimensions",
    materials: "Materials",
    plan: "Plan View",
    interior: "Interior",
    landscape: "Landscape",
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100 antialiased font-sans">
      <header className="h-14 border-b border-zinc-800 px-4 sm:px-6 flex items-center justify-between gap-3 bg-zinc-900/50 backdrop-blur flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[10px] sm:text-xs tracking-wider uppercase text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded bg-emerald-500/5 flex-shrink-0">
            {state === "analyzing"
              ? "Analyzing"
              : state === "generating"
                ? "Generating"
                : "Operational"}
          </span>

          <h1 className="text-sm font-medium text-zinc-300 truncate">
            {fileName}
          </h1>
        </div>

        {currentProjectId && (
          <span className="hidden md:block text-xs font-mono text-zinc-500 flex-shrink-0">
            ID: {currentProjectId}
          </span>
        )}
      </header>

      {/* mobile pane switcher — hidden on lg where all three panes show */}
      <div className="lg:hidden flex border-b border-zinc-800 bg-zinc-900/40 flex-shrink-0">
        {(
          [
            ["source", "Source"],
            ["work", "Workspace"],
            ["chat", "Chat"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMobilePane(key)}
            className={`flex-1 py-2.5 text-[11px] font-mono uppercase tracking-wider transition border-b-2 ${
              mobilePane === key
                ? "text-emerald-300 border-emerald-400 bg-emerald-500/5"
                : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-[300px_1fr_380px]">
        <div
          className={`${
            mobilePane === "source" ? "flex" : "hidden"
          } lg:flex flex-1 min-h-0 lg:flex-none border-r border-zinc-800 p-4 bg-zinc-900/20 flex-col gap-4 overflow-y-auto hidden-scrollbar`}
        >
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
                  Supports raster blueprints PNG, JPG
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
            disabled={!imageB64 || isBusy}
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 text-sm font-medium transition shadow-sm font-mono tracking-wide"
          >
            {state === "analyzing" ? "PROCESSING DATA..." : "RUN ANALYSIS"}
          </button>

          <div className="flex items-center gap-3 py-0.5">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
              or generate
            </span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
              Generate with AI
            </h3>

            <p className="text-[10px] text-zinc-500 leading-relaxed">
              No blueprint? Describe a building and the AI will design a floor
              plan with rooms, dimensions, and materials.
            </p>

            <textarea
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (generatePrompt.trim() && !isBusy) {
                    generateBlueprint(generatePrompt, genParams);
                  }
                }
              }}
              placeholder="e.g. a 2-bedroom single-story house with an open kitchen, a home office, and a 2-car garage"
              rows={3}
              className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 px-3 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 transition placeholder:text-zinc-600 hidden-scrollbar"
            />

            <ConstraintsForm
              value={genParams}
              onChange={setGenParams}
              disabled={isBusy}
            />

            <button
              onClick={() => generateBlueprint(generatePrompt, genParams)}
              disabled={!generatePrompt.trim() || isBusy}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 text-sm font-medium transition shadow-sm font-mono tracking-wide"
            >
              {state === "generating" ? "GENERATING..." : "GENERATE BLUEPRINT"}
            </button>
          </div>

          {(state === "done" || state === "error") && (
            <button
              onClick={() => {
                resetForNewAnalysis();
                router.push("/analyze");
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-200 text-xs font-mono tracking-wide transition"
            >
              RUN NEW ANALYSIS
            </button>
          )}

          {(currentProjectId || data || messages.length > 0) && (
            <button
              onClick={() => {
                resetChatOnly();
                router.push("/analyze");
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-xs font-mono tracking-wide transition"
            >
              NEW CHAT
            </button>
          )}

          <p className="text-xs w-full flex text-center justify-center text-white/50">
            Analysis may take a few minutes. You can still use chat while it
            runs.
          </p>

          {state === "error" && (
            <div className="text-xs text-red-400 font-mono bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg space-y-1">
              <p>ERR: Analysis failed.</p>
              <p className="text-red-300/70 break-words">
                {analysisError || "No detailed server error was returned."}
              </p>
            </div>
          )}
        </div>

        <div
          className={`${
            mobilePane === "work" ? "flex" : "hidden"
          } lg:flex flex-1 min-h-0 p-4 sm:p-6 overflow-y-auto flex-col bg-zinc-900/10 hidden-scrollbar`}
        >
          <div className="flex gap-2 border-b border-zinc-800 pb-3 mb-6 flex-shrink-0 overflow-x-auto hidden-scrollbar">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-xs uppercase font-mono tracking-wider px-3 py-1.5 rounded-md transition flex-shrink-0 whitespace-nowrap ${
                  activeTab === tab
                    ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>

          {isProjectLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
              <p className="text-sm font-mono text-zinc-400">
                Loading saved project...
              </p>
            </div>
          ) : activeTab === "plan" ? (
            <div className="flex-1 min-h-0">
              <PlanView
                imageUrl={imageUrl}
                data={data}
                overlay={overlay}
                isBusy={isBusy}
                onSave={saveOverlay}
              />
            </div>
          ) : activeTab === "interior" ? (
            data ? (
              <InteriorPanel data={data} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 px-6 gap-2">
                <p className="text-sm font-mono text-zinc-400">No blueprint yet</p>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Generate or open a floor plan, then ask for interior design
                  ideas for any room.
                </p>
              </div>
            )
          ) : activeTab === "landscape" ? (
            <div className="flex-1 min-h-0">
              <LandscapePanel projectId={currentProjectId} />
            </div>
          ) : data ? (
            <div className="space-y-6 max-w-3xl">
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

              {activeTab === "rooms" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
                    Detected Spatial Zones
                  </h2>

                  {data.rooms && data.rooms.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                              {room.dimensionText
                                ? room.dimensionText
                                : room.estimatedSqft !== null &&
                                    room.estimatedSqft !== undefined
                                  ? `${room.estimatedSqft} sqft`
                                  : "Size uncertain"}
                            </span>
                          </div>
                          {room.estimatedSqft !== null &&
                            room.estimatedSqft !== undefined && (
                              <span className="text-[10px] font-mono text-zinc-600">
                                ≈ {room.estimatedSqft} sqft
                              </span>
                            )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-mono text-zinc-500 italic">
                      No isolated rooms detected.
                    </p>
                  )}
                </div>
              )}

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
                        {data.dimensions?.totalSqft ?? "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft²</span>
                      </span>
                    </div>

                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Width
                      </span>

                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.width ?? "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft</span>
                      </span>
                    </div>

                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Depth
                      </span>

                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.depth ?? "N/A"}{" "}
                        <span className="text-xs text-zinc-500">ft</span>
                      </span>
                    </div>

                    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Floors
                      </span>

                      <span className="text-lg text-zinc-200">
                        {data.dimensions?.floors || 1}
                      </span>
                    </div>
                  </div>

                  <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mt-6">
                    Key Architectural Notes
                  </h2>

                  {data.architecturalInsights?.length ? (
                    <ul className="space-y-2">
                      {data.architecturalInsights.map((insight, idx) => (
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
                  ) : (
                    <p className="text-sm font-mono text-zinc-500 italic">
                      No architectural notes extracted.
                    </p>
                  )}
                </div>
              )}

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
          ) : isBusy ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-60">
              <p className="text-sm font-mono text-zinc-300 animate-pulse">
                {state === "generating"
                  ? "Generating blueprint…"
                  : "Analyzing blueprint…"}
              </p>

              <p className="text-xs text-zinc-500 mt-1">
                This can take a moment. You can keep chatting while it runs.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
              <p className="text-sm font-mono text-zinc-400">
                Awaiting target system telemetry...
              </p>

              <p className="text-xs text-zinc-500 mt-1">
                Upload a schematic, or describe a building to generate one.
              </p>
            </div>
          )}
        </div>

        <div
          className={`${
            mobilePane === "chat" ? "flex" : "hidden"
          } lg:flex flex-1 min-h-0 border-l border-zinc-800 flex-col bg-zinc-900/30 overflow-hidden`}
        >
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/40 flex-shrink-0">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400 font-mono">
              Inference Telemetry Chat
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 hidden-scrollbar">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center p-6 text-zinc-500">
                <p className="text-xs leading-relaxed">
                  You can message the AI before, during, or after analysis.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-1 px-1">
                  {m.role}
                </span>

                <div
                  className={`p-3 rounded-xl max-w-[85%] text-sm leading-relaxed border ${
                    m.role === "user"
                      ? "bg-zinc-800 border-zinc-700 text-zinc-100 rounded-tr-none"
                      : "bg-zinc-900 border-zinc-800 text-zinc-300 rounded-tl-none"
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!isTyping && input.trim()) {
                    sendMessage();
                  }
                }
              }}
              placeholder={
                isBusy
                  ? "Working — you can still ask questions..."
                  : "Ask about the blueprint, or say 'create a blueprint for…'"
              }
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-3 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 transition font-sans placeholder:text-zinc-600"
            />

            <button
              onClick={sendMessage}
              disabled={!input.trim() || isTyping}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 border border-zinc-700 text-zinc-200 px-4 rounded-xl text-xs font-mono transition"
            >
              EXEC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="h-full bg-zinc-950 flex items-center justify-center font-mono text-zinc-500 text-sm">
          Loading Core Architecture...
        </div>
      }
    >
      <AnalyzeContent />
    </Suspense>
  );
}
