import type { FloorPlanModel, PlanFloor } from "@/types/blueprint";

/**
 * Deterministic elevation (facade) engine.
 *
 * A small local LLM cannot draw a coherent facade, and there is no image model
 * in this stack — but an elevation is just an orthographic PROJECTION of the
 * floor plan onto a vertical plane. So we derive it geometrically from the
 * FloorPlanModel: building width/height by side, storeys stacked by ceiling
 * height, and the plan's exterior windows/doors projected to their position on
 * the wall. Pure + deterministic (no DOM/model), like lib/floorplan.ts.
 *
 * This is a real architectural line elevation, not a photoreal render (which
 * would need a future image backend).
 */

export type ElevationSide = "front" | "back" | "left" | "right";

export interface ElevationOpening {
  kind: "window" | "door";
  /** centre position along the horizontal axis, in feet */
  center: number;
  width: number;
  /** height of the sill above its floor level, in feet */
  sill: number;
  height: number;
}

export interface ElevationFloor {
  level: number;
  /** height of this storey's floor above grade, in feet */
  baseZ: number;
  height: number;
  openings: ElevationOpening[];
}

export interface ElevationRoof {
  type: "flat" | "gable";
  /** extra height above the top storey, in feet */
  height: number;
}

export interface ElevationModel {
  side: ElevationSide;
  /** horizontal extent of the elevation, in feet */
  width: number;
  /** total height grade→top of roof, in feet */
  totalHeight: number;
  floors: ElevationFloor[];
  roof: ElevationRoof;
}

export interface ElevationOptions {
  /** floor-to-floor height, feet (default 9.5) */
  ceilingHeight?: number | null;
  /** "gable" reads as a house, "flat" as a modern/commercial block */
  roof?: "flat" | "gable";
}

const DEFAULT_CEILING = 9.5;

function near(a: number, b: number, tol = 0.6): boolean {
  return Math.abs(a - b) < tol;
}

/** Windows + exterior (entry) doors that sit on the given elevation's wall,
 *  projected to a centre position along that elevation's horizontal axis. */
function openingsForSide(
  floor: PlanFloor,
  side: ElevationSide,
  W: number,
  H: number,
): { kind: "window" | "door"; center: number; width: number }[] {
  const out: { kind: "window" | "door"; center: number; width: number }[] = [];

  const place = (
    kind: "window" | "door",
    dir: "h" | "v",
    x: number,
    y: number,
    size: number,
  ) => {
    if (side === "front" && dir === "h" && near(y, 0)) out.push({ kind, center: x, width: size });
    else if (side === "back" && dir === "h" && near(y, H)) out.push({ kind, center: W - x, width: size });
    else if (side === "left" && dir === "v" && near(x, 0)) out.push({ kind, center: y, width: size });
    else if (side === "right" && dir === "v" && near(x, W)) out.push({ kind, center: H - y, width: size });
  };

  for (const w of floor.windows) place("window", w.dir, w.x, w.y, w.size);
  for (const d of floor.doors) {
    if (d.kind === "entry") place("door", d.dir, d.x, d.y, d.size);
  }
  return out;
}

export function deriveElevation(
  model: FloorPlanModel,
  side: ElevationSide,
  opts: ElevationOptions = {},
): ElevationModel {
  const W = model.buildingFootprint.width;
  const H = model.buildingFootprint.height;
  const horizontal = side === "front" || side === "back" ? W : H;

  const ceiling = opts.ceilingHeight && opts.ceilingHeight > 6 ? opts.ceilingHeight : DEFAULT_CEILING;

  const sorted = [...model.floors].sort((a, b) => a.level - b.level);
  const floors: ElevationFloor[] = sorted.map((floor, i) => {
    const openings = openingsForSide(floor, side, W, H).map((o) => {
      if (o.kind === "door") {
        return { ...o, sill: 0, height: Math.min(6.8, ceiling - 1.5) };
      }
      // window: a sensible sill + head within the storey
      const sill = 3;
      const height = Math.max(3, Math.min(4.5, ceiling - sill - 1.5));
      return { ...o, sill, height };
    });
    return {
      level: floor.level,
      baseZ: i * ceiling,
      height: ceiling,
      openings,
    };
  });

  const storeyTop = floors.length * ceiling;

  // Heuristic: a small footprint reads as a house (gable); a large/!given one
  // as a flat-roofed block. Caller can force via opts.roof.
  const roofType: "flat" | "gable" =
    opts.roof ?? (Math.max(W, H) <= 55 && sorted.length <= 2 ? "gable" : "flat");
  const roofHeight =
    roofType === "gable" ? Math.min(8, Math.max(3, horizontal * 0.12)) : 1.2;

  return {
    side,
    width: horizontal,
    totalHeight: storeyTop + roofHeight,
    floors,
    roof: { type: roofType, height: roofHeight },
  };
}

export const ELEVATION_SIDES: { key: ElevationSide; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "back", label: "Back" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];
