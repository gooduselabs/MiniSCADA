// Trạng thái soạn thảo của trình vẽ SVG (feature 011, T161; FR-105; contracts/svg-editor.md §6): lớp ẩn, lớp khóa và đường
// gióng theo từng tệp SVG, lưu ở `<project>/.mat-editor/svg-state.json`. Tệp này không vào gói, không vào digest (Studio
// không đọc nó thành tài liệu của project và không liệt kê nó khi đóng gói), không đổi tệp SVG; mất tệp không mất dữ liệu
// thiết kế (mọi lớp hiện và mở khóa). Hàm thuần cho dạng dữ liệu; `SvgStateStore` đọc/ghi qua lớp platform (ghi atomic).
import { isSafeRelPath } from '@mat/project-schema';
import type { Platform } from '../platform/types.ts';

export const SVG_STATE_FILE = '.mat-editor/svg-state.json';
/** Khóa của "Lớp mặc định" ảo (phần tử là con trực tiếp của gốc): tên lớp thật không bao giờ rỗng. */
export const DEFAULT_LAYER_KEY = '';
/** Số đường gióng tối đa mỗi tệp. */
export const MAX_GUIDES = 200;

export interface LayerState {
  hidden: boolean;
  locked: boolean;
}

export interface GuideLine {
  axis: 'x' | 'y';
  pos: number;
}

export interface FileEditorState {
  layers: Record<string, LayerState>;
  guides: GuideLine[];
}

export interface SvgStateDoc {
  version: 1;
  files: Record<string, FileEditorState>;
}

/**
 * Từ điển không prototype (T202): tên lớp là chuỗi tùy ý (`__proto__`, `constructor`…), không được đụng thuộc tính của
 * Object (gán `__proto__` trên `{}` đổi prototype và mất khi ghi JSON; đọc `constructor` trả hàm).
 */
function dict<T>(from?: Record<string, T>): Record<string, T> {
  const d = Object.create(null) as Record<string, T>;
  if (from) for (const k of Object.keys(from)) d[k] = from[k]!;
  return d;
}

const DEFAULT_LAYER: LayerState = Object.freeze({ hidden: false, locked: false });

export const emptySvgState = (): SvgStateDoc => ({ version: 1, files: dict() });

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const round3 = (n: number): number => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

/** Đọc khoan dung: thiếu, hỏng, sai phiên bản thì trạng thái rỗng; mục sai kiểu bị bỏ (không hỏng cả tệp). */
export function parseSvgState(text: string | null): SvgStateDoc {
  if (text === null) return emptySvgState();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptySvgState();
  }
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.files)) return emptySvgState();
  const out = emptySvgState();
  for (const [rel, f] of Object.entries(raw.files)) {
    if (!rel.endsWith('.svg') || !isSafeRelPath(rel) || !isObject(f)) continue;
    const layers = dict<LayerState>();
    if (isObject(f.layers))
      for (const [name, l] of Object.entries(f.layers)) {
        if (!isObject(l) || name.length > 64) continue;
        layers[name] = {
          hidden: l.hidden === true,
          locked: l.locked === true,
        };
      }
    const guides: GuideLine[] = [];
    if (Array.isArray(f.guides))
      for (const g of f.guides) {
        if (!isObject(g) || (g.axis !== 'x' && g.axis !== 'y')) continue;
        if (typeof g.pos !== 'number' || !Number.isFinite(g.pos)) continue;
        if (guides.length < MAX_GUIDES) guides.push({ axis: g.axis, pos: round3(g.pos) });
      }
    out.files[rel] = { layers, guides };
  }
  return out;
}

export const serializeSvgState = (s: SvgStateDoc): string => JSON.stringify(s, null, 2) + '\n';

export function layerState(s: SvgStateDoc, rel: string, layer: string): LayerState {
  return s.files[rel]?.layers[layer] ?? { ...DEFAULT_LAYER };
}

/** Bỏ mục về mặc định (lớp không ẩn không khóa, tệp không còn gì): tệp trạng thái không phình. */
function compactFile(f: FileEditorState): FileEditorState | null {
  const layers = dict<LayerState>();
  for (const [k, v] of Object.entries(f.layers)) if (v.hidden || v.locked) layers[k] = v;
  if (Object.keys(layers).length === 0 && f.guides.length === 0) return null;
  return { layers, guides: f.guides };
}

function withFile(
  s: SvgStateDoc,
  rel: string,
  edit: (f: FileEditorState) => FileEditorState,
): SvgStateDoc {
  const cur = s.files[rel] ?? { layers: dict<LayerState>(), guides: [] };
  const next = compactFile(edit({ layers: dict(cur.layers), guides: [...cur.guides] }));
  const files = dict(s.files);
  if (next) files[rel] = next;
  else delete files[rel];
  return { version: 1, files };
}

export function withLayerState(
  s: SvgStateDoc,
  rel: string,
  layer: string,
  patch: Partial<LayerState>,
): SvgStateDoc {
  return withFile(s, rel, (f) => {
    f.layers[layer] = { ...(f.layers[layer] ?? DEFAULT_LAYER), ...patch };
    return f;
  });
}

/** Đổi tên lớp (lệnh Đổi tên lớp của tài liệu): trạng thái đi theo tên mới. */
export function renameLayerState(
  s: SvgStateDoc,
  rel: string,
  from: string,
  to: string,
): SvgStateDoc {
  if (!s.files[rel]?.layers[from]) return s;
  return withFile(s, rel, (f) => {
    f.layers[to] = f.layers[from]!;
    delete f.layers[from];
    return f;
  });
}

export function dropLayerState(s: SvgStateDoc, rel: string, layer: string): SvgStateDoc {
  if (!s.files[rel]?.layers[layer]) return s;
  return withFile(s, rel, (f) => {
    delete f.layers[layer];
    return f;
  });
}

export function withGuides(s: SvgStateDoc, rel: string, guides: readonly GuideLine[]): SvgStateDoc {
  return withFile(s, rel, (f) => ({
    layers: f.layers,
    guides: guides.slice(0, MAX_GUIDES).map((g) => ({ axis: g.axis, pos: round3(g.pos) })),
  }));
}

/** Đổi tên tệp (Lưu thành tệp mới): trạng thái đi theo. */
export function moveFileState(s: SvgStateDoc, from: string, to: string): SvgStateDoc {
  const f = s.files[from];
  if (!f) return s;
  const files = dict(s.files);
  files[to] = f;
  delete files[from];
  return { version: 1, files };
}

type StateIo = Pick<Platform, 'read' | 'write'>;

/**
 * Trạng thái soạn thảo của project đang mở: đọc một lần, mỗi thay đổi ghi lại cả tệp (ghi tạm rồi đổi tên ở lớp Rust, ghi
 * đè không so băm: đây là tệp của Studio, không phải của người dùng). Ghi lỗi thì giữ trong bộ nhớ (không mất thao tác).
 */
export class SvgStateStore {
  private s: SvgStateDoc = emptySvgState();
  private chain: Promise<void> = Promise.resolve();
  /** Lỗi ghi gần nhất (hiện ở thanh trạng thái của editor); null khi ổn. */
  lastError: string | null = null;

  private readonly io: StateIo;

  constructor(io: StateIo) {
    this.io = io;
  }

  get state(): SvgStateDoc {
    return this.s;
  }

  async load(): Promise<void> {
    const r = await this.io.read(SVG_STATE_FILE);
    this.s = parseSvgState('text' in r ? r.text : null);
  }

  layer(rel: string, layer: string): LayerState {
    return layerState(this.s, rel, layer);
  }

  guides(rel: string): readonly GuideLine[] {
    return this.s.files[rel]?.guides ?? [];
  }

  setLayer(rel: string, layer: string, patch: Partial<LayerState>): Promise<void> {
    return this.update(withLayerState(this.s, rel, layer, patch));
  }

  renameLayer(rel: string, from: string, to: string): Promise<void> {
    return this.update(renameLayerState(this.s, rel, from, to));
  }

  dropLayer(rel: string, layer: string): Promise<void> {
    return this.update(dropLayerState(this.s, rel, layer));
  }

  setGuides(rel: string, guides: readonly GuideLine[]): Promise<void> {
    return this.update(withGuides(this.s, rel, guides));
  }

  moveFile(from: string, to: string): Promise<void> {
    return this.update(moveFileState(this.s, from, to));
  }

  /** Chờ các lần ghi đang chạy. */
  idle(): Promise<void> {
    return this.chain;
  }

  private update(next: SvgStateDoc): Promise<void> {
    if (next === this.s) return this.chain;
    this.s = next;
    const text = serializeSvgState(next);
    this.chain = this.chain.then(async () => {
      const r = await this.io.write(SVG_STATE_FILE, text, null, true);
      this.lastError = 'error' in r ? r.error : null;
    });
    return this.chain;
  }
}
