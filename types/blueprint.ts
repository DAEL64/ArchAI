export type ConfidenceLevel = "low" | "medium" | "high";

export interface BlueprintRoom {
  name: string;
  dimensionText?: string | null;
  widthFeet?: number | null;
  depthFeet?: number | null;
  estimatedSqft: number | null;
  floor: number;
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