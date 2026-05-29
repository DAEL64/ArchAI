import type { FloorPlanModel, RoomType } from "@/types/blueprint";
import type { PlanCutLine } from "@/types/drawing";

/**
 * Deterministic section/cut engine.
 *
 * A building section is the floor plan cut by a vertical plane along a line and
 * viewed side-on: the rooms the line passes through become bays stacked by
 * storey, with floor slabs and cut walls (poché). Like lib/elevation.ts, this
 * is derived geometrically from the FloorPlanModel — a real schematic section,
 * not a render. Pure / deterministic.
 */

export interface SectionCut {
  /** "h" = a horizontal cut line (constant y), section runs along x;
   *  "v" = a vertical cut line (constant x), section runs along y. */
  orientation: "h" | "v";
  /** position of the cut line (y for "h", x for "v"), in plan feet */
  pos: number;
  label: string;
}

export interface SectionBay {
  start: number;
  end: number;
  name: string;
  type: RoomType;
}

export interface SectionFloor {
  level: number;
  baseZ: number;
  height: number;
  bays: SectionBay[];
}

export interface SectionModel {
  label: string;
  orientation: "h" | "v";
  /** horizontal extent of the section, in feet */
  extent: number;
  totalHeight: number;
  floors: SectionFloor[];
  roof: { type: "flat" | "gable"; height: number };
}

const DEFAULT_CEILING = 9.5;

export function deriveSection(
  model: FloorPlanModel,
  cut: SectionCut,
  opts: { ceilingHeight?: number | null; roof?: "flat" | "gable" } = {},
): SectionModel {
  const W = model.buildingFootprint.width;
  const H = model.buildingFootprint.height;
  const extent = cut.orientation === "h" ? W : H;
  const ceiling =
    opts.ceilingHeight && opts.ceilingHeight > 6 ? opts.ceilingHeight : DEFAULT_CEILING;

  const sorted = [...model.floors].sort((a, b) => a.level - b.level);

  const floors: SectionFloor[] = sorted.map((floor, i) => {
    const bays: SectionBay[] = [];
    for (const r of floor.rooms) {
      const crosses =
        cut.orientation === "h"
          ? r.y <= cut.pos && cut.pos <= r.y + r.height
          : r.x <= cut.pos && cut.pos <= r.x + r.width;
      if (!crosses) continue;
      const start = cut.orientation === "h" ? r.x : r.y;
      const end = cut.orientation === "h" ? r.x + r.width : r.y + r.height;
      bays.push({ start, end, name: r.name, type: r.type });
    }
    bays.sort((a, b) => a.start - b.start);
    return { level: floor.level, baseZ: i * ceiling, height: ceiling, bays };
  });

  const storeyTop = floors.length * ceiling;
  const roofType: "flat" | "gable" =
    opts.roof ?? (Math.max(W, H) <= 55 && sorted.length <= 2 ? "gable" : "flat");
  const roofHeight = roofType === "gable" ? Math.min(8, Math.max(3, extent * 0.12)) : 1.2;

  return {
    label: cut.label,
    orientation: cut.orientation,
    extent,
    totalHeight: storeyTop + roofHeight,
    floors,
    roof: { type: roofType, height: roofHeight },
  };
}

/** A cut as a marker line in plan-feet space (for storage / drawing on plan). */
export function cutToPlanLine(
  model: FloorPlanModel,
  cut: SectionCut,
): PlanCutLine {
  const W = model.buildingFootprint.width;
  const H = model.buildingFootprint.height;
  if (cut.orientation === "h") {
    return {
      id: `cut-${cut.label}`,
      label: cut.label,
      x1: 0,
      y1: cut.pos,
      x2: W,
      y2: cut.pos,
      direction: "down",
      floorLevel: 1,
    };
  }
  return {
    id: `cut-${cut.label}`,
    label: cut.label,
    x1: cut.pos,
    y1: 0,
    x2: cut.pos,
    y2: H,
    direction: "right",
    floorLevel: 1,
  };
}

export function planLineToCut(line: PlanCutLine): SectionCut {
  const orientation: "h" | "v" =
    Math.abs(line.y2 - line.y1) < Math.abs(line.x2 - line.x1) ? "h" : "v";
  return {
    orientation,
    pos: orientation === "h" ? line.y1 : line.x1,
    label: line.label || "A-A",
  };
}
