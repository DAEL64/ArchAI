export type ConfidenceLevel = "low" | "medium" | "high";

export interface BlueprintRoom {
  name: string;
  dimensionText?: string | null;
  widthFeet?: number | null;
  depthFeet?: number | null;
  estimatedSqft: number | null;
  floor: number;
  /** semantic category, set when the room comes from the layout engine */
  type?: RoomType;
}

export interface BlueprintDimensions {
  totalSqft: number | null;
  width: number | null;
  depth: number | null;
  floors: number;
}

export interface BlueprintData {
  rooms: BlueprintRoom[];
  dimensions: BlueprintDimensions;
  materials: string[];
  structuralElements: string[];
  annotations: string[];
  buildingType: string;
  mainPurpose: string;
  architecturalInsights: string[];
  confidence: ConfidenceLevel;
  /**
   * Spatial layout produced by the deterministic layout engine
   * (lib/floorplan.ts) for AI-generated blueprints. Absent for blueprints
   * analyzed from an uploaded image (those render the source image instead).
   * Stored with the project — it is small vector JSON, never a flattened image.
   */
  floorPlan?: FloorPlanModel | null;
}

/* ------------------------------------------------------------------ */
/* Structured floor-plan layout model                                  */
/*                                                                     */
/* All geometry is expressed in FEET (architectural units). The Plan   */
/* View renderer scales feet → pixels for display. Keeping the model   */
/* in real units means a generated plan reads at true proportion and   */
/* survives re-rendering at any zoom / screen size.                    */
/* ------------------------------------------------------------------ */

export type RoomType =
  | "living"
  | "dining"
  | "kitchen"
  | "entry"
  | "family"
  | "bedroom"
  | "master"
  | "bathroom"
  | "closet"
  | "office"
  | "hallway"
  | "stair"
  | "lift"
  | "garage"
  | "utility"
  | "laundry"
  | "storage"
  | "balcony"
  | "other";

/** public = living/dining/kitchen/entry · private = bed/bath/closet/office ·
 *  service = utility/storage/garage/stair/lift · circulation = hallways. */
export type RoomZone = "public" | "private" | "service" | "circulation";

export interface PlanRoom {
  name: string;
  type: RoomType;
  zone: RoomZone;
  /** bottom-left-origin rectangle, in feet */
  x: number;
  y: number;
  width: number;
  height: number;
  /** names of rooms this one shares a doorway with */
  adjacentTo: string[];
}

export interface PlanDoor {
  id: string;
  /** centre of the opening, in feet */
  x: number;
  y: number;
  /** opening width, in feet */
  size: number;
  /** orientation of the wall the door sits in: "h" = horizontal wall
   *  (opening runs along x), "v" = vertical wall (opening runs along y) */
  dir: "h" | "v";
  kind: "interior" | "entry";
}

export interface PlanWindow {
  id: string;
  x: number;
  y: number;
  size: number;
  dir: "h" | "v";
}

export interface PlanWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  exterior: boolean;
}

export interface PlanFloor {
  level: number;
  rooms: PlanRoom[];
  doors: PlanDoor[];
  windows: PlanWindow[];
  walls: PlanWall[];
  annotations: string[];
}

export interface FloorPlanModel {
  version: 1;
  units: "feet";
  buildingFootprint: { width: number; height: number };
  floors: PlanFloor[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* ------------------------------------------------------------------ */
/* Blueprint edit overlay                                              */
/*                                                                     */
/* Edits are stored as lightweight vector JSON layered on top of the   */
/* original blueprint (image or generated floor plan). We never render */
/* or store a new flattened image — coordinates live in the base       */
/* image's / plan's intrinsic pixel space, so the overlay re-aligns at */
/* any zoom when the project is reopened.                              */
/* ------------------------------------------------------------------ */

export type OverlayTool =
  | "pan"
  | "pen"
  | "line"
  | "rect"
  | "arrow"
  | "text"
  | "eraser";

interface OverlayStroke {
  id: string;
  stroke: string;
  strokeWidth: number;
}

export interface OverlayLine extends OverlayStroke {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OverlayArrow extends OverlayStroke {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OverlayRect extends OverlayStroke {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayPath extends OverlayStroke {
  type: "path";
  /** flattened freehand points: [x0, y0, x1, y1, ...] */
  points: number[];
}

export interface OverlayText {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
}

export type OverlayElement =
  | OverlayLine
  | OverlayArrow
  | OverlayRect
  | OverlayPath
  | OverlayText;

export interface BlueprintOverlay {
  version: 1;
  /** intrinsic coordinate space the elements are drawn in */
  width: number;
  height: number;
  elements: OverlayElement[];
}

export interface SavedProject {
  id: string;
  clientSessionId?: string | null;
  name: string;
  createdAt: string;
  updatedAt?: string;
  imageUrl: string | null;
  data: BlueprintData | null;
  overlay?: BlueprintOverlay | null;
  messages: ChatMessage[];
}