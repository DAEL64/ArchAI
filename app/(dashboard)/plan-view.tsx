"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BlueprintData,
  BlueprintOverlay,
  FloorPlanModel,
  OverlayElement,
  OverlayTool,
  PlanFloor,
  RoomZone,
} from "@/types/blueprint";
import { floorPlanFromRooms } from "@/lib/floorplan";

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function newId() {
  return crypto.randomUUID();
}

function pointsToPath(points: number[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) {
    d += ` L ${points[i]} ${points[i + 1]}`;
  }
  return d;
}

/** Polygon points for an arrowhead pointing at (x2,y2). */
function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = 8 + strokeWidth * 2.5;
  const spread = Math.PI / 7;
  const ax = x2 - len * Math.cos(angle - spread);
  const ay = y2 - len * Math.sin(angle - spread);
  const bx = x2 - len * Math.cos(angle + spread);
  const by = y2 - len * Math.sin(angle + spread);
  return `${x2},${y2} ${ax},${ay} ${bx},${by}`;
}

/* ------------------------------------------------------------------ */
/* base layers: uploaded image natural size + generated floor plan     */
/* ------------------------------------------------------------------ */

function useImageNaturalSize(url: string | null) {
  // Keyed by url so a stale measurement is never returned for a new image,
  // and so state is only set from the async load callbacks (no synchronous
  // setState inside the effect body).
  const [measured, setMeasured] = useState<{
    url: string;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    const img = new Image();
    const done = (w: number, h: number) => {
      if (!cancelled) setMeasured({ url, w, h });
    };
    img.onload = () => done(img.naturalWidth || 1, img.naturalHeight || 1);
    // If the image can't decode, fall back to a sane canvas size rather than
    // hanging on "loading" forever.
    img.onerror = () => done(1000, 700);
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || !measured || measured.url !== url) return null;
  return { w: measured.w, h: measured.h };
}

/* ------------------------------------------------------------------ */
/* generated floor-plan renderer                                       */
/*                                                                     */
/* Draws the structured FloorPlanModel (lib/floorplan.ts) as a clean   */
/* architectural plan: light walls on the dark ArchitectAI field, with */
/* door swings, window glazing, room labels, overall dimensions and a  */
/* faint construction grid. Geometry is in feet; we scale to pixels.   */
/* ------------------------------------------------------------------ */

const ZONE_FILL: Record<RoomZone, string> = {
  public: "rgba(78,205,196,0.08)",
  private: "rgba(168,139,250,0.08)",
  service: "rgba(251,191,36,0.07)",
  circulation: "rgba(228,228,231,0.05)",
};

const PLAN_BG = "#0a0d0f";
const WALL = "#e5e7eb";
const PARTITION = "#9ca3af";
const GLASS = "#4ecdc4";
const DOOR_C = "#a1a1aa";
const DIM_C = "#52525b";

interface PlanBase {
  width: number;
  height: number;
  content: React.ReactNode;
}

function ftLabel(feet: number): string {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  return inches === 0 ? `${whole}'` : `${whole}'${inches}"`;
}

function near(a: number, b: number) {
  return Math.abs(a - b) < 0.1;
}

/** quarter-circle door swing arc points + the open leaf endpoints */
function doorSwing(
  cx: number,
  cy: number,
  L: number,
  dir: "h" | "v",
  sign: number,
) {
  const r = L;
  let hx: number;
  let hy: number;
  let open: number;
  let closed: number;
  if (dir === "v") {
    hx = cx;
    hy = cy - L / 2;
    open = sign > 0 ? 0 : Math.PI;
    closed = Math.PI / 2;
  } else {
    hx = cx - L / 2;
    hy = cy;
    open = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    closed = 0;
  }
  const steps = 8;
  const arc: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = open + ((closed - open) * i) / steps;
    arc.push(
      `${(hx + r * Math.cos(a)).toFixed(1)},${(hy + r * Math.sin(a)).toFixed(1)}`,
    );
  }
  return {
    hx,
    hy,
    tipX: hx + r * Math.cos(open),
    tipY: hy + r * Math.sin(open),
    arc: arc.join(" "),
  };
}

/** Renders one floor of a FloorPlanModel into a sized SVG group. */
function renderFloorPlan(
  floor: PlanFloor,
  foot: { width: number; height: number },
): PlanBase {
  const MARGIN = 54;
  const ppf = clamp(960 / Math.max(foot.width, foot.height, 1), 7, 18);
  const innerW = foot.width * ppf;
  const innerH = foot.height * ppf;
  const baseW = innerW + MARGIN * 2;
  const baseH = innerH + MARGIN * 2;

  const px = (fx: number) => MARGIN + fx * ppf;
  const py = (fy: number) => MARGIN + fy * ppf;
  const ln = (f: number) => f * ppf;

  /* faint construction grid (5 ft) */
  const grid: React.ReactNode[] = [];
  for (let gx = 0; gx <= foot.width + 0.001; gx += 5) {
    grid.push(
      <line
        key={`gx-${gx}`}
        x1={px(gx)}
        y1={py(0)}
        x2={px(gx)}
        y2={py(foot.height)}
        stroke="#ffffff"
        strokeOpacity={0.04}
        strokeWidth={1}
      />,
    );
  }
  for (let gy = 0; gy <= foot.height + 0.001; gy += 5) {
    grid.push(
      <line
        key={`gy-${gy}`}
        x1={px(0)}
        y1={py(gy)}
        x2={px(foot.width)}
        y2={py(gy)}
        stroke="#ffffff"
        strokeOpacity={0.04}
        strokeWidth={1}
      />,
    );
  }

  /* rooms: zone-tinted fill + partition stroke + labels */
  const roomNodes = floor.rooms.map((r, i) => {
    const x = px(r.x);
    const y = py(r.y);
    const w = ln(r.width);
    const h = ln(r.height);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const small = Math.min(w, h);
    const font = clamp(small * 0.18, 8, 13);
    const showName = w > 34 && h > 18;
    const showDim = h > 46 && w > 52 && r.type !== "hallway";
    const maxChars = Math.max(3, Math.floor(w / (font * 0.58)));
    const label =
      r.name.length > maxChars ? `${r.name.slice(0, maxChars - 1)}…` : r.name;

    return (
      <g key={`room-${i}`}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={ZONE_FILL[r.zone]}
          stroke={PARTITION}
          strokeWidth={2}
        />
        {showName && (
          <text
            x={cx}
            y={showDim ? cy - 2 : cy + font * 0.35}
            textAnchor="middle"
            fontSize={font}
            fill="#e4e4e7"
            fontFamily="ui-monospace, monospace"
          >
            {label}
          </text>
        )}
        {showDim && (
          <text
            x={cx}
            y={cy + font + 2}
            textAnchor="middle"
            fontSize={Math.max(8, font - 2)}
            fill="#71717a"
            fontFamily="ui-monospace, monospace"
          >
            {ftLabel(r.width)} × {ftLabel(r.height)}
          </text>
        )}
      </g>
    );
  });

  /* exterior shell (heavy wall) */
  const shell = (
    <rect
      x={px(0)}
      y={py(0)}
      width={innerW}
      height={innerH}
      fill="none"
      stroke={WALL}
      strokeWidth={5}
    />
  );

  /* windows: cut the wall, draw double-line glazing */
  const windowNodes = floor.windows.map((win) => {
    const cx = px(win.x);
    const cy = py(win.y);
    const L = ln(win.size);
    if (win.dir === "v") {
      return (
        <g key={win.id}>
          <rect x={cx - 3} y={cy - L / 2} width={6} height={L} fill={PLAN_BG} />
          <line x1={cx - 1.3} y1={cy - L / 2} x2={cx - 1.3} y2={cy + L / 2} stroke={GLASS} strokeWidth={1.4} />
          <line x1={cx + 1.3} y1={cy - L / 2} x2={cx + 1.3} y2={cy + L / 2} stroke={GLASS} strokeWidth={1.4} />
        </g>
      );
    }
    return (
      <g key={win.id}>
        <rect x={cx - L / 2} y={cy - 3} width={L} height={6} fill={PLAN_BG} />
        <line x1={cx - L / 2} y1={cy - 1.3} x2={cx + L / 2} y2={cy - 1.3} stroke={GLASS} strokeWidth={1.4} />
        <line x1={cx - L / 2} y1={cy + 1.3} x2={cx + L / 2} y2={cy + 1.3} stroke={GLASS} strokeWidth={1.4} />
      </g>
    );
  });

  /* doors: cut the wall, draw swing arc + leaf */
  const doorNodes = floor.doors.map((d) => {
    const cx = px(d.x);
    const cy = py(d.y);
    const L = ln(d.size);
    const sign =
      d.dir === "v"
        ? near(d.x, foot.width)
          ? -1
          : 1
        : near(d.y, foot.height)
          ? -1
          : 1;

    const color = d.kind === "entry" ? GLASS : DOOR_C;
    const swing = doorSwing(cx, cy, L, d.dir, sign);
    const cut =
      d.dir === "v" ? (
        <rect x={cx - 3.5} y={cy - L / 2} width={7} height={L} fill={PLAN_BG} />
      ) : (
        <rect x={cx - L / 2} y={cy - 3.5} width={L} height={7} fill={PLAN_BG} />
      );

    return (
      <g key={d.id}>
        {cut}
        <polyline points={swing.arc} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.7} />
        <line
          x1={swing.hx}
          y1={swing.hy}
          x2={swing.tipX}
          y2={swing.tipY}
          stroke={color}
          strokeWidth={d.kind === "entry" ? 2 : 1.5}
        />
      </g>
    );
  });

  /* overall footprint dimension lines */
  const dims = (
    <g fontFamily="ui-monospace, monospace" fill={DIM_C} stroke={DIM_C}>
      <line x1={px(0)} y1={py(foot.height) + 24} x2={px(foot.width)} y2={py(foot.height) + 24} strokeWidth={1} />
      <line x1={px(0)} y1={py(foot.height) + 20} x2={px(0)} y2={py(foot.height) + 28} strokeWidth={1} />
      <line x1={px(foot.width)} y1={py(foot.height) + 20} x2={px(foot.width)} y2={py(foot.height) + 28} strokeWidth={1} />
      <text x={px(foot.width / 2)} y={py(foot.height) + 38} textAnchor="middle" fontSize={11} stroke="none">
        {ftLabel(foot.width)}
      </text>
      <line x1={px(0) - 24} y1={py(0)} x2={px(0) - 24} y2={py(foot.height)} strokeWidth={1} />
      <line x1={px(0) - 28} y1={py(0)} x2={px(0) - 20} y2={py(0)} strokeWidth={1} />
      <line x1={px(0) - 28} y1={py(foot.height)} x2={px(0) - 20} y2={py(foot.height)} strokeWidth={1} />
      <text
        x={px(0) - 34}
        y={py(foot.height / 2)}
        textAnchor="middle"
        fontSize={11}
        stroke="none"
        transform={`rotate(-90 ${px(0) - 34} ${py(foot.height / 2)})`}
      >
        {ftLabel(foot.height)}
      </text>
    </g>
  );

  const content = (
    <g style={{ pointerEvents: "none" }}>
      <rect x={0} y={0} width={baseW} height={baseH} fill={PLAN_BG} />
      <text
        x={MARGIN}
        y={26}
        fontSize={11}
        fill="#52525b"
        fontFamily="ui-monospace, monospace"
        letterSpacing={1}
      >
        FLOOR {floor.level}
      </text>
      {grid}
      {roomNodes}
      {shell}
      {windowNodes}
      {doorNodes}
      {dims}
    </g>
  );

  return { width: baseW, height: baseH, content };
}

/* ------------------------------------------------------------------ */
/* overlay element rendering (shared by preview + editor)              */
/* ------------------------------------------------------------------ */

function OverlayShape({ el }: { el: OverlayElement }) {
  switch (el.type) {
    case "line":
      return (
        <line
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
        />
      );
    case "arrow":
      return (
        <g>
          <line
            x1={el.x1}
            y1={el.y1}
            x2={el.x2}
            y2={el.y2}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
          />
          <polygon
            points={arrowHead(el.x1, el.y1, el.x2, el.y2, el.strokeWidth)}
            fill={el.stroke}
          />
        </g>
      );
    case "rect":
      return (
        <rect
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          fill="none"
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
        />
      );
    case "path":
      return (
        <path
          d={pointsToPath(el.points)}
          fill="none"
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "text":
      return (
        <text
          x={el.x}
          y={el.y}
          fontSize={el.fontSize}
          fill={el.fill}
          fontFamily="ui-monospace, monospace"
          style={{ paintOrder: "stroke" }}
          stroke="#0a0d0f"
          strokeWidth={el.fontSize / 6}
        >
          {el.text}
        </text>
      );
  }
}

/** Wide transparent hit target so thin strokes are easy to erase. */
function EraseHit({
  el,
  onErase,
}: {
  el: OverlayElement;
  onErase: (id: string) => void;
}) {
  const handle = (e: React.PointerEvent) => {
    e.stopPropagation();
    onErase(el.id);
  };
  const common = {
    onPointerDown: handle,
    style: { cursor: "pointer" as const },
  };
  const HIT = "transparent";

  switch (el.type) {
    case "line":
    case "arrow":
      return (
        <line
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          stroke={HIT}
          strokeWidth={Math.max(el.strokeWidth + 14, 18)}
          strokeLinecap="round"
          {...common}
        />
      );
    case "rect":
      return (
        <rect
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          fill={HIT}
          stroke={HIT}
          strokeWidth={Math.max(el.strokeWidth + 14, 18)}
          {...common}
        />
      );
    case "path":
      return (
        <path
          d={pointsToPath(el.points)}
          fill="none"
          stroke={HIT}
          strokeWidth={Math.max(el.strokeWidth + 14, 18)}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...common}
        />
      );
    case "text":
      return (
        <rect
          x={el.x - 4}
          y={el.y - el.fontSize}
          width={Math.max(el.text.length * el.fontSize * 0.62, 16)}
          height={el.fontSize * 1.5}
          fill={HIT}
          {...common}
        />
      );
  }
}

function OverlayLayer({ elements }: { elements: OverlayElement[] }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {elements.map((el) => (
        <OverlayShape key={el.id} el={el} />
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* editor                                                              */
/* ------------------------------------------------------------------ */

const COLORS = ["#4ecdc4", "#f87171", "#fbbf24", "#a78bfa", "#ffffff"];
const WIDTHS = [2, 4, 8];

const TOOLS: { key: OverlayTool; label: string }[] = [
  { key: "pan", label: "Pan" },
  { key: "pen", label: "Pen" },
  { key: "line", label: "Line" },
  { key: "rect", label: "Rect" },
  { key: "arrow", label: "Arrow" },
  { key: "text", label: "Text" },
  { key: "eraser", label: "Erase" },
];

function BlueprintEditor({
  baseWidth,
  baseHeight,
  baseContent,
  initialElements,
  onSave,
  onCancel,
}: {
  baseWidth: number;
  baseHeight: number;
  baseContent: React.ReactNode;
  initialElements: OverlayElement[];
  onSave: (elements: OverlayElement[]) => void;
  onCancel: () => void;
}) {
  const [elements, setElements] = useState<OverlayElement[]>(initialElements);
  const [tool, setTool] = useState<OverlayTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [textValue, setTextValue] = useState("Label");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState<OverlayElement | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drawingRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const undoStackRef = useRef<OverlayElement[][]>([]);
  // mirror of the live view so the (once-attached) native wheel handler can
  // zoom toward the cursor without being re-bound on every change.
  const viewRef = useRef({ zoom, pan });
  useEffect(() => {
    viewRef.current = { zoom, pan };
  }, [zoom, pan]);

  // Multi-touch tracking. A second finger switches the gesture to pinch-zoom
  // (and discards any in-progress stroke) so the plan can be zoomed by touch,
  // not just the scroll wheel.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef<number | null>(null);

  /** Zoom by `factor` keeping the container-local point (cx,cy) fixed. */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const { zoom: z, pan: p } = viewRef.current;
    const nz = clamp(z * factor, 0.1, 10);
    setPan({
      x: cx - (cx - p.x) * (nz / z),
      y: cy - (cy - p.y) * (nz / z),
    });
    setZoom(nz);
  }, []);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale =
      Math.min(rect.width / baseWidth, rect.height / baseHeight) * 0.94 || 1;
    setZoom(scale);
    setPan({
      x: (rect.width - baseWidth * scale) / 2,
      y: (rect.height - baseHeight * scale) / 2,
    });
  }, [baseWidth, baseHeight]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Non-passive wheel listener so we can preventDefault (zoom, not page-scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { zoom: z, pan: p } = viewRef.current;
      const nz = clamp(z * (e.deltaY < 0 ? 1.1 : 0.9), 0.1, 10);
      setPan({
        x: cx - (cx - p.x) * (nz / z),
        y: cy - (cy - p.y) * (nz / z),
      });
      setZoom(nz);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const nz = clamp(zoom * factor, 0.1, 10);
    setPan({
      x: cx - (cx - pan.x) * (nz / zoom),
      y: cy - (cy - pan.y) * (nz / zoom),
    });
    setZoom(nz);
  };

  const toLocal = (clientX: number, clientY: number) => {
    const g = gRef.current;
    if (!g) return { x: 0, y: 0 };
    const ctm = g.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  const commitElements = (next: OverlayElement[]) => {
    undoStackRef.current.push(elements);
    setElements(next);
  };

  const eraseElement = (id: string) => {
    undoStackRef.current.push(elements);
    setElements((prev) => prev.filter((el) => el.id !== id));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Second finger down → pinch-zoom. Abandon any active stroke/pan.
    if (pointersRef.current.size >= 2) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = false;
      panStartRef.current = null;
      setDraft(null);
      const [a, b] = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }

    // Eraser is handled by per-element hit targets.
    if (tool === "eraser") return;

    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toLocal(e.clientX, e.clientY);

    if (tool === "pan") {
      drawingRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      return;
    }

    if (tool === "text") {
      const text = textValue.trim();
      if (!text) return;
      commitElements([
        ...elements,
        {
          id: newId(),
          type: "text",
          x,
          y,
          text,
          fontSize: clamp(strokeWidth * 5, 14, 48),
          fill: color,
        },
      ]);
      return;
    }

    drawingRef.current = true;
    const id = newId();

    if (tool === "pen") {
      setDraft({ id, type: "path", points: [x, y], stroke: color, strokeWidth });
    } else if (tool === "line") {
      setDraft({ id, type: "line", x1: x, y1: y, x2: x, y2: y, stroke: color, strokeWidth });
    } else if (tool === "arrow") {
      setDraft({ id, type: "arrow", x1: x, y1: y, x2: x, y2: y, stroke: color, strokeWidth });
    } else if (tool === "rect") {
      setDraft({ id, type: "rect", x, y, width: 0, height: 0, stroke: color, strokeWidth });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Pinch-zoom: when two fingers are down, scale around their midpoint.
    if (pointersRef.current.has(e.pointerId) && pointersRef.current.size >= 2) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (dist > 0 && pinchDistRef.current && pinchDistRef.current > 0) {
        const rect = containerRef.current?.getBoundingClientRect();
        const mx = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const my = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);
        zoomAt(dist / pinchDistRef.current, mx, my);
      }
      pinchDistRef.current = dist;
      return;
    }

    if (!drawingRef.current) return;

    if (tool === "pan" && panStartRef.current) {
      const s = panStartRef.current;
      setPan({ x: s.px + (e.clientX - s.x), y: s.py + (e.clientY - s.y) });
      return;
    }

    const { x, y } = toLocal(e.clientX, e.clientY);
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.type === "path") return { ...prev, points: [...prev.points, x, y] };
      if (prev.type === "line" || prev.type === "arrow") {
        return { ...prev, x2: x, y2: y };
      }
      if (prev.type === "rect") {
        return { ...prev, width: x - prev.x, height: y - prev.y };
      }
      return prev;
    });
  };

  const handlePointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (e) pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchDistRef.current = null;

    // While ≥1 finger remains after a pinch, stay idle (don't resume drawing
    // with the leftover finger) until it lifts too.
    if (pointersRef.current.size >= 1) return;

    drawingRef.current = false;
    panStartRef.current = null;

    if (!draft) return;

    let finalized: OverlayElement | null = draft;

    if (draft.type === "rect") {
      const rect = {
        ...draft,
        x: Math.min(draft.x, draft.x + draft.width),
        y: Math.min(draft.y, draft.y + draft.height),
        width: Math.abs(draft.width),
        height: Math.abs(draft.height),
      };
      finalized = rect.width < 3 && rect.height < 3 ? null : rect;
    } else if (draft.type === "line" || draft.type === "arrow") {
      const dist = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
      finalized = dist < 3 ? null : draft;
    } else if (draft.type === "path") {
      finalized = draft.points.length < 4 ? null : draft;
    }

    setDraft(null);
    if (finalized) commitElements([...elements, finalized]);
  };

  const undo = () => {
    const prev = undoStackRef.current.pop();
    if (prev) setElements(prev);
  };

  const clearAll = () => {
    if (elements.length === 0) return;
    undoStackRef.current.push(elements);
    setElements([]);
  };

  const cursor =
    tool === "pan"
      ? "grab"
      : tool === "text"
        ? "text"
        : tool === "eraser"
          ? "pointer"
          : "crosshair";

  const toolBtn = (active: boolean) =>
    `px-2.5 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider border transition ${
      active
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : "text-zinc-400 hover:text-zinc-200 border-zinc-800 hover:border-zinc-700"
    }`;

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            className={toolBtn(tool === t.key)}
          >
            {t.label}
          </button>
        ))}

        <span className="w-px h-5 bg-zinc-800 mx-1" />

        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`color ${c}`}
            className={`w-5 h-5 rounded-full border transition ${
              color === c ? "border-white scale-110" : "border-zinc-700"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}

        <span className="w-px h-5 bg-zinc-800 mx-1" />

        {WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => setStrokeWidth(w)}
            className={toolBtn(strokeWidth === w)}
          >
            {w}px
          </button>
        ))}

        {tool === "text" && (
          <input
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder="Label text"
            className="bg-zinc-950 border border-zinc-800 rounded-md py-1 px-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 w-32"
          />
        )}

        <span className="w-px h-5 bg-zinc-800 mx-1" />

        <button onClick={undo} className={toolBtn(false)}>
          Undo
        </button>
        <button onClick={clearAll} className={toolBtn(false)}>
          Clear
        </button>
      </div>

      {/* canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl border border-zinc-800 bg-[#0a0d0f] overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <svg
          ref={svgRef}
          className="w-full h-full select-none"
          style={{ cursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <g
            ref={gRef}
            transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}
          >
            {baseContent}
            {/* drawn annotations — never intercept pointer events; the
                eraser uses the dedicated hit targets below. */}
            <g style={{ pointerEvents: "none" }}>
              {elements.map((el) => (
                <OverlayShape key={el.id} el={el} />
              ))}
            </g>
            {/* erase hit targets sit on top only in eraser mode */}
            {tool === "eraser" && (
              <g>
                {elements.map((el) => (
                  <EraseHit key={`hit-${el.id}`} el={el} onErase={eraseElement} />
                ))}
              </g>
            )}
            {draft && <OverlayShape el={draft} />}
          </g>
        </svg>

        {/* zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <button
            onClick={() => zoomBy(1.2)}
            className="w-8 h-8 rounded-md bg-zinc-900/80 border border-zinc-700 text-zinc-200 text-lg leading-none hover:bg-zinc-800 backdrop-blur"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(1 / 1.2)}
            className="w-8 h-8 rounded-md bg-zinc-900/80 border border-zinc-700 text-zinc-200 text-lg leading-none hover:bg-zinc-800 backdrop-blur"
          >
            −
          </button>
          <button
            onClick={fitToView}
            className="w-8 h-8 rounded-md bg-zinc-900/80 border border-zinc-700 text-zinc-400 text-[9px] font-mono hover:bg-zinc-800 backdrop-blur"
          >
            FIT
          </button>
        </div>

        <div className="absolute top-3 left-3 text-[10px] font-mono text-zinc-500 bg-zinc-900/70 border border-zinc-800 rounded px-2 py-1 backdrop-blur pointer-events-none">
          {Math.round(zoom * 100)}% · scroll to zoom · Pan tool to move
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-[10px] font-mono text-zinc-500">
          {elements.length} element{elements.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="py-2 px-4 rounded-xl border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-xs font-mono tracking-wide transition"
          >
            CANCEL
          </button>
          <button
            onClick={() => onSave(elements)}
            className="py-2 px-4 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-zinc-950 text-xs font-mono font-medium tracking-wide transition"
          >
            SAVE EDITS
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* read-only viewport                                                  */
/*                                                                     */
/* The non-editing plan/image view. Fits to the pane on load, then     */
/* supports pinch-to-zoom and one-finger drag-pan on touch, scroll-    */
/* wheel zoom on desktop, and +/−/FIT buttons everywhere — so a dense  */
/* generated plan stays legible on a phone without breaking desktop.   */
/* ------------------------------------------------------------------ */

function PlanViewport({
  base,
  overlay,
}: {
  base: { width: number; height: number; content: React.ReactNode };
  overlay: BlueprintOverlay | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Live mirror so the once-attached wheel listener and pointer math read the
  // current view without re-binding on every frame.
  const viewRef = useRef({ zoom, pan });
  useEffect(() => {
    viewRef.current = { zoom, pan };
  }, [zoom, pan]);

  // Active pointers: 1 = drag-pan, 2 = pinch-zoom.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  // True once the user zooms/pans by hand, so a later resize (orientation
  // change, window resize) won't yank the view back to fit underneath them.
  const userAdjustedRef = useRef(false);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale =
      Math.min(rect.width / base.width, rect.height / base.height) * 0.96 || 1;
    setZoom(scale);
    setPan({
      x: (rect.width - base.width * scale) / 2,
      y: (rect.height - base.height * scale) / 2,
    });
  }, [base.width, base.height]);

  // Re-fit on mount and whenever the drawing changes (new plan / floor switch).
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Auto-fit when the container first gets a real size (e.g. a mobile pane that
  // mounted hidden and is now shown) or resizes — unless the user took control.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!userAdjustedRef.current) fitToView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToView]);

  /** Zoom by `factor` keeping the container-local point (cx,cy) fixed. */
  const zoomAround = useCallback((factor: number, cx: number, cy: number) => {
    userAdjustedRef.current = true;
    const { zoom: z, pan: p } = viewRef.current;
    const nz = clamp(z * factor, 0.2, 12);
    setPan({
      x: cx - (cx - p.x) * (nz / z),
      y: cy - (cy - p.y) * (nz / z),
    });
    setZoom(nz);
  }, []);

  const zoomFromButton = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    zoomAround(factor, rect ? rect.width / 2 : 0, rect ? rect.height / 2 : 0);
  };

  // Non-passive wheel listener so we can preventDefault (zoom, not page-scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(
        e.deltaY < 0 ? 1.1 : 0.9,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      pinchDistRef.current = null;
    } else if (pointersRef.current.size === 2) {
      panStartRef.current = null; // two fingers down → pinch, not pan
      const [a, b] = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointersRef.current.values()];

    if (pts.length >= 2 && pinchDistRef.current != null) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (dist > 0 && pinchDistRef.current > 0) {
        const rect = containerRef.current?.getBoundingClientRect();
        const mx = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const my = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);
        zoomAround(dist / pinchDistRef.current, mx, my);
      }
      pinchDistRef.current = dist;
      return;
    }

    if (panStartRef.current) {
      userAdjustedRef.current = true;
      const s = panStartRef.current;
      setPan({ x: s.px + (e.clientX - s.x), y: s.py + (e.clientY - s.y) });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size < 2) pinchDistRef.current = null;

    if (pointersRef.current.size === 1) {
      // a finger lifted out of a pinch — re-anchor the pan to the survivor so
      // the view doesn't jump.
      const [p] = [...pointersRef.current.values()];
      panStartRef.current = {
        x: p.x,
        y: p.y,
        px: viewRef.current.pan.x,
        py: viewRef.current.pan.y,
      };
    } else if (pointersRef.current.size === 0) {
      panStartRef.current = null;
    }
  };

  const zoomBtn =
    "w-8 h-8 rounded-md bg-zinc-900/80 border border-zinc-700 text-zinc-200 text-lg leading-none hover:bg-zinc-800 backdrop-blur flex items-center justify-center";

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 rounded-xl border border-zinc-800 bg-[#0a0d0f] overflow-hidden"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <svg className="w-full h-full select-none" style={{ cursor: "grab" }}>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {base.content}
          <OverlayLayer elements={overlay?.elements ?? []} />
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button onClick={() => zoomFromButton(1.2)} className={zoomBtn} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomFromButton(1 / 1.2)} className={zoomBtn} aria-label="Zoom out">
          −
        </button>
        <button
          onClick={() => {
            userAdjustedRef.current = false;
            fitToView();
          }}
          className="w-8 h-8 rounded-md bg-zinc-900/80 border border-zinc-700 text-zinc-400 text-[9px] font-mono hover:bg-zinc-800 backdrop-blur"
          aria-label="Fit to view"
        >
          FIT
        </button>
      </div>

      <div className="absolute top-3 left-3 text-[10px] font-mono text-zinc-500 bg-zinc-900/70 border border-zinc-800 rounded px-2 py-1 backdrop-blur pointer-events-none">
        {Math.round(zoom * 100)}% · pinch / scroll to zoom
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* public Plan View                                                    */
/* ------------------------------------------------------------------ */

export function PlanView({
  imageUrl,
  data,
  overlay,
  isBusy,
  onSave,
}: {
  imageUrl: string | null;
  data: BlueprintData | null;
  overlay: BlueprintOverlay | null;
  isBusy: boolean;
  onSave: (overlay: BlueprintOverlay | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState(0);

  const imgSize = useImageNaturalSize(imageUrl);

  // The structured plan: stored with generated blueprints, or rebuilt on the
  // fly from a flat room list (older projects / generated data with no stored
  // floorPlan). Never built for uploaded images — those render the image.
  const model = useMemo<FloorPlanModel | null>(() => {
    if (imageUrl) return null;
    if (data?.floorPlan?.floors?.length) return data.floorPlan;
    if (data?.rooms && data.rooms.length > 0) {
      return floorPlanFromRooms(data.rooms, data.dimensions, "", data.buildingType);
    }
    return null;
  }, [imageUrl, data]);

  const floorIndex = model ? clamp(selectedFloor, 0, model.floors.length - 1) : 0;

  const base = useMemo(() => {
    if (imageUrl && imgSize) {
      return {
        width: imgSize.w,
        height: imgSize.h,
        content: (
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={imgSize.w}
            height={imgSize.h}
            preserveAspectRatio="none"
            style={{ pointerEvents: "none" }}
          />
        ),
        kind: "image" as const,
      };
    }
    if (model && model.floors[floorIndex]) {
      const r = renderFloorPlan(model.floors[floorIndex], model.buildingFootprint);
      return {
        width: r.width,
        height: r.height,
        content: r.content,
        kind: "plan" as const,
      };
    }
    return null;
  }, [imageUrl, imgSize, model, floorIndex]);

  // Note: the editor is only reachable when `base` exists (guarded below), and
  // switching tabs / New Chat unmounts PlanView, so `editing` can't get stuck.

  // image is set but natural size hasn't resolved yet
  if (imageUrl && !imgSize) {
    return (
      <div className="h-full flex items-center justify-center text-center opacity-50">
        <p className="text-sm font-mono text-zinc-400">Loading blueprint…</p>
      </div>
    );
  }

  if (!base) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 opacity-60 px-6">
        <div
          className="w-16 h-16 opacity-20 mb-2"
          style={{
            backgroundImage:
              "linear-gradient(rgba(78,205,196,1) 1px, transparent 1px), linear-gradient(90deg, rgba(78,205,196,1) 1px, transparent 1px)",
            backgroundSize: "10px 10px",
          }}
        />
        <p className="text-sm font-mono text-zinc-400">
          {isBusy ? "Preparing blueprint…" : "No blueprint to display yet"}
        </p>
        <p className="text-xs text-zinc-500 max-w-xs">
          Your blueprint appears here after you upload &amp; analyze an image,
          or generate one from a description. Then you can annotate it.
        </p>
      </div>
    );
  }

  if (editing) {
    return (
      <BlueprintEditor
        baseWidth={base.width}
        baseHeight={base.height}
        baseContent={base.content}
        initialElements={overlay?.elements ?? []}
        onSave={(elements) => {
          onSave({
            version: 1,
            width: base.width,
            height: base.height,
            elements,
          });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
          Plan View
        </h2>
        <div className="flex items-center gap-2">
          {model && model.floors.length > 1 && (
            <div className="flex items-center gap-1">
              {model.floors.map((f, i) => (
                <button
                  key={f.level}
                  onClick={() => setSelectedFloor(i)}
                  className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border transition ${
                    i === floorIndex
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "text-zinc-400 hover:text-zinc-200 border-zinc-800"
                  }`}
                >
                  L{f.level}
                </button>
              ))}
            </div>
          )}
          <span className="text-[10px] uppercase font-mono text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded">
            {base.kind === "image" ? "Uploaded blueprint" : "Generated plan"}
          </span>
        </div>
      </div>

      <PlanViewport base={base} overlay={overlay} />

      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-[10px] font-mono text-zinc-500">
          {overlay?.elements?.length
            ? `${overlay.elements.length} annotation${
                overlay.elements.length === 1 ? "" : "s"
              } saved`
            : "No annotations yet"}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="py-2 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-mono font-medium tracking-wide transition"
        >
          EDIT BLUEPRINT
        </button>
      </div>
    </div>
  );
}
