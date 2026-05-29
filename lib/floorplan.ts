import type {
  BlueprintRoom,
  FloorPlanModel,
  PlanDoor,
  PlanFloor,
  PlanRoom,
  PlanWall,
  PlanWindow,
  RoomType,
  RoomZone,
} from "@/types/blueprint";

/**
 * Deterministic architectural layout engine.
 *
 * A small local LLM cannot reliably emit geometrically valid coordinates
 * (non-overlapping, inside the footprint, properly zoned). So generation is
 * split in two:
 *
 *   1. The model produces the SEMANTIC program — a room list with rough sizes
 *      (handled in /api/generate).
 *   2. This module produces the GEOMETRY — footprint, zoned placement,
 *      circulation, doors and windows — using deterministic rules.
 *
 * The result is a `FloorPlanModel` in real feet. It is pure (no DOM, no
 * randomness, no Node APIs) so it runs identically on the server route and as
 * a client-side fallback in the Plan View.
 */

/* ------------------------------------------------------------------ */
/* room taxonomy                                                       */
/* ------------------------------------------------------------------ */

const TYPE_RULES: [RegExp, RoomType][] = [
  [/master|primary|main\s+bed/i, "master"],
  [/bed\s?room|bedroom|guest\s*room|\bbed\b|nursery/i, "bedroom"],
  [/bath|wc|toilet|powder|ensuite|en-suite|restroom|washroom|shower/i, "bathroom"],
  [/kitchen|kitchenette/i, "kitchen"],
  [/din(?:e|ing)|breakfast/i, "dining"],
  [/living|lounge|great\s*room|sitting|drawing\s*room/i, "living"],
  [/family|den|rec\s*room|media/i, "family"],
  [/foyer|entry|entrance|vestibule|mud\s*room|porch|lobby/i, "entry"],
  [/hall|corridor|passage|landing/i, "hallway"],
  [/stair|stairwell|staircase|stairway/i, "stair"],
  [/lift|elevator/i, "lift"],
  [/garage|carport/i, "garage"],
  [/laundry/i, "laundry"],
  [/util|mechanical|boiler|plant|electrical|hvac/i, "utility"],
  [/closet|wardrobe|w\.?i\.?c|walk-?in|dressing/i, "closet"],
  [/office|study|work\s*room|library/i, "office"],
  [/store|storage|pantry|cellar|attic/i, "storage"],
  [/balcony|terrace|deck|patio|veranda|verandah/i, "balcony"],
];

export function inferRoomType(name: string): RoomType {
  for (const [re, type] of TYPE_RULES) {
    if (re.test(name)) return type;
  }
  return "other";
}

export function zoneForType(type: RoomType): RoomZone {
  switch (type) {
    case "living":
    case "dining":
    case "kitchen":
    case "entry":
    case "family":
    case "balcony":
      return "public";
    case "bedroom":
    case "master":
    case "bathroom":
    case "closet":
    case "office":
      return "private";
    case "hallway":
      return "circulation";
    default:
      return "service"; // stair, lift, garage, utility, laundry, storage, other
  }
}

/** target area in sqft when a size is not supplied by the model */
const DEFAULT_AREA: Record<RoomType, number> = {
  living: 260,
  family: 200,
  dining: 150,
  kitchen: 140,
  entry: 60,
  master: 210,
  bedroom: 140,
  bathroom: 50,
  closet: 36,
  office: 120,
  hallway: 70,
  stair: 90,
  lift: 28,
  garage: 240,
  utility: 60,
  laundry: 60,
  storage: 50,
  balcony: 70,
  other: 120,
};

/** plausible [min, max] sqft per type, used to tame wild model numbers */
const AREA_BOUNDS: Record<RoomType, [number, number]> = {
  living: [140, 420],
  family: [120, 360],
  dining: [80, 260],
  kitchen: [70, 260],
  entry: [30, 120],
  master: [150, 360],
  bedroom: [90, 240],
  bathroom: [28, 90],
  closet: [16, 70],
  office: [80, 220],
  hallway: [30, 180],
  stair: [50, 140],
  lift: [16, 45],
  garage: [200, 520],
  utility: [30, 110],
  laundry: [30, 110],
  storage: [20, 120],
  balcony: [30, 140],
  other: [60, 240],
};

/* ------------------------------------------------------------------ */
/* program derivation (semantic → typed, count-corrected, zoned)       */
/* ------------------------------------------------------------------ */

interface ProgramRoom {
  name: string;
  type: RoomType;
  zone: RoomZone;
  area: number; // relative weight / target sqft
  floor: number;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  single: 1,
  double: 2,
};

function parseCount(prompt: string, re: RegExp): number | null {
  const m = prompt.match(re);
  if (!m) return null;
  const token = m[1].toLowerCase();
  if (NUMBER_WORDS[token] != null) return NUMBER_WORDS[token];
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

function clampArea(type: RoomType, area: number | null): number {
  const [min, max] = AREA_BOUNDS[type];
  if (area == null || !Number.isFinite(area) || area <= 0) {
    return DEFAULT_AREA[type];
  }
  return Math.min(max, Math.max(min, area));
}

function bedroomLabel(index: number): string {
  return index === 1 ? "Bedroom" : `Bedroom ${index}`;
}

/**
 * Turns a (possibly thin or incomplete) model room list + the user's prompt
 * into a complete, typed building program. Enforces explicit counts the user
 * asked for and backfills the essentials of a dwelling when the model under-
 * delivers — which the small chat model frequently does.
 */
export function deriveProgram(
  prompt: string,
  rooms: BlueprintRoom[],
  buildingType = "",
): ProgramRoom[] {
  const text = `${prompt} ${buildingType}`.toLowerCase();

  const nonResidential =
    /\b(office|retail|shop|store\b|cafe|café|restaurant|clinic|warehouse|gym|salon|workshop)\b/.test(
      text,
    ) && !/\b(house|home|apartment|flat|villa|bungalow|duplex|cabin)\b/.test(text);

  const isStudio = /\bstudio\b/.test(text);

  // Seed from whatever the model returned.
  const seed: ProgramRoom[] = rooms.map((r) => {
    const type = inferRoomType(r.name);
    const rawArea =
      r.widthFeet && r.depthFeet
        ? r.widthFeet * r.depthFeet
        : r.estimatedSqft ?? null;
    return {
      name: r.name.trim() || "Room",
      type,
      zone: zoneForType(type),
      area: clampArea(type, rawArea),
      floor: Math.max(1, Math.floor(r.floor || 1)),
    };
  });

  // The engine owns circulation, so drop any model-provided hallways; a
  // corridor is synthesised during layout where it is actually needed.
  let program = seed.filter((r) => r.type !== "hallway");

  const countOf = (...types: RoomType[]) =>
    program.filter((r) => types.includes(r.type)).length;

  /* -- bedrooms ---------------------------------------------------- */
  const wantBeds = parseCount(
    prompt,
    /(\d+|one|two|three|four|five|six|seven|eight)\s*[-\s]?\s*(?:bed\b|bedroom|bedrooms|br\b|bhk\b)/i,
  );
  const haveBeds = countOf("bedroom", "master");

  if (!nonResidential) {
    if (wantBeds != null) {
      if (haveBeds < wantBeds) {
        for (let i = haveBeds; i < wantBeds; i++) {
          program.push({
            name: bedroomLabel(i + 1),
            type: "bedroom",
            zone: "private",
            area: DEFAULT_AREA.bedroom,
            floor: 1,
          });
        }
      } else if (haveBeds > wantBeds) {
        // trim surplus bedrooms (keep the first ones)
        let surplus = haveBeds - wantBeds;
        program = program.filter((r) => {
          if (surplus > 0 && (r.type === "bedroom" || r.type === "master")) {
            surplus--;
            return false;
          }
          return true;
        });
      }
    } else if (haveBeds === 0 && !isStudio) {
      // vague residential request → sensible default
      const def = 2;
      for (let i = 0; i < def; i++) {
        program.push({
          name: bedroomLabel(i + 1),
          type: "bedroom",
          zone: "private",
          area: DEFAULT_AREA.bedroom,
          floor: 1,
        });
      }
    }
  }

  /* -- promote a master when there are several bedrooms ------------ */
  const beds = program.filter((r) => r.type === "bedroom");
  if (beds.length >= 2 && countOf("master") === 0) {
    const first = beds[0];
    first.type = "master";
    first.name = /master|primary/i.test(first.name)
      ? first.name
      : "Master Bedroom";
    first.area = Math.max(first.area, DEFAULT_AREA.master);
  }

  /* -- bathrooms --------------------------------------------------- */
  const wantBaths = parseCount(
    prompt,
    /(\d+(?:\.5)?|one|two|three|four)\s*[-\s]?\s*(?:bath|bathroom|bathrooms|ba\b|wc\b|toilet)/i,
  );
  if (!nonResidential) {
    const bedTotal = program.filter(
      (r) => r.type === "bedroom" || r.type === "master",
    ).length;
    const required = Math.max(
      Math.ceil(wantBaths ?? 0),
      1,
      bedTotal >= 3 ? 2 : 1,
    );
    let haveBaths = countOf("bathroom");
    while (haveBaths < required) {
      haveBaths++;
      program.push({
        name: haveBaths === 1 ? "Bathroom" : `Bathroom ${haveBaths}`,
        type: "bathroom",
        zone: "private",
        area: DEFAULT_AREA.bathroom,
        floor: 1,
      });
    }
  }

  /* -- kitchen / living essentials --------------------------------- */
  if (!nonResidential) {
    if (countOf("kitchen") === 0) {
      program.push({
        name: "Kitchen",
        type: "kitchen",
        zone: "public",
        area: DEFAULT_AREA.kitchen,
        floor: 1,
      });
    }
    if (countOf("living", "family") === 0) {
      program.push({
        name: isStudio ? "Living / Sleeping" : "Living Room",
        type: "living",
        zone: "public",
        area: DEFAULT_AREA.living,
        floor: 1,
      });
    }
  }

  /* -- garage ------------------------------------------------------ */
  const cars = parseCount(
    prompt,
    /(\d+|one|two|three)\s*[-\s]?\s*car\b/i,
  );
  if (cars != null && countOf("garage") === 0) {
    program.push({
      name: cars >= 2 ? `${cars}-Car Garage` : "Garage",
      type: "garage",
      zone: "service",
      area: clampArea("garage", cars * 220),
      floor: 1,
    });
  }

  /* -- floors / stairs --------------------------------------------- */
  const wantFloors =
    parseCount(
      prompt,
      /(\d+|one|two|three|four|single|double)\s*[-\s]?\s*(?:floor|floors|storey|storeys|story|stories|level|levels)/i,
    ) ?? (/\btwo-?story|two-?storey|double-?storey\b/i.test(text) ? 2 : null);

  const floors = Math.max(
    1,
    Math.min(4, wantFloors ?? Math.max(...program.map((r) => r.floor), 1)),
  );

  if (floors > 1) {
    distributeAcrossFloors(program, floors);
    // a staircase on every floor for vertical circulation
    for (let lvl = 1; lvl <= floors; lvl++) {
      if (!program.some((r) => r.type === "stair" && r.floor === lvl)) {
        program.push({
          name: floors > 1 ? `Stairs (L${lvl})` : "Stairs",
          type: "stair",
          zone: "service",
          area: DEFAULT_AREA.stair,
          floor: lvl,
        });
      }
    }
  }

  // Final guard: never return an empty program.
  if (program.length === 0) {
    program.push(
      { name: "Living Room", type: "living", zone: "public", area: DEFAULT_AREA.living, floor: 1 },
      { name: "Kitchen", type: "kitchen", zone: "public", area: DEFAULT_AREA.kitchen, floor: 1 },
      { name: "Bedroom", type: "bedroom", zone: "private", area: DEFAULT_AREA.bedroom, floor: 1 },
      { name: "Bathroom", type: "bathroom", zone: "private", area: DEFAULT_AREA.bathroom, floor: 1 },
    );
  }

  return program;
}

/** Push private sleeping rooms onto upper floors so a multi-storey request
 *  reads correctly (public + service stay on the ground floor). */
function distributeAcrossFloors(program: ProgramRoom[], floors: number) {
  const allOnGround = program.every((r) => r.floor <= 1);
  if (!allOnGround) return; // model already assigned floors — respect it

  const upper = program.filter(
    (r) => r.type === "bedroom" || r.type === "master" || r.type === "closet",
  );
  if (upper.length === 0) return;

  // keep one bathroom downstairs (powder room); move the rest up with beds
  const movableBaths = program.filter((r) => r.type === "bathroom").slice(1);

  const movers = [...upper, ...movableBaths];
  let lvl = 2;
  for (const r of movers) {
    r.floor = lvl;
    lvl = lvl >= floors ? 2 : lvl + 1;
  }
}

/* ------------------------------------------------------------------ */
/* geometry primitives                                                 */
/* ------------------------------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 0.05;
const CORRIDOR_W = 3.5;

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < EPS;
}

/**
 * Guillotine "slice-and-dice" subdivision: recursively cut a rectangle into
 * one rectangle per item, always cutting the longer side and balancing area
 * across the cut. This is what keeps rooms well-proportioned (no slivers, no
 * row-of-blocks) while exactly filling the rectangle with no overlaps.
 */
function sliceRooms<T extends { area: number; name: string }>(
  rect: Rect,
  items: T[],
): { item: T; rect: Rect }[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ item: items[0], rect }];

  const sorted = [...items].sort(
    (a, b) => b.area - a.area || a.name.localeCompare(b.name),
  );
  const total = sorted.reduce((s, r) => s + r.area, 0) || 1;

  const groupA: T[] = [];
  let sumA = 0;
  for (const it of sorted) {
    if (sumA < total / 2 || groupA.length === 0) {
      groupA.push(it);
      sumA += it.area;
    } else {
      break;
    }
  }
  const groupB = sorted.filter((it) => !groupA.includes(it));
  if (groupB.length === 0) {
    // all area landed in A (one dominant item) — peel the smallest into B
    groupB.push(groupA.pop()!);
    sumA = groupA.reduce((s, r) => s + r.area, 0);
  }

  // clamp the split fraction so a tiny room can't become a sliver
  const frac = Math.min(0.8, Math.max(0.2, sumA / total));

  let rectA: Rect;
  let rectB: Rect;
  if (rect.w >= rect.h) {
    const wA = rect.w * frac;
    rectA = { x: rect.x, y: rect.y, w: wA, h: rect.h };
    rectB = { x: rect.x + wA, y: rect.y, w: rect.w - wA, h: rect.h };
  } else {
    const hA = rect.h * frac;
    rectA = { x: rect.x, y: rect.y, w: rect.w, h: hA };
    rectB = { x: rect.x, y: rect.y + hA, w: rect.w, h: rect.h - hA };
  }

  return [...sliceRooms(rectA, groupA), ...sliceRooms(rectB, groupB)];
}

interface Wall {
  dir: "h" | "v";
  /** position of the wall line (x for vertical, y for horizontal) */
  at: number;
  /** centre of the shared span */
  center: number;
  /** length of the shared span */
  length: number;
}

/** If two room rectangles share a portion of a wall, describe it. */
function sharedWall(a: Rect, b: Rect): Wall | null {
  // vertical wall (a|b side by side)
  if (nearlyEqual(a.x + a.w, b.x) || nearlyEqual(b.x + b.w, a.x)) {
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    if (hi - lo > 1) {
      const at = nearlyEqual(a.x + a.w, b.x) ? a.x + a.w : b.x + b.w;
      return { dir: "v", at, center: (lo + hi) / 2, length: hi - lo };
    }
  }
  // horizontal wall (a above/below b)
  if (nearlyEqual(a.y + a.h, b.y) || nearlyEqual(b.y + b.h, a.y)) {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo > 1) {
      const at = nearlyEqual(a.y + a.h, b.y) ? a.y + a.h : b.y + b.h;
      return { dir: "h", at, center: (lo + hi) / 2, length: hi - lo };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* per-floor layout                                                    */
/* ------------------------------------------------------------------ */

function nameSuggestsEnsuite(name: string) {
  return /ensuite|en-suite|attached|master|primary|private/i.test(name);
}

/**
 * Door-graph weighting. A minimum-spanning-tree over these weights yields a
 * realistic circulation diagram: bathrooms and bedrooms open onto the hallway,
 * closets tuck into bedrooms, public rooms interconnect — and bedrooms never
 * route through one another or through a shared bathroom.
 */
function doorWeight(a: PlanRoom, b: PlanRoom): number {
  const hall = a.type === "hallway" || b.type === "hallway";
  const bath =
    (a.type === "bathroom" ? a : b.type === "bathroom" ? b : null) ?? null;
  const otherOfBath = a.type === "bathroom" ? b : a;
  const closet =
    (a.type === "closet" ? a : b.type === "closet" ? b : null) ?? null;
  const otherOfCloset = a.type === "closet" ? b : a;

  let w: number;
  if (hall) w = 1;
  else if (a.zone === "public" && b.zone === "public") w = 2;
  else if (
    (a.zone === "public" && b.zone === "service") ||
    (a.zone === "service" && b.zone === "public") ||
    (a.zone === "service" && b.zone === "service")
  )
    w = 3;
  else if (
    (a.zone === "public" && b.zone === "private") ||
    (a.zone === "private" && b.zone === "public")
  )
    w = 4;
  else if (a.zone === "private" && b.zone === "private") w = 28;
  else w = 6;

  // bathrooms strongly prefer a hallway; an ensuite off a bedroom is allowed
  if (bath && !hall) {
    const ensuite =
      nameSuggestsEnsuite(bath.name) &&
      (otherOfBath.type === "bedroom" || otherOfBath.type === "master");
    w += ensuite ? 1 : 24;
    if (otherOfBath.type === "bathroom") w += 40;
  }

  // closets want to sit inside a bedroom
  if (closet) {
    if (otherOfCloset.type === "bedroom" || otherOfCloset.type === "master") {
      w = Math.min(w, 1.5);
    } else {
      w += 8;
    }
  }

  return w;
}

function layoutFloor(
  foot: { width: number; height: number },
  program: ProgramRoom[],
  level: number,
): PlanFloor {
  const W = foot.width;
  const H = foot.height;
  const mainHoriz = W >= H;

  const placed: PlanRoom[] = [];

  const toPlan = (
    item: ProgramRoom,
    rect: Rect,
    zoneOverride?: RoomZone,
  ): PlanRoom => ({
    name: item.name,
    type: item.type,
    zone: zoneOverride ?? item.zone,
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    adjacentTo: [],
  });

  const publicRooms = program.filter((r) => r.zone === "public");
  const serviceRooms = program.filter((r) => r.zone === "service");
  const privateRooms = program.filter((r) => r.zone === "private");

  const zoneArea = (rs: ProgramRoom[]) => rs.reduce((s, r) => s + r.area, 0);
  const blocks: { rooms: ProgramRoom[]; kind: RoomZone }[] = [
    { rooms: publicRooms, kind: "public" },
    { rooms: serviceRooms, kind: "service" },
    { rooms: privateRooms, kind: "private" },
  ];
  const order = blocks.filter((b) => b.rooms.length > 0);

  const totalArea = order.reduce((s, b) => s + zoneArea(b.rooms), 0) || 1;

  let cursor = 0; // position along the main axis, in feet
  const span = mainHoriz ? W : H;

  order.forEach((block, idx) => {
    const isLast = idx === order.length - 1;
    const frac = zoneArea(block.rooms) / totalArea;
    const extent = isLast ? span - cursor : span * frac;

    const blockRect: Rect = mainHoriz
      ? { x: cursor, y: 0, w: extent, h: H }
      : { x: 0, y: cursor, w: W, h: extent };
    cursor += extent;

    if (block.kind === "private" && block.rooms.length >= 3) {
      placed.push(...carveCorridor(blockRect, block.rooms, mainHoriz, toPlan));
    } else {
      for (const { item, rect } of sliceRooms(blockRect, block.rooms)) {
        placed.push(toPlan(item, rect));
      }
    }
  });

  /* doors via weighted MST so every room is reachable from the entry ---- */
  const doors = buildDoors(placed, { width: W, height: H }, mainHoriz, level);

  /* windows on exterior walls of habitable rooms ----------------------- */
  const windows = buildWindows(placed, { width: W, height: H }, doors, level);

  /* wall segments (exterior outline + deduped interior partitions) ------ */
  const walls = buildWalls(placed, { width: W, height: H });

  const annotations: string[] = [
    `Footprint ${fmtFt(W)} × ${fmtFt(H)}`,
    `${placed.length} spaces · entry on the ${mainHoriz ? "left" : "top"} elevation`,
  ];

  return { level, rooms: placed, doors, windows, walls, annotations };
}

/** Double-loaded corridor: a hallway down the middle of the private block
 *  with rooms flanking both sides, every room opening onto it. */
function carveCorridor(
  rect: Rect,
  rooms: ProgramRoom[],
  mainHoriz: boolean,
  toPlan: (item: ProgramRoom, rect: Rect, zone?: RoomZone) => PlanRoom,
): PlanRoom[] {
  // not enough depth for a corridor + rooms on both sides → just slice
  const crossDepth = mainHoriz ? rect.h : rect.w;
  if (crossDepth < CORRIDOR_W * 2 + 12) {
    return sliceRooms(rect, rooms).map(({ item, rect: r }) => toPlan(item, r));
  }

  // split rooms into two balanced groups for the two sides
  const sorted = [...rooms].sort(
    (a, b) => b.area - a.area || a.name.localeCompare(b.name),
  );
  const sideA: ProgramRoom[] = [];
  const sideB: ProgramRoom[] = [];
  let aArea = 0;
  let bArea = 0;
  for (const r of sorted) {
    if (aArea <= bArea) {
      sideA.push(r);
      aArea += r.area;
    } else {
      sideB.push(r);
      bArea += r.area;
    }
  }

  const corridorName = "Hallway";
  const out: PlanRoom[] = [];

  if (mainHoriz) {
    // corridor runs horizontally across the strip, centred vertically
    const cy = rect.y + (rect.h - CORRIDOR_W) / 2;
    const topRect: Rect = { x: rect.x, y: rect.y, w: rect.w, h: cy - rect.y };
    const botRect: Rect = {
      x: rect.x,
      y: cy + CORRIDOR_W,
      w: rect.w,
      h: rect.y + rect.h - (cy + CORRIDOR_W),
    };
    const corridorRect: Rect = { x: rect.x, y: cy, w: rect.w, h: CORRIDOR_W };

    for (const { item, rect: r } of sliceRooms(topRect, sideA)) out.push(toPlan(item, r));
    for (const { item, rect: r } of sliceRooms(botRect, sideB)) out.push(toPlan(item, r));
    out.push({
      name: corridorName,
      type: "hallway",
      zone: "circulation",
      x: corridorRect.x,
      y: corridorRect.y,
      width: corridorRect.w,
      height: corridorRect.h,
      adjacentTo: [],
    });
  } else {
    // corridor runs vertically down the strip, centred horizontally
    const cx = rect.x + (rect.w - CORRIDOR_W) / 2;
    const leftRect: Rect = { x: rect.x, y: rect.y, w: cx - rect.x, h: rect.h };
    const rightRect: Rect = {
      x: cx + CORRIDOR_W,
      y: rect.y,
      w: rect.x + rect.w - (cx + CORRIDOR_W),
      h: rect.h,
    };
    const corridorRect: Rect = { x: cx, y: rect.y, w: CORRIDOR_W, h: rect.h };

    for (const { item, rect: r } of sliceRooms(leftRect, sideA)) out.push(toPlan(item, r));
    for (const { item, rect: r } of sliceRooms(rightRect, sideB)) out.push(toPlan(item, r));
    out.push({
      name: corridorName,
      type: "hallway",
      zone: "circulation",
      x: corridorRect.x,
      y: corridorRect.y,
      width: corridorRect.w,
      height: corridorRect.h,
      adjacentTo: [],
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* doors                                                               */
/* ------------------------------------------------------------------ */

function buildDoors(
  rooms: PlanRoom[],
  foot: { width: number; height: number },
  mainHoriz: boolean,
  level: number,
): PlanDoor[] {
  const doors: PlanDoor[] = [];
  const n = rooms.length;
  if (n === 0) return doors;

  // adjacency edges
  const edges: { i: number; j: number; wall: Wall; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const wall = sharedWall(rect(rooms[i]), rect(rooms[j]));
      if (wall) edges.push({ i, j, wall, w: doorWeight(rooms[i], rooms[j]) });
    }
  }

  // root the spanning tree at the entry, else living, else first room
  let root = rooms.findIndex((r) => r.type === "entry");
  if (root < 0) root = rooms.findIndex((r) => r.type === "living");
  if (root < 0) root = 0;

  // Prim's MST (n is small)
  const inTree = new Array(n).fill(false);
  inTree[root] = true;
  let count = 1;
  let doorIdx = 0;

  while (count < n) {
    let best: { i: number; j: number; wall: Wall; w: number } | null = null;
    for (const e of edges) {
      const a = inTree[e.i];
      const b = inTree[e.j];
      if (a === b) continue; // both in or both out
      if (!best || e.w < best.w) best = e;
    }
    if (!best) {
      // disconnected remainder (shouldn't happen for a tiling) — absorb a node
      const orphan = inTree.indexOf(false);
      if (orphan < 0) break;
      inTree[orphan] = true;
      count++;
      continue;
    }

    const newNode = inTree[best.i] ? best.j : best.i;
    inTree[newNode] = true;
    count++;

    const size = Math.min(3, Math.max(2.2, best.wall.length * 0.7));
    doors.push(doorFromWall(best.wall, size, "interior", level, doorIdx++));

    rooms[best.i].adjacentTo.push(rooms[best.j].name);
    rooms[best.j].adjacentTo.push(rooms[best.i].name);
  }

  // exterior entry door on the front elevation
  const entry = entryRoom(rooms);
  if (entry) {
    const front = frontExteriorWall(entry, foot, mainHoriz);
    if (front) {
      doors.push(doorFromWall(front, 3.2, "entry", level, doorIdx++));
    }
  }

  return doors;
}

function rect(r: PlanRoom): Rect {
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function doorFromWall(
  wall: Wall,
  size: number,
  kind: "interior" | "entry",
  level: number,
  idx: number,
): PlanDoor {
  if (wall.dir === "v") {
    return {
      id: `d-${level}-${idx}`,
      x: wall.at,
      y: wall.center,
      size,
      dir: "v",
      kind,
    };
  }
  return {
    id: `d-${level}-${idx}`,
    x: wall.center,
    y: wall.at,
    size,
    dir: "h",
    kind,
  };
}

function entryRoom(rooms: PlanRoom[]): PlanRoom | null {
  return (
    rooms.find((r) => r.type === "entry") ??
    rooms.find((r) => r.type === "living") ??
    rooms.find((r) => r.zone === "public") ??
    rooms[0] ??
    null
  );
}

/** the room's wall lying on the building's front elevation (or nearest) */
function frontExteriorWall(
  room: PlanRoom,
  foot: { width: number; height: number },
  mainHoriz: boolean,
): Wall | null {
  if (mainHoriz) {
    // front = left elevation (x = 0)
    if (nearlyEqual(room.x, 0)) {
      return { dir: "v", at: 0, center: room.y + room.height / 2, length: room.height };
    }
    // else any vertical exterior wall it owns
    if (nearlyEqual(room.x + room.width, foot.width)) {
      return {
        dir: "v",
        at: foot.width,
        center: room.y + room.height / 2,
        length: room.height,
      };
    }
  } else {
    // front = top elevation (y = 0)
    if (nearlyEqual(room.y, 0)) {
      return { dir: "h", at: 0, center: room.x + room.width / 2, length: room.width };
    }
    if (nearlyEqual(room.y + room.height, foot.height)) {
      return {
        dir: "h",
        at: foot.height,
        center: room.x + room.width / 2,
        length: room.width,
      };
    }
  }
  // fall back to whichever wall touches any boundary
  if (nearlyEqual(room.x, 0))
    return { dir: "v", at: 0, center: room.y + room.height / 2, length: room.height };
  if (nearlyEqual(room.y, 0))
    return { dir: "h", at: 0, center: room.x + room.width / 2, length: room.width };
  return null;
}

/* ------------------------------------------------------------------ */
/* windows                                                             */
/* ------------------------------------------------------------------ */

const HABITABLE: RoomType[] = [
  "living",
  "dining",
  "kitchen",
  "family",
  "bedroom",
  "master",
  "office",
];

function buildWindows(
  rooms: PlanRoom[],
  foot: { width: number; height: number },
  doors: PlanDoor[],
  level: number,
): PlanWindow[] {
  const windows: PlanWindow[] = [];
  let idx = 0;

  const conflictsWithDoor = (w: PlanWindow) =>
    doors.some(
      (d) =>
        d.dir === w.dir &&
        ((w.dir === "v" && nearlyEqual(d.x, w.x) && Math.abs(d.y - w.y) < (d.size + w.size) / 2 + 1) ||
          (w.dir === "h" && nearlyEqual(d.y, w.y) && Math.abs(d.x - w.x) < (d.size + w.size) / 2 + 1)),
    );

  for (const r of rooms) {
    const habitable = HABITABLE.includes(r.type);
    const small = r.type === "bathroom" || r.type === "laundry";
    if (!habitable && !small) continue;

    const candidates: PlanWindow[] = [];
    // left / right (vertical walls)
    if (nearlyEqual(r.x, 0))
      candidates.push(makeWindow("v", 0, r.y + r.height / 2, r.height, small, level, idx++));
    if (nearlyEqual(r.x + r.width, foot.width))
      candidates.push(makeWindow("v", foot.width, r.y + r.height / 2, r.height, small, level, idx++));
    // top / bottom (horizontal walls)
    if (nearlyEqual(r.y, 0))
      candidates.push(makeWindow("h", r.x + r.width / 2, 0, r.width, small, level, idx++));
    if (nearlyEqual(r.y + r.height, foot.height))
      candidates.push(makeWindow("h", r.x + r.width / 2, foot.height, r.width, small, level, idx++));

    for (const c of candidates) {
      if (!conflictsWithDoor(c)) windows.push(c);
      // habitable rooms get at most 2 windows; small rooms at most 1
      if (windows.filter((w) => roomOwnsWindow(r, w)).length >= (small ? 1 : 2)) break;
    }
  }

  return windows;
}

function roomOwnsWindow(r: PlanRoom, w: PlanWindow) {
  if (w.dir === "v") {
    return (
      (nearlyEqual(w.x, r.x) || nearlyEqual(w.x, r.x + r.width)) &&
      w.y > r.y - EPS &&
      w.y < r.y + r.height + EPS
    );
  }
  return (
    (nearlyEqual(w.y, r.y) || nearlyEqual(w.y, r.y + r.height)) &&
    w.x > r.x - EPS &&
    w.x < r.x + r.width + EPS
  );
}

function makeWindow(
  dir: "h" | "v",
  x: number,
  y: number,
  wallLen: number,
  small: boolean,
  level: number,
  idx: number,
): PlanWindow {
  const size = small
    ? Math.min(2.5, wallLen * 0.5)
    : Math.min(6, Math.max(2.5, wallLen * 0.42));
  return { id: `w-${level}-${idx}`, x, y, size, dir };
}

/* ------------------------------------------------------------------ */
/* walls                                                               */
/* ------------------------------------------------------------------ */

function buildWalls(
  rooms: PlanRoom[],
  foot: { width: number; height: number },
): PlanWall[] {
  const walls: PlanWall[] = [
    { x1: 0, y1: 0, x2: foot.width, y2: 0, exterior: true },
    { x1: foot.width, y1: 0, x2: foot.width, y2: foot.height, exterior: true },
    { x1: foot.width, y1: foot.height, x2: 0, y2: foot.height, exterior: true },
    { x1: 0, y1: foot.height, x2: 0, y2: 0, exterior: true },
  ];

  const seen = new Set<string>();
  const key = (x1: number, y1: number, x2: number, y2: number) =>
    `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)}`;

  const onBoundary = (x1: number, y1: number, x2: number, y2: number) => {
    if (nearlyEqual(x1, x2) && (nearlyEqual(x1, 0) || nearlyEqual(x1, foot.width)))
      return true;
    if (nearlyEqual(y1, y2) && (nearlyEqual(y1, 0) || nearlyEqual(y1, foot.height)))
      return true;
    return false;
  };

  const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
    if (onBoundary(x1, y1, x2, y2)) return;
    // normalise direction for dedup
    const [ax, ay, bx, by] =
      x1 < x2 || (nearlyEqual(x1, x2) && y1 < y2)
        ? [x1, y1, x2, y2]
        : [x2, y2, x1, y1];
    const k = key(ax, ay, bx, by);
    if (seen.has(k)) return;
    seen.add(k);
    walls.push({ x1: ax, y1: ay, x2: bx, y2: by, exterior: false });
  };

  for (const r of rooms) {
    addSeg(r.x, r.y, r.x + r.width, r.y);
    addSeg(r.x + r.width, r.y, r.x + r.width, r.y + r.height);
    addSeg(r.x + r.width, r.y + r.height, r.x, r.y + r.height);
    addSeg(r.x, r.y + r.height, r.x, r.y);
  }

  return walls;
}

/* ------------------------------------------------------------------ */
/* footprint + assembly                                                */
/* ------------------------------------------------------------------ */

const EFFICIENCY = 0.82; // habitable area / gross (walls + circulation)
const ASPECT = 1.35;

function fmtFt(feet: number): string {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  return inches === 0 ? `${whole}'-0"` : `${whole}'-${inches}"`;
}

export interface BuildOptions {
  footprintWidth?: number | null;
  footprintHeight?: number | null;
  floors?: number | null;
}

export function buildFloorPlanModel(
  program: ProgramRoom[],
  opts: BuildOptions = {},
): FloorPlanModel {
  const levels = Array.from(
    new Set(program.map((r) => Math.max(1, Math.floor(r.floor || 1)))),
  ).sort((a, b) => a - b);
  const floorLevels = levels.length ? levels : [1];

  // footprint must hold the busiest floor
  const areaByLevel = (lvl: number) =>
    program
      .filter((r) => (r.floor || 1) === lvl)
      .reduce((s, r) => s + r.area, 0);
  const grossArea =
    Math.max(...floorLevels.map(areaByLevel), 1) / EFFICIENCY;

  let W: number;
  let H: number;
  const givenW = opts.footprintWidth ?? null;
  const givenH = opts.footprintHeight ?? null;

  if (givenW && givenW > 8 && givenH && givenH > 8) {
    W = givenW;
    H = givenH;
  } else if (givenW && givenW > 8) {
    W = givenW;
    H = Math.max(12, grossArea / W);
  } else if (givenH && givenH > 8) {
    H = givenH;
    W = Math.max(12, grossArea / H);
  } else {
    W = Math.sqrt(grossArea * ASPECT);
    H = grossArea / W;
  }

  W = Math.round(Math.min(220, Math.max(16, W)));
  H = Math.round(Math.min(220, Math.max(14, H)));

  const floors: PlanFloor[] = floorLevels.map((lvl) =>
    layoutFloor(
      { width: W, height: H },
      program.filter((r) => (r.floor || 1) === lvl),
      lvl,
    ),
  );

  return {
    version: 1,
    units: "feet",
    buildingFootprint: { width: W, height: H },
    floors,
  };
}

/**
 * Rebuilds the flat room list (used by the Rooms/Dimensions tabs) from the
 * placed plan, so the panels and the drawing always agree on sizes.
 */
export function roomsFromModel(model: FloorPlanModel): BlueprintRoom[] {
  const out: BlueprintRoom[] = [];
  for (const floor of model.floors) {
    for (const r of floor.rooms) {
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      out.push({
        name: r.name,
        type: r.type,
        dimensionText: `${w}' × ${h}'`,
        widthFeet: w,
        depthFeet: h,
        estimatedSqft: Math.round(r.width * r.height),
        floor: floor.level,
      });
    }
  }
  return out;
}

/**
 * Convenience for the client fallback: build a plan straight from a flat room
 * list (e.g. an older generated project that has no stored floorPlan).
 */
export function floorPlanFromRooms(
  rooms: BlueprintRoom[],
  dimensions?: { width?: number | null; depth?: number | null; floors?: number | null },
  prompt = "",
  buildingType = "",
): FloorPlanModel {
  const program = deriveProgram(prompt, rooms, buildingType);
  return buildFloorPlanModel(program, {
    footprintWidth: dimensions?.width ?? null,
    footprintHeight: dimensions?.depth ?? null,
    floors: dimensions?.floors ?? null,
  });
}
