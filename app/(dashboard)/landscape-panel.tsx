"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BlueprintOverlay } from "@/types/blueprint";
import type { Drawing, LandscapeSuggestions } from "@/types/drawing";
import { drawingsApi } from "@/lib/api/drawings";
import { aiApi } from "@/lib/api/ai";
import { PlanView } from "./plan-view";

/*
 * Landscape Design mode. A terrain image is stored as its own Drawing row
 * (type "landscape", one original image + a lightweight vector annotation
 * overlay — disk-conscious, per the 30GB constraint). Annotation reuses the
 * proven PlanView. Automatic terrain analysis (slope/trees/water) is gated;
 * textual suggestions work now via the local LLM.
 */

const CATEGORIES: { key: keyof LandscapeSuggestions; label: string }[] = [
  { key: "zones", label: "Usable zones" },
  { key: "planting", label: "Planting" },
  { key: "pathways", label: "Pathways" },
  { key: "water", label: "Water / drainage" },
];

export function LandscapePanel({ projectId }: { projectId: string | null }) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [notes, setNotes] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<LandscapeSuggestions | null>(null);

  // Load any existing landscape study for this project.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setDrawing(null);
      return;
    }
    drawingsApi
      .listForProject(projectId)
      .then((ds) => {
        if (!cancelled) setDrawing(ds.find((d) => d.type === "landscape") ?? null);
      })
      .catch(() => {
        /* ignore — empty state shown */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleFile = (file: File) => {
    if (!projectId) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const url = e.target?.result as string;
      setUploading(true);
      setError(null);
      try {
        const d = await drawingsApi.create(projectId, {
          type: "landscape",
          source: "uploaded",
          name: file.name || "Terrain",
          imageUrl: url,
        });
        setDrawing(d);
      } catch {
        setError("Could not save the terrain image.");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveOverlay = useCallback(
    async (ov: BlueprintOverlay | null) => {
      if (!drawing) return;
      try {
        const updated = await drawingsApi.update(drawing.id, { overlayData: ov });
        setDrawing(updated);
      } catch {
        /* keep local overlay; surfaced elsewhere if it matters */
      }
    },
    [drawing],
  );

  const runSuggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const r = await aiApi.suggestLandscape({ notes: notes || undefined });
      setSuggestions(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate suggestions.");
    } finally {
      setSuggesting(false);
    }
  };

  if (!projectId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center opacity-60 px-6 gap-2">
        <p className="text-sm font-mono text-zinc-400">No project yet</p>
        <p className="text-xs text-zinc-500 max-w-xs">
          Generate a blueprint, open a project, or start a chat first — then add a
          landscape study to it.
        </p>
      </div>
    );
  }

  const field =
    "w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-2.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 transition placeholder:text-zinc-600";

  return (
    <div className="flex flex-col h-full min-h-0 gap-4 overflow-hidden">
      <div className="flex-shrink-0">
        <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-1">
          Landscape Design
        </h2>
        <p className="text-[11px] text-amber-300/70 leading-relaxed">
          Automatic terrain analysis (slope, trees, water) is experimental and not
          enabled with the local model yet — upload a site image, annotate it
          manually, and use the suggestions below.
        </p>
      </div>

      {drawing?.imageUrl ? (
        <div className="flex-1 min-h-0">
          <PlanView
            imageUrl={drawing.imageUrl}
            data={null}
            overlay={drawing.overlayData ?? null}
            isBusy={false}
            onSave={saveOverlay}
          />
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onDragOver={(e) => e.preventDefault()}
          className="flex-1 min-h-[200px] border-2 border-dashed border-zinc-800 hover:border-zinc-700 transition rounded-xl flex flex-col items-center justify-center gap-2 bg-zinc-900/40 cursor-pointer text-center p-6"
        >
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
            ↑
          </div>
          <p className="text-xs font-medium text-zinc-400">
            {uploading ? "Saving…" : "Upload a terrain / site image"}
          </p>
          <p className="text-[10px] text-zinc-500">PNG, JPG · stored once, annotations stay lightweight</p>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      <div className="flex-shrink-0 flex flex-col gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Site notes: slope direction, sun, access, existing trees…"
          className={field}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={runSuggest}
            disabled={suggesting}
            className="py-2 px-4 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 text-xs font-mono font-medium tracking-wide transition"
          >
            {suggesting ? "THINKING…" : "GET LANDSCAPE SUGGESTIONS"}
          </button>
          {drawing?.imageUrl && (
            <span className="text-[10px] font-mono text-zinc-600">
              {drawing.overlayData?.elements?.length
                ? `${drawing.overlayData.elements.length} annotations`
                : "annotate with Edit"}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 text-xs text-red-400 font-mono bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg">
          {error}
        </div>
      )}

      {suggestions && (
        <div className="flex-shrink-0 max-h-[42%] overflow-y-auto hidden-scrollbar border-t border-zinc-800 pt-3 space-y-3">
          {suggestions.summary && (
            <p className="text-sm text-zinc-300 leading-relaxed border-l-2 border-emerald-500/40 pl-3">
              {suggestions.summary}
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {CATEGORIES.map(({ key, label }) => {
              const items = suggestions[key] as string[];
              if (!items || items.length === 0) return null;
              return (
                <div key={key} className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80">
                  <h3 className="text-[10px] font-semibold tracking-wider uppercase text-emerald-400/70 font-mono mb-2">
                    {label}
                  </h3>
                  <ul className="space-y-1.5">
                    {items.map((it, i) => (
                      <li key={i} className="text-xs text-zinc-300 leading-relaxed flex gap-2">
                        <span className="text-zinc-600">·</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
