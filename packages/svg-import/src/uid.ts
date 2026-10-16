// UID phần tử (ADR-003, ADR-023; contract svg-import §5): `el_` + 10 ký tự base32 (a-z, 2-7).
// Bộ sinh mật mã cho dùng thật, bộ sinh theo seed (xoshiro128**) cho test tất định.
import { BINDABLE_ELEMENTS, SVG_NS, isName } from '@mat/svg-renderer';
import { cleanName, deriveName } from './name.ts';
import type { ElementInfo } from './types.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const NON_BINDABLE_ANCESTORS: ReadonlySet<string> = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'filter',
]);

/** Phần tử gắn được: g, hình, text, use, image ngoài defs, clipPath, mask, symbol, pattern, marker, filter. */
export function isBindable(el: Element): boolean {
  if (el.namespaceURI !== SVG_NS || !BINDABLE_ELEMENTS.has(el.localName)) return false;
  for (let p = el.parentElement; p; p = p.parentElement)
    if (NON_BINDABLE_ANCESTORS.has(p.localName)) return false;
  return true;
}

function toUid(next: () => number): string {
  let s = 'el_';
  for (let i = 0; i < 10; i++) s += ALPHABET[next() & 31];
  return s;
}

/** Bộ sinh mật mã (`crypto.getRandomValues`). */
export function makeCryptoUid(): () => string {
  return () => {
    const b = new Uint8Array(10);
    globalThis.crypto.getRandomValues(b);
    let i = 0;
    return toUid(() => b[i++]);
  };
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h | 0;
}

/** Bộ sinh theo seed: cùng seed cho cùng chuỗi UID (test, nhập tất định). */
export function makeSeededUid(seed: number | string): () => string {
  let a = hashSeed(seed);
  const splitmix = (): number => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let s0 = splitmix();
  let s1 = splitmix();
  let s2 = splitmix();
  let s3 = splitmix();
  const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));
  const next = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
  return () => toUid(() => next() >>> 27);
}

interface Frame {
  el: Element;
  parentUid: string | null;
  depth: number;
  inNon: boolean;
  index: number;
}

/**
 * Gán `data-mat-uid` cho mọi phần tử gắn được (duyệt tài liệu theo thứ tự, không đệ quy), bỏ mọi
 * `data-mat-uid` có sẵn, ghi `data-mat-name` cho phần tử có nhãn. Trả danh sách `ElementInfo` và số tên.
 */
export function assignUids(
  root: Element,
  gen: () => string,
): { elements: ElementInfo[]; named: number } {
  const used = new Set<string>();
  const elements: ElementInfo[] = [];
  let named = 0;
  const stack: Frame[] = [{ el: root, parentUid: null, depth: 0, inNon: false, index: 1 }];
  while (stack.length > 0) {
    const f = stack.pop()!;
    const el = f.el;
    el.removeAttribute('data-mat-uid');
    let uid: string;
    let childParent = f.parentUid;
    let childDepth = f.depth;
    const bindable = !f.inNon && isBindable(el);
    if (bindable) {
      for (let tries = 0; ; tries++) {
        const u = gen();
        if (!used.has(u)) {
          uid = u;
          break;
        }
        if (tries > 1000) throw new Error('Bộ sinh UID trả giá trị trùng liên tục');
      }
      used.add(uid);
      el.setAttribute('data-mat-uid', uid);
      const existing = el.getAttribute('data-mat-name');
      const clean = existing !== null && isName(existing) ? cleanName(existing) : '';
      const d = deriveName({
        label: clean,
        id: el.getAttribute('id'),
        tag: el.localName,
        index: f.index,
      });
      if (d.labelled) {
        el.setAttribute('data-mat-name', d.name);
        named++;
      } else el.removeAttribute('data-mat-name');
      const info: ElementInfo = {
        uid,
        tag: el.localName,
        name: d.name,
        parent: f.parentUid,
        depth: f.depth,
      };
      if (d.labelled) info.label = d.name;
      elements.push(info);
      childParent = uid;
      childDepth = f.depth + 1;
    } else {
      el.removeAttribute('data-mat-name');
    }
    const inNon = f.inNon || NON_BINDABLE_ANCESTORS.has(el.localName);
    const kids = el.children;
    const counts = new Map<string, number>();
    const frames: Frame[] = [];
    for (let i = 0; i < kids.length; i++) {
      const tag = kids[i].localName;
      const idx = (counts.get(tag) ?? 0) + 1;
      counts.set(tag, idx);
      frames.push({ el: kids[i], parentUid: childParent, depth: childDepth, inNon, index: idx });
    }
    for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]);
  }
  return { elements, named };
}
