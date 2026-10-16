// Dữ liệu đường `d` (contracts/svg-editor.md §4; FR-107): phân tích đủ M L H V C S Q T A Z (tuyệt đối và tương đối)
// thành đoạn tuyệt đối (để tính hộp bao); `isPolygonPath` khi chỉ có M L H V Z (sửa nút được); ghi lại bằng lệnh tuyệt
// đối. Con trỏ chỉ tiến, không regex.
import { isWs, scanNumber } from '@mat/svg-renderer';
import { fmt } from './transform.ts';

export type Seg =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      cmd: 'A';
      rx: number;
      ry: number;
      rot: number;
      large: boolean;
      sweep: boolean;
      x: number;
      y: number;
    }
  | { cmd: 'Z' };

export interface ParsedPath {
  /** Đoạn tuyệt đối; H/V thành L, S thành C, T thành Q. */
  segs: Seg[];
  /** Chỉ gồm M, L, H, V, Z (hoa hoặc thường). */
  polygonal: boolean;
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function skipSep(s: string, i: number): number {
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  if (s.charCodeAt(i) === 44) {
    i++;
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
  }
  return i;
}

/** Phân tích `d`; null khi hỏng (như bộ kiểm `isPathData` của allowlist). */
export function parsePath(d: string): ParsedPath | null {
  const segs: Seg[] = [];
  let polygonal = true;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null as { x: number; y: number } | null;
  let lastQ = null as { x: number; y: number } | null;
  let cmd = '';
  let first = true;
  while (i < d.length && isWs(d.charCodeAt(i))) i++;
  while (i < d.length) {
    const ch = d[i];
    const up = ch.toUpperCase();
    if (ARGS[up] !== undefined && ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'))) {
      cmd = ch;
      i++;
      while (i < d.length && isWs(d.charCodeAt(i))) i++;
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') return null;
    if (first && cmd.toUpperCase() !== 'M') return null;
    first = false;
    const U = cmd.toUpperCase();
    const rel = cmd !== U;
    if ('CSQTA'.indexOf(U) >= 0) polygonal = false;
    const n = ARGS[U];
    const a: number[] = [];
    for (let k = 0; k < n; k++) {
      if (U === 'A' && (k === 3 || k === 4)) {
        const c = d.charCodeAt(i);
        if (c !== 48 && c !== 49) return null;
        a.push(c - 48);
        i = skipSep(d, i + 1);
        continue;
      }
      const num = scanNumber(d, i);
      if (!num) return null;
      a.push(num.value);
      i = skipSep(d, num.end);
    }
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    let nextC: { x: number; y: number } | null = null;
    let nextQ: { x: number; y: number } | null = null;
    switch (U) {
      case 'M':
        cx = a[0] + ox;
        cy = a[1] + oy;
        sx = cx;
        sy = cy;
        segs.push({ cmd: 'M', x: cx, y: cy });
        cmd = rel ? 'l' : 'L'; // cặp số tiếp theo là L
        break;
      case 'L':
        cx = a[0] + ox;
        cy = a[1] + oy;
        segs.push({ cmd: 'L', x: cx, y: cy });
        break;
      case 'H':
        cx = a[0] + ox;
        segs.push({ cmd: 'L', x: cx, y: cy });
        break;
      case 'V':
        cy = a[0] + oy;
        segs.push({ cmd: 'L', x: cx, y: cy });
        break;
      case 'C': {
        const s: Seg = {
          cmd: 'C',
          x1: a[0] + ox,
          y1: a[1] + oy,
          x2: a[2] + ox,
          y2: a[3] + oy,
          x: a[4] + ox,
          y: a[5] + oy,
        };
        segs.push(s);
        nextC = { x: s.x2, y: s.y2 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case 'S': {
        const x1: number = lastC ? 2 * cx - lastC.x : cx;
        const y1: number = lastC ? 2 * cy - lastC.y : cy;
        const s: Seg = {
          cmd: 'C',
          x1,
          y1,
          x2: a[0] + ox,
          y2: a[1] + oy,
          x: a[2] + ox,
          y: a[3] + oy,
        };
        segs.push(s);
        nextC = { x: s.x2, y: s.y2 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case 'Q': {
        const s: Seg = { cmd: 'Q', x1: a[0] + ox, y1: a[1] + oy, x: a[2] + ox, y: a[3] + oy };
        segs.push(s);
        nextQ = { x: s.x1, y: s.y1 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case 'T': {
        const x1: number = lastQ ? 2 * cx - lastQ.x : cx;
        const y1: number = lastQ ? 2 * cy - lastQ.y : cy;
        const s: Seg = { cmd: 'Q', x1, y1, x: a[0] + ox, y: a[1] + oy };
        segs.push(s);
        nextQ = { x: x1, y: y1 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case 'A':
        segs.push({
          cmd: 'A',
          rx: Math.abs(a[0]),
          ry: Math.abs(a[1]),
          rot: a[2],
          large: a[3] === 1,
          sweep: a[4] === 1,
          x: a[5] + ox,
          y: a[6] + oy,
        });
        cx = a[5] + ox;
        cy = a[6] + oy;
        break;
      case 'Z':
        segs.push({ cmd: 'Z' });
        cx = sx;
        cy = sy;
        break;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  if (first) return null;
  return { segs, polygonal };
}

export function isPolygonPath(d: string): boolean {
  const p = parsePath(d);
  return p !== null && p.polygonal;
}

export type Pt = [number, number];

export interface Poly {
  points: Pt[];
  closed: boolean;
}

/** Đường đa giác thành danh sách đường con (điểm tuyệt đối); null nếu không phải đa giác. */
export function pathToPolys(d: string): Poly[] | null {
  const p = parsePath(d);
  if (!p || !p.polygonal) return null;
  const out: Poly[] = [];
  let cur: Poly | null = null;
  let start: Pt = [0, 0];
  for (const s of p.segs) {
    if (s.cmd === 'M') {
      cur = { points: [[s.x, s.y]], closed: false };
      out.push(cur);
      start = [s.x, s.y];
    } else if (s.cmd === 'L') {
      if (!cur || cur.closed) {
        cur = { points: [[start[0], start[1]]], closed: false };
        out.push(cur);
      }
      cur.points.push([s.x, s.y]);
    } else if (s.cmd === 'Z') {
      if (cur) cur.closed = true;
    }
  }
  return out;
}

/** Ghi đường con bằng lệnh tuyệt đối `M x y L x y … Z`. */
export function polysToPath(polys: readonly Poly[]): string {
  const parts: string[] = [];
  for (const p of polys) {
    if (p.points.length === 0) continue;
    let s = `M${fmt(p.points[0][0])} ${fmt(p.points[0][1])}`;
    for (let i = 1; i < p.points.length; i++)
      s += ` L${fmt(p.points[i][0])} ${fmt(p.points[i][1])}`;
    if (p.closed) s += ' Z';
    parts.push(s);
  }
  return parts.join(' ');
}

/** Danh sách điểm của `points`; null khi hỏng hoặc số lẻ. */
export function parsePoints(s: string): Pt[] | null {
  const out: Pt[] = [];
  let i = 0;
  const nums: number[] = [];
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  while (i < s.length) {
    const n = scanNumber(s, i);
    if (!n) return null;
    nums.push(n.value);
    i = skipSep(s, n.end);
  }
  if (nums.length % 2 !== 0) return null;
  for (let k = 0; k < nums.length; k += 2) out.push([nums[k], nums[k + 1]]);
  return out;
}

export function formatPoints(pts: readonly Pt[]): string {
  return pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ');
}
