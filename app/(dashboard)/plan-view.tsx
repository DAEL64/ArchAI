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
  BlueprintRoom,
  OverlayElement,
  OverlayTool,
} from "@/types/blueprint";

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

interface PlacedRoom {
  name: string;
  dim: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloorPlan {
  width: number;
  height: number;
  rooms: PlacedRoom[];
}

/**
 * Lays generated rooms out as a simple wrapped-row schematic. It is not a true
 * CAD plan — just a readable, proportional visual so a generated blueprint
 * (which has no source image) still has something to view and annotate.
 */
function buildFloorPlan(rooms: BlueprintRoom[]): FloorPlan {
  const PAD = 28;
  const GAP = 16;
  const MAX_W = 940;
  const PPF = 7; // pixels per foot

  const sized = rooms.map((r) => {
    let w = r.widthFeet ? r.widthFeet * PPF : null;
    let h = r.depthFeet ? r.depthFeet * PPF : null;

    if (!w || !h) {
      const area = r.estimatedSqft && r.estimatedSqft > 0 ? r.estimatedSqft : 120;
      const side = Math.sqrt(area) * PPF;
      w = w ?? side;
      h = h ?? side;
    }

    return {
      name: r.name,
      dim: r.dimensionText ?? (r.estimatedSqft ? `${r.estimatedSqft} sqft` : ""),
      w: clamp(w, 80, 360),
      h: clamp(h, 64, 300),
    };
  });

  let x = PAD;
  let y = PAD;
  let rowHeight = 0;
  let maxRight = PAD;

  const placed: PlacedRoom[] = sized.map((b) => {
    if (x + b.w > MAX_W - PAD && x > PAD) {
      x = PAD;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const p: PlacedRoom = { ...b, x, y };
    x += b.w + GAP;
    rowHeight = Math.max(rowHeight, b.h);
    maxRight = Math.max(maxRight, p.x + b.w);
    return p;
  });

  return {
    width: Math.max(maxRight + PAD, 360),
    height: y + rowHeight + PAD,
    rooms: placed,
  };
}

function FloorPlanContent({ plan }: { plan: FloorPlan }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect x={0} y={0} width={plan.width} height={plan.height} fill="#0a0d0f" />
      {plan.rooms.map((r, i) => (
        <g key={i}>
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={4}
            fill="rgba(78,205,196,0.06)"
            stroke="#4ecdc4"
            strokeOpacity={0.5}
            strokeWidth={1.5}
          />
          <text
            x={r.x + r.w / 2}
            y={r.y + r.h / 2 - 3}
            textAnchor="middle"
            fontSize={13}
            fill="#e4e4e7"
            fontFamily="ui-monospace, monospace"
          >
            {r.name}
          </text>
          {r.dim && (
            <text
              x={r.x + r.w / 2}
              y={r.y + r.h / 2 + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#71717a"
              fontFamily="ui-monospace, monospace"
            >
              {r.dim}
            </text>
          )}
        </g>
      ))}
    </g>
  );
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

  const handlePointerUp = () => {
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

  const imgSize = useImageNaturalSize(imageUrl);

  const floorPlan = useMemo(
    () =>
      !imageUrl && data?.rooms && data.rooms.length > 0
        ? buildFloorPlan(data.rooms)
        : null,
    [imageUrl, data],
  );

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
    if (floorPlan) {
      return {
        width: floorPlan.width,
        height: floorPlan.height,
        content: <FloorPlanContent plan={floorPlan} />,
        kind: "plan" as const,
      };
    }
    return null;
  }, [imageUrl, imgSize, floorPlan]);

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
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="text-xs font-semibold tracking-wider uppercase text-zinc-500 font-mono">
          Plan View
        </h2>
        <span className="text-[10px] uppercase font-mono text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded">
          {base.kind === "image" ? "Uploaded blueprint" : "Generated plan"}
        </span>
      </div>

      <div className="relative flex-1 min-h-0 rounded-xl border border-zinc-800 bg-[#0a0d0f] overflow-hidden">
        <svg
          viewBox={`0 0 ${base.width} ${base.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
        >
          {base.content}
          <OverlayLayer elements={overlay?.elements ?? []} />
        </svg>
      </div>

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
