"use client";

import { useState } from "react";
import type { GenerationParams } from "@/types/drawing";

/*
 * Optional structured constraints for generation (req #9). Collapsed by default
 * — the freeform prompt stays primary and the app never forces these (req #8).
 * Only the fields relevant to floor-plan generation are shown; other modes can
 * pass a different field set later.
 */

const NUM_FIELDS: { key: keyof GenerationParams; label: string }[] = [
  { key: "floors", label: "Floors" },
  { key: "roomCount", label: "Rooms" },
  { key: "totalArea", label: "Area ft²" },
  { key: "buildingWidth", label: "Width ft" },
  { key: "buildingDepth", label: "Depth ft" },
  { key: "ceilingHeight", label: "Ceiling ft" },
];

const TEXT_FIELDS: {
  key: keyof GenerationParams;
  label: string;
  placeholder: string;
  list?: boolean;
}[] = [
  { key: "projectType", label: "Project type", placeholder: "House, apartment, office…" },
  { key: "style", label: "Style", placeholder: "Modern, minimalist…" },
  { key: "requiredRooms", label: "Required rooms", placeholder: "kitchen, 2 baths, office", list: true },
  { key: "materials", label: "Materials", placeholder: "concrete, timber, glass", list: true },
  { key: "structuralSystem", label: "Structure", placeholder: "Load-bearing, steel frame" },
  { key: "roomDimensions", label: "Specific room sizes", placeholder: "master 14×16, kitchen 12×10" },
  { key: "accessibility", label: "Accessibility", placeholder: "Step-free, wide doors…" },
  { key: "notes", label: "Notes", placeholder: "Anything else the AI should respect" },
];

/** True if any constraint field is set — drives the "(N set)" hint. */
export function countParams(p: GenerationParams): number {
  return Object.values(p).filter((v) => {
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
}

export function ConstraintsForm({
  value,
  onChange,
  disabled,
}: {
  value: GenerationParams;
  onChange: (next: GenerationParams) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const setField = (key: keyof GenerationParams, v: unknown) =>
    onChange({ ...value, [key]: v });

  const count = countParams(value);
  const inputCls =
    "w-full bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2 text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-700 transition placeholder:text-zinc-600 disabled:opacity-50";

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition"
      >
        <span>
          Constraints{" "}
          <span className="text-zinc-600 normal-case tracking-normal">
            (optional{count ? `, ${count} set` : ""})
          </span>
        </span>
        <span className="text-zinc-500">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          <div className="grid grid-cols-3 gap-2">
            {NUM_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                  {f.label}
                </span>
                <input
                  type="number"
                  min={0}
                  disabled={disabled}
                  value={
                    value[f.key] === null || value[f.key] === undefined
                      ? ""
                      : String(value[f.key])
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    setField(f.key, raw === "" ? null : Number(raw));
                  }}
                  className={inputCls}
                />
              </label>
            ))}
          </div>

          {TEXT_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                {f.label}
              </span>
              <input
                type="text"
                disabled={disabled}
                placeholder={f.placeholder}
                value={
                  Array.isArray(value[f.key])
                    ? (value[f.key] as string[]).join(", ")
                    : ((value[f.key] as string | undefined) ?? "")
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (f.list) {
                    const arr = raw
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    setField(f.key, arr);
                  } else {
                    setField(f.key, raw);
                  }
                }}
                className={inputCls}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
