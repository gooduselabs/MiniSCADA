// Kiểu và kiểm hợp lệ của manifest ký hiệu (contract symbol-library §2).

export type PortDir = 'n' | 'e' | 's' | 'w';

export interface SymbolPart {
  role: string;
  uid: string;
  label: string;
  suggest: string[];
}

export interface SymbolPortDef {
  id: string;
  /** Tương đối trên viewBox, [0, 1]. */
  x: number;
  y: number;
  /** Hướng ra khỏi ký hiệu. */
  dir: PortDir;
  kind: string;
}

export interface SymbolVariant {
  id: string;
  file: string;
  ports: SymbolPortDef[];
}

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  file: string;
  viewBox: [number, number, number, number];
  defaultSize: [number, number];
  keywords: string[];
  parts: SymbolPart[];
  ports: SymbolPortDef[];
  variants?: SymbolVariant[];
}

export interface SymbolCategory {
  id: string;
  name: string;
}

export interface SymbolManifest {
  schemaVersion: string;
  license: string;
  categories: SymbolCategory[];
  symbols: SymbolDef[];
}

/** Mục động hóa mà `parts[].suggest` được tham chiếu (contract studio-svg-editor §5). */
export const SUGGEST_IDS: readonly string[] = [
  'text',
  'fill',
  'stroke',
  'level',
  'rotate',
  'spin',
  'translateX',
  'translateY',
  'scale',
  'blink',
  'flow',
  'visibility',
  'opacity',
  'click',
];

const DIRS: ReadonlySet<string> = new Set(['n', 'e', 's', 'w']);
const PORT_KINDS: ReadonlySet<string> = new Set(['pipe']);

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isSymbolId(v: string): boolean {
  if (v.length < 2 || v.length > 32) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    const lower = c >= 97 && c <= 122;
    const digit = c >= 48 && c <= 57;
    if (i === 0 ? !lower : !(lower || digit || c === 45)) return false;
  }
  return true;
}

function isUidText(v: string): boolean {
  if (v.length < 6 || v.length > 43 || !v.startsWith('el_')) return false;
  for (let i = 3; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false;
  }
  return true;
}

function checkPorts(ports: unknown, where: string, errs: string[]): void {
  if (!Array.isArray(ports) || ports.length === 0) {
    errs.push(`${where}: ports phải là mảng không rỗng`);
    return;
  }
  const seen = new Set<string>();
  for (const p of ports) {
    if (!isRec(p) || !isStr(p.id)) {
      errs.push(`${where}: port thiếu id`);
      continue;
    }
    if (seen.has(p.id)) errs.push(`${where}: port id trùng ${p.id}`);
    seen.add(p.id);
    for (const k of ['x', 'y'] as const) {
      const v = p[k];
      if (!isNum(v) || v < 0 || v > 1) errs.push(`${where}: port ${p.id}.${k} ngoài [0, 1]`);
    }
    if (typeof p.dir !== 'string' || !DIRS.has(p.dir))
      errs.push(`${where}: port ${p.id}.dir phải là n|e|s|w`);
    if (typeof p.kind !== 'string' || !PORT_KINDS.has(p.kind))
      errs.push(`${where}: port ${p.id}.kind không hợp lệ`);
  }
}

/** Kiểm manifest theo contract §2; trả danh sách lỗi (rỗng = hợp lệ). Không ném. */
export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(m)) return ['manifest phải là đối tượng'];
  if (m.schemaVersion !== '1') errs.push('schemaVersion phải là "1"');
  if (m.license !== 'CC0-1.0') errs.push('license phải là CC0-1.0');

  const catIds = new Set<string>();
  if (!Array.isArray(m.categories) || m.categories.length === 0) {
    errs.push('categories phải là mảng không rỗng');
  } else {
    for (const c of m.categories) {
      if (!isRec(c) || !isStr(c.id) || !isStr(c.name)) errs.push('category thiếu id hoặc name');
      else catIds.add(c.id);
    }
  }

  if (!Array.isArray(m.symbols) || m.symbols.length === 0) {
    errs.push('symbols phải là mảng không rỗng');
    return errs;
  }
  const ids = new Set<string>();
  for (const s of m.symbols) {
    if (!isRec(s) || !isStr(s.id)) {
      errs.push('symbol thiếu id');
      continue;
    }
    const w = `symbol ${s.id}`;
    if (!isSymbolId(s.id)) errs.push(`${w}: id sai định dạng`);
    if (ids.has(s.id)) errs.push(`${w}: id trùng`);
    ids.add(s.id);
    if (!isStr(s.name)) errs.push(`${w}: thiếu name`);
    if (!isStr(s.category) || !catIds.has(s.category)) errs.push(`${w}: category không có`);
    if (!isStr(s.file) || !s.file.startsWith('svg/') || !s.file.endsWith('.svg'))
      errs.push(`${w}: file phải dạng svg/<tệp>.svg`);

    const vb = s.viewBox;
    const vbOk = Array.isArray(vb) && vb.length === 4 && vb.every(isNum) && vb[2] > 0 && vb[3] > 0;
    if (!vbOk) errs.push(`${w}: viewBox phải là 4 số, rộng và cao > 0`);
    const ds = s.defaultSize;
    if (!Array.isArray(ds) || ds.length !== 2 || !ds.every((n) => Number.isInteger(n) && n > 0)) {
      errs.push(`${w}: defaultSize phải là hai số nguyên dương`);
    } else if (vbOk) {
      const ratioVb = (vb as number[])[2] / (vb as number[])[3];
      if (Math.abs(ds[0] / ds[1] - ratioVb) > 0.01 * ratioVb)
        errs.push(`${w}: defaultSize không giữ tỉ lệ viewBox`);
    }
    if (!Array.isArray(s.keywords) || !s.keywords.every(isStr)) errs.push(`${w}: keywords sai`);

    const roles = new Set<string>();
    if (!Array.isArray(s.parts) || s.parts.length === 0) {
      errs.push(`${w}: parts phải là mảng không rỗng`);
    } else {
      for (const p of s.parts) {
        if (!isRec(p) || !isStr(p.role) || !isStr(p.uid)) {
          errs.push(`${w}: part thiếu role hoặc uid`);
          continue;
        }
        if (roles.has(p.role)) errs.push(`${w}: role trùng ${p.role}`);
        roles.add(p.role);
        const want = `el_${s.id.replaceAll('-', '_')}_${p.role}`;
        if (p.uid !== want || !isUidText(p.uid)) errs.push(`${w}: uid ${p.uid} phải là ${want}`);
        if (!isStr(p.label)) errs.push(`${w}: part ${p.role} thiếu label`);
        if (
          !Array.isArray(p.suggest) ||
          p.suggest.length === 0 ||
          !p.suggest.every((g) => typeof g === 'string' && SUGGEST_IDS.includes(g))
        )
          errs.push(`${w}: part ${p.role} có suggest ngoài danh sách động hóa`);
      }
    }
    checkPorts(s.ports, w, errs);
    if (s.variants !== undefined) {
      if (!Array.isArray(s.variants) || s.variants.length === 0) {
        errs.push(`${w}: variants phải là mảng không rỗng`);
      } else {
        for (const v of s.variants) {
          if (!isRec(v) || !isStr(v.id) || !isStr(v.file)) {
            errs.push(`${w}: variant thiếu id hoặc file`);
            continue;
          }
          checkPorts(v.ports, `${w} variant ${v.id}`, errs);
        }
      }
    }
  }
  return errs;
}
