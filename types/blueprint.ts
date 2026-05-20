export interface Room {
  name: string;
  estimatedSqft?: number | null;
  floor?: number | null;
}

export interface BlueprintData {
  rooms: Room[];

  dimensions: {
    totalSqft?: number | null;
    width?: number | null;
    depth?: number | null;
    floors?: number | null;
  } | null;

  materials: string[];
  structuralElements: string[];
  annotations: string[];

  buildingType?: string | null;

  mainPurpose?: string | null;

  architecturalInsights?: string[];

  confidence?: "high" | "medium" | "low" | null;
}