"use client";

import { useState } from "react";
import type { BlueprintData } from "@/types/blueprint";
import type { InteriorSuggestions } from "@/types/drawing";
import { aiApi } from "@/lib/api/ai";

/*
 * Interior Design mode. Textual suggestions only — the local models can reason
 * about a room but cannot render it (no image engine). Suggestions are never
 * forced: nothing happens until the user asks (req #7/#8).
 */

const CATEGORIES: { key: keyof InteriorSuggestions; label: string }[] = [
  { key: "furniture", label: "Furniture" },
  { key: "lighting", label: "Lighting" },
  { key: "materials", label: "Materials" },
  { key: "storage", label: "Storage" },
  { key: "circulation", label: "Circulation" },
];

export function InteriorPanel({ data }: { data: BlueprintData }) {
  const rooms = data.rooms ?? [];
  const [room, setRoom] = useState(rooms[0]?.name ?? "");
  const [style, setStyle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InteriorSuggestions | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await aiApi.suggestInterior({
        buildingType: data.buildingType,
        room: room || undefined,
        style: style || undefined,
        notes: notes || undefined,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate suggestions.");
    } finally {
      setLoading(false);
    }
  };

  const field =
    "w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-2.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 transition placeholder:text-zinc-600";

  return (
    <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono mb-1">
          Interior Design
        </h2>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Ask for interior ideas for a room. Suggestions are advisory — the
          design stays yours.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">Room</span>
          {rooms.length > 0 ? (
            <select value={room} onChange={(e) => setRoom(e.target.value)} className={field}>
              {rooms.map((r, i) => (
                <option key={`${r.name}-${i}`} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Living Room" className={field} />
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">Style (optional)</span>
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Modern, Japandi, industrial…" className={field} />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Constraints, must-haves, mood…" className={field} />
      </label>

      <button
        onClick={run}
        disabled={loading}
        className="py-2.5 px-5 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 text-sm font-medium transition font-mono tracking-wide"
      >
        {loading ? "THINKING…" : "GET SUGGESTIONS"}
      </button>

      {error && (
        <div className="text-xs text-red-400 font-mono bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.summary && (
            <p className="text-sm text-zinc-300 leading-relaxed border-l-2 border-emerald-500/40 pl-3">
              {result.summary}
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {CATEGORIES.map(({ key, label }) => {
              const items = result[key] as string[];
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
