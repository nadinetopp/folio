// Ruling lines from a pdf.js operator list: stroked segments, plus thin filled bars used as rules.
import type { Ruling } from "./types";

/**
 * pdf.js folds path painting into constructPath. The paint operator is one of these ids (pdf.js OPS), and the path
 * itself uses DrawOPS (move 0, line 1, curve 2, quadratic 3, close 4), which are not the same numbers.
 */
const SAVE = 10;
const RESTORE = 11;
const TRANSFORM = 12;
const MOVE = 13;
const LINE = 14;
const CURVE = 15;
const CURVE_2 = 16;
const CURVE_3 = 17;
const CLOSE = 18;
const RECT = 19;
const STROKE = 20;
const CLOSE_STROKE = 21;
const FILL = 22;
const EO_FILL = 23;
const FILL_STROKE = 24;
const EO_FILL_STROKE = 25;
const CLOSE_FILL_STROKE = 26;
const CLOSE_EO_FILL_STROKE = 27;
const END_PATH = 28;
const CONSTRUCT_PATH = 91;

const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

const STROKES = new Set([STROKE, CLOSE_STROKE, FILL_STROKE, EO_FILL_STROKE, CLOSE_FILL_STROKE, CLOSE_EO_FILL_STROKE]);
const FILLS = new Set([FILL, EO_FILL, FILL_STROKE, EO_FILL_STROKE, CLOSE_FILL_STROKE, CLOSE_EO_FILL_STROKE]);
const CLOSES = new Set([CLOSE_STROKE, CLOSE_FILL_STROKE, CLOSE_EO_FILL_STROKE]);

interface Segment { x0: number; y0: number; x1: number; y1: number }

const multiply = (m1: number[], m2: number[]) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

function numbers(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<number>, number => +number || 0);
  return [];
}

/** constructPath args are [paintOp, [coords], minMax]. A legacy test may pass the coords array itself. */
function pathCoords(arg: unknown): ArrayLike<number> | null {
  if (Array.isArray(arg)) {
    const first = arg[0];
    if (first && typeof first === "object" && first !== null && "length" in first) return first as ArrayLike<number>;
    if (typeof first === "number") return arg as number[];
    return null;
  }
  if (arg && typeof arg === "object" && "length" in arg) return arg as ArrayLike<number>;
  return null;
}

function axisRuling(segment: Segment): Ruling | null {
  const dx = Math.abs(segment.x1 - segment.x0);
  const dy = Math.abs(segment.y1 - segment.y0);
  if (dx <= 0.9 && dy >= 8) return { axis: "v", at: (segment.x0 + segment.x1) / 2, from: Math.min(segment.y0, segment.y1), to: Math.max(segment.y0, segment.y1) };
  if (dy <= 0.9 && dx >= 8) return { axis: "h", at: (segment.y0 + segment.y1) / 2, from: Math.min(segment.x0, segment.x1), to: Math.max(segment.x0, segment.x1) };
  return null;
}

/** A filled bar a couple of points thick is a rule. A filled cell or page background is not. */
function thinFill(segments: Segment[]): Ruling | null {
  if (!segments.length) return null;
  const xs = segments.flatMap(segment => [segment.x0, segment.x1]);
  const ys = segments.flatMap(segment => [segment.y0, segment.y1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const width = x1 - x0, height = y1 - y0;
  if (Math.min(width, height) > 2.5 || Math.max(width, height) < 8) return null;
  if (height <= width) return { axis: "h", at: (y0 + y1) / 2, from: x0, to: x1 };
  return { axis: "v", at: (x0 + x1) / 2, from: y0, to: y1 };
}

function commit(segments: Segment[], paint: number, into: Ruling[]) {
  if (STROKES.has(paint)) {
    for (const segment of segments) {
      const ruling = axisRuling(segment);
      if (ruling) into.push(ruling);
    }
    return;
  }
  if (FILLS.has(paint)) {
    const ruling = thinFill(segments);
    if (ruling) into.push(ruling);
  }
}

interface Pen {
  apply(x: number, y: number): { x: number; y: number };
  segments: Segment[];
  x: number;
  y: number;
  sx: number;
  sy: number;
  down: boolean;
}

function moveTo(pen: Pen, x: number, y: number) {
  const point = pen.apply(x, y);
  pen.x = pen.sx = point.x;
  pen.y = pen.sy = point.y;
  pen.down = true;
}

function lineTo(pen: Pen, x: number, y: number) {
  const point = pen.apply(x, y);
  if (pen.down) pen.segments.push({ x0: pen.x, y0: pen.y, x1: point.x, y1: point.y });
  pen.x = point.x;
  pen.y = point.y;
  pen.down = true;
}

function closePath(pen: Pen) {
  if (pen.down && (pen.x !== pen.sx || pen.y !== pen.sy)) pen.segments.push({ x0: pen.x, y0: pen.y, x1: pen.sx, y1: pen.sy });
  pen.x = pen.sx;
  pen.y = pen.sy;
}

function jump(pen: Pen, x: number, y: number) {
  const point = pen.apply(x, y);
  pen.x = point.x;
  pen.y = point.y;
  pen.down = true;
}

/** DrawOPS path. Curves move the pen but are not rules (a rounded corner is not a column line). */
function segmentsFromDraw(data: ArrayLike<number>, apply: Pen["apply"]): Segment[] {
  const pen: Pen = { apply, segments: [], x: 0, y: 0, sx: 0, sy: 0, down: false };
  for (let i = 0; i < data.length;) {
    const op = data[i++];
    if (op === DRAW_MOVE) moveTo(pen, data[i++] ?? 0, data[i++] ?? 0);
    else if (op === DRAW_LINE) lineTo(pen, data[i++] ?? 0, data[i++] ?? 0);
    else if (op === DRAW_CURVE) { i += 4; jump(pen, data[i++] ?? 0, data[i++] ?? 0); }
    else if (op === DRAW_QUAD) { i += 2; jump(pen, data[i++] ?? 0, data[i++] ?? 0); }
    else if (op === DRAW_CLOSE) closePath(pen);
    else break;
  }
  return pen.segments;
}

function mergeRulings(list: Ruling[]): Ruling[] {
  const sorted = [...list].sort((a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from);
  const merged: Ruling[] = [];
  for (const ruling of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.axis === ruling.axis && Math.abs(previous.at - ruling.at) <= 1.25 && ruling.from <= previous.to + 1.5) {
      previous.from = Math.min(previous.from, ruling.from);
      previous.to = Math.max(previous.to, ruling.to);
    } else merged.push({ ...ruling });
  }
  return merged;
}

/**
 * Horizontal and vertical rules in user space. The current transform is applied, so a line drawn inside a translated
 * form lands where it is painted. Annotations are the caller's concern (pass an operator list that excludes them).
 */
export function extractRulings(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>): Ruling[] {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const found: Ruling[] = [];
  const pen: Pen = {
    apply: (x, y) => ({ x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] }),
    segments: [], x: 0, y: 0, sx: 0, sy: 0, down: false,
  };
  const resetPen = () => { pen.segments = []; pen.down = false; };
  const applyNow = pen.apply;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === SAVE) stack.push(ctm.slice());
    else if (fn === RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === TRANSFORM) {
      const matrix = numbers(args);
      if (matrix.length >= 6) ctm = multiply(ctm, matrix);
    } else if (fn === CONSTRUCT_PATH) {
      const list = Array.isArray(args) ? args : [];
      const paint = typeof list[0] === "number" ? list[0] : STROKE;
      const coords = pathCoords(list[1]);
      if (coords && coords.length) commit(segmentsFromDraw(coords, applyNow), paint, found);
    } else if (fn === MOVE) {
      const [x, y] = numbers(args);
      moveTo(pen, x, y);
    } else if (fn === LINE) {
      const [x, y] = numbers(args);
      lineTo(pen, x, y);
    } else if (fn === CURVE) {
      const pts = numbers(args);
      jump(pen, pts[4] ?? 0, pts[5] ?? 0);
    } else if (fn === CURVE_2 || fn === CURVE_3) {
      const pts = numbers(args);
      jump(pen, pts[2] ?? 0, pts[3] ?? 0);
    } else if (fn === CLOSE) closePath(pen);
    else if (fn === RECT) {
      const [x, y, w, h] = numbers(args);
      moveTo(pen, x, y);
      lineTo(pen, x + w, y);
      lineTo(pen, x + w, y + h);
      lineTo(pen, x, y + h);
      closePath(pen);
    } else if (typeof fn === "number" && (STROKES.has(fn) || FILLS.has(fn))) {
      if (CLOSES.has(fn)) closePath(pen);
      commit(pen.segments, fn, found);
      resetPen();
    } else if (fn === END_PATH) resetPen();
  }
  return mergeRulings(found);
}

export interface RulingGrid {
  /** Column boundaries, left to right, including the outer rules. */
  xs: number[];
  /** Row boundaries, bottom to top, including the outer rules. */
  ys: number[];
}

function crosses(horizontal: Ruling, vertical: Ruling): boolean {
  const pad = 1.5;
  return vertical.at >= horizontal.from - pad && vertical.at <= horizontal.to + pad
    && horizontal.at >= vertical.from - pad && horizontal.at <= vertical.to + pad;
}

/** Positions within 2.5pt are one rule (a double line, or the same line split across subpaths). */
export function clusterPositions(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const group = groups.at(-1);
    if (group && value - group[0] <= 2.5) group.push(value);
    else groups.push([value]);
  }
  return groups.map(group => group.reduce((sum, value) => sum + value, 0) / group.length);
}

/** Grids of at least two columns and two rows. A lone box around a paragraph (two by two rules) is not a table. */
export function rulingGrids(rulings: readonly Ruling[]): RulingGrid[] {
  const long = rulings.filter(ruling => ruling.to - ruling.from >= 16);
  const horizontal = long.filter(ruling => ruling.axis === "h");
  const vertical = long.filter(ruling => ruling.axis === "v");
  const count = horizontal.length;
  const parent = Array.from({ length: count + vertical.length }, (_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (let i = 0; i < horizontal.length; i++) {
    for (let j = 0; j < vertical.length; j++) if (crosses(horizontal[i], vertical[j])) union(i, count + j);
  }
  const groups = new Map<number, { h: Ruling[]; v: Ruling[] }>();
  const groupFor = (id: number) => {
    let group = groups.get(id);
    if (!group) groups.set(id, group = { h: [], v: [] });
    return group;
  };
  horizontal.forEach((ruling, index) => groupFor(find(index)).h.push(ruling));
  vertical.forEach((ruling, index) => groupFor(find(count + index)).v.push(ruling));
  const grids: RulingGrid[] = [];
  for (const group of groups.values()) {
    const xs = clusterPositions(group.v.map(ruling => ruling.at));
    const ys = clusterPositions(group.h.map(ruling => ruling.at));
    if (xs.length >= 3 && ys.length >= 3) grids.push({ xs, ys });
  }
  grids.sort((a, b) => (a.xs[a.xs.length - 1] - a.xs[0]) * (a.ys[a.ys.length - 1] - a.ys[0])
    - (b.xs[b.xs.length - 1] - b.xs[0]) * (b.ys[b.ys.length - 1] - b.ys[0]));
  return grids;
}

/** Band index for a value on ascending edges. The last band includes its top edge. */
export function bandIndex(edges: readonly number[], value: number): number {
  for (let i = 0; i < edges.length - 1; i++) {
    const last = i === edges.length - 2;
    const lo = edges[i] - 0.75;
    const hi = edges[i + 1] + (last ? 0.75 : -0.75);
    if (value >= lo && value < hi) return i;
    if (last && value >= lo && value <= edges[i + 1] + 0.75) return i;
  }
  return -1;
}
