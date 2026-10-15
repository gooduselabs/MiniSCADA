// Đối chiếu nhập lại (contract svg-import §7; ADR-023 mục 7; FR-026, FR-027): bốn bước UID -> id -> cấu trúc ->
// hình học; mơ hồ thì hỏi; bất biến: 0 gán sai tự động. Không regex, không đệ quy, không getBBox.
import { parseXml } from './dom.ts';
import { isMeaninglessId } from './name.ts';
import { bindablePaths, buildSignatures, distance } from './signature.ts';
import type { SigItem } from './signature.ts';
import type { ElementInfo, ImportResult, MatchResult } from './types.ts';
import { writeSvg } from './write.ts';

/** Ngưỡng (giá trị đã hiệu chỉnh ở T100, xem ADR-023 "Số đo"). */
export interface MatchThresholds {
  uid: number;
  id: number;
  /** Ngưỡng của bước 2 khi `id` do phần mềm tự sinh (path123, rect45): id loại này bị tái sử dụng cho phần tử khác. */
  idAuto: number;
  structure: number;
  geometry: number;
  /** Ứng viên hạng hai phải cách ứng viên tốt nhất ít nhất chừng này. */
  margin: number;
  candidate: number;
  maxCandidates: number;
}
export const MATCH_THRESHOLDS: Readonly<MatchThresholds> = Object.freeze({
  uid: 0.25,
  id: 0.25,
  idAuto: 0.05,
  structure: 0.05,
  geometry: 0.005,
  margin: 0.002,
  candidate: 0.25,
  maxCandidates: 3,
});

export interface MatchOptions {
  /** Tập UID của bản cũ được phép dùng (mặc định: mọi `data-mat-uid` của phần tử gắn được). */
  uids?: ReadonlySet<string>;
  /** UID bản cũ đang có binding / sự kiện (để báo mồ côi và ứng viên). */
  bound?: ReadonlySet<string>;
  events?: ReadonlySet<string>;
  thresholds?: Partial<MatchThresholds>;
}

/** Chỉ mục theo x0 của hộp bao để tìm hình gần: D >= |dx0| / diag nên cửa sổ x0 là cận đúng. */
class BoxIndex {
  private readonly sorted: SigItem[];
  private readonly keys: number[];
  constructor(items: SigItem[]) {
    this.sorted = items.filter((i) => i.box !== null).sort((a, b) => a.box![0] - b.box![0]);
    this.keys = this.sorted.map((i) => i.box![0]);
  }
  /** Mọi mục cùng thẻ, thỏa `ok`, với D(probe, mục) <= r (r tính theo đơn vị đã chuẩn hóa). */
  query(probe: SigItem, r: number, diag: number, ok: (i: SigItem) => boolean): Array<{ it: SigItem; d: number }> {
    const out: Array<{ it: SigItem; d: number }> = [];
    if (probe.box === null) return out;
    const lo = probe.box[0] - r * diag;
    const hi = probe.box[0] + r * diag;
    let a = 0;
    let b = this.keys.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (this.keys[m] < lo) a = m + 1;
      else b = m;
    }
    for (let i = a; i < this.sorted.length && this.keys[i] <= hi; i++) {
      const it = this.sorted[i];
      if (it.tag !== probe.tag) continue;
      const pb = probe.box;
      const ib = it.box!;
      const lim = r * diag;
      // cận hình học rẻ trước khi tính D đầy đủ (D >= phần hình học)
      if (Math.abs(ib[1] - pb[1]) > lim || Math.abs(ib[2] - pb[2]) > lim || Math.abs(ib[3] - pb[3]) > lim) continue;
      if (!ok(it)) continue;
      const d = distance(probe, it, diag);
      if (d <= r) out.push({ it, d });
    }
    return out;
  }
}

export function matchTrees(oldRoot: Element, newRoot: Element, opt: MatchOptions = {}): MatchResult {
  const T: MatchThresholds = { ...MATCH_THRESHOLDS, ...opt.thresholds };
  const O = buildSignatures(oldRoot);
  const N = buildSignatures(newRoot, O.viewBox);
  const diag = O.diag;

  // phần tử cũ dùng được: có UID duy nhất, thuộc tập cho phép
  const uidCountOld = new Map<string, number>();
  for (const it of O.items) if (it.uid) uidCountOld.set(it.uid, (uidCountOld.get(it.uid) ?? 0) + 1);
  const oldUsable: SigItem[] = [];
  const oldByUid = new Map<string, number>();
  O.items.forEach((it, i) => {
    if (it.uid && uidCountOld.get(it.uid) === 1 && (!opt.uids || opt.uids.has(it.uid))) {
      oldUsable.push(it);
      oldByUid.set(it.uid, i);
    }
  });
  const oIdx = new Map<SigItem, number>(O.items.map((it, i) => [it, i]));
  const usable = new Set<SigItem>(oldUsable);
  const nItems = N.items;
  const nMatch = new Array<number>(nItems.length).fill(-1); // chỉ số old
  const nStep = new Array<number>(nItems.length).fill(0);
  const nD = new Array<number>(nItems.length).fill(0);
  const oMatched = new Array<boolean>(O.items.length).fill(false);
  const take = (n: number, o: number, step: 1 | 2 | 3 | 4, d: number): void => {
    nMatch[n] = o;
    nStep[n] = step;
    nD[n] = d;
    oMatched[o] = true;
  };

  // bước 1 và 2: bằng chứng toàn cục (duy nhất ở cả hai phía), chạy trước để không phụ thuộc thứ tự
  const uidCountNew = new Map<string, number>();
  for (const it of nItems) if (it.uid) uidCountNew.set(it.uid, (uidCountNew.get(it.uid) ?? 0) + 1);
  nItems.forEach((n, ni) => {
    if (!n.uid || uidCountNew.get(n.uid) !== 1) return;
    const oi = oldByUid.get(n.uid);
    if (oi === undefined || oMatched[oi]) return;
    const d = distance(n, O.items[oi], diag);
    if (d <= T.uid) take(ni, oi, 1, d);
  });
  const oldById = new Map<string, number>();
  O.items.forEach((it, i) => {
    if (it.id && O.idCount.get(it.id) === 1 && usable.has(it)) oldById.set(it.id, i);
  });
  nItems.forEach((n, ni) => {
    if (nMatch[ni] >= 0 || !n.id || N.idCount.get(n.id) !== 1) return;
    const oi = oldById.get(n.id);
    if (oi === undefined || oMatched[oi]) return;
    const d = distance(n, O.items[oi], diag);
    const auto = isMeaninglessId(n.id) || isMeaninglessId(O.items[oi].id ?? '');
    if (d <= (auto ? T.idAuto : T.id)) take(ni, oi, 2, d);
  });

  // chỉ mục hình học và nhóm anh em
  const oldIndex = new BoxIndex(oldUsable);
  const newIndex = new BoxIndex(nItems);
  const key = (parent: number, tag: string): string => parent + '|' + tag;
  const oldGroups = new Map<string, number[]>();
  O.items.forEach((it, i) => {
    const k = key(it.parent, it.tag);
    const g = oldGroups.get(k);
    if (g) g.push(i);
    else oldGroups.set(k, [i]);
  });
  const newPos = new Array<number>(nItems.length).fill(0); // chỉ số trong anh em cùng thẻ
  {
    const cnt = new Map<string, number>();
    nItems.forEach((it, i) => {
      const k = key(it.parent, it.tag);
      const c = cnt.get(k) ?? 0;
      newPos[i] = c;
      cnt.set(k, c + 1);
    });
  }
  const freeOld = (it: SigItem): boolean => usable.has(it) && !oMatched[oIdx.get(it)!];
  const freeNew = (it: SigItem): boolean => nMatch[nItemIdx.get(it)!] < 0;
  const nItemIdx = new Map<SigItem, number>(nItems.map((it, i) => [it, i]));

  // bước 3 và 4 theo thứ tự tài liệu (cha trước con)
  nItems.forEach((n, ni) => {
    if (nMatch[ni] >= 0) return;
    // bước 3
    const pOld = n.parent >= 0 ? nMatch[n.parent] : -1;
    if (n.parent < 0 || pOld >= 0) {
      const grp = oldGroups.get(key(n.parent < 0 ? -1 : pOld, n.tag));
      const oi = grp?.[newPos[ni]];
      if (oi !== undefined && freeOld(O.items[oi])) {
        const o = O.items[oi];
        const d = distance(n, o, diag);
        const kidsOk = n.tag !== 'g' || n.kids === o.kids;
        if (d <= T.structure && kidsOk) {
          const rivalsOld = oldIndex.query(n, d + T.margin, diag, (x) => x !== o && freeOld(x)).filter((x) => x.d < d + T.margin);
          const rivalsNew = newIndex.query(o, d + T.margin, diag, (x) => x !== n && freeNew(x)).filter((x) => x.d < d + T.margin);
          if (rivalsOld.length === 0 && rivalsNew.length === 0) {
            take(ni, oi, 3, d);
            return;
          }
        }
      }
    }
    // bước 4
    const cands = oldIndex.query(n, T.geometry + T.margin, diag, freeOld).sort((a, b) => a.d - b.d);
    if (cands.length === 0 || cands[0].d > T.geometry) return;
    const best = cands[0];
    if (cands.length > 1 && cands[1].d < best.d + T.margin) return;
    const o = best.it;
    const rev = newIndex.query(o, T.geometry + T.margin, diag, (x) => freeNew(x)).sort((a, b) => a.d - b.d);
    if (rev.length === 0 || rev[0].it !== n) return;
    if (rev.length > 1 && rev[1].d < rev[0].d + T.margin) return;
    take(ni, oIdx.get(o)!, 4, best.d);
  });

  // kết quả
  const nameOf = (it: SigItem): string => it.el.getAttribute('data-mat-name') ?? it.id ?? it.tag;
  const info = (it: SigItem) => ({
    name: nameOf(it),
    hasBinding: !!opt.bound && !!it.uid && opt.bound.has(it.uid),
    hasEvent: !!opt.events && !!it.uid && opt.events.has(it.uid),
  });
  const result: MatchResult = { pairs: [], ambiguous: [], added: [], orphans: [] };
  const candidateOf = new Set<number>();
  nItems.forEach((n, ni) => {
    if (nMatch[ni] >= 0) {
      result.pairs.push({
        newPath: n.path,
        oldUid: O.items[nMatch[ni]].uid!,
        step: nStep[ni] as 1 | 2 | 3 | 4,
        d: nD[ni],
      });
      return;
    }
    // bán kính tăng dần: mọi mục D <= r đã có mặt nên ba mục đầu là ba gần nhất toàn cục
    let c: Array<{ it: SigItem; d: number }> = [];
    for (let r = Math.min(T.candidate, 0.01); ; r = Math.min(T.candidate, r * 4)) {
      c = oldIndex
        .query(n, r, diag, freeOld)
        .sort((a, b) => a.d - b.d || oIdx.get(a.it)! - oIdx.get(b.it)!);
      if (c.length >= T.maxCandidates || r >= T.candidate) break;
    }
    c = c.slice(0, T.maxCandidates);
    if (c.length === 0) {
      result.added.push(n.path);
      return;
    }
    for (const x of c) candidateOf.add(oIdx.get(x.it)!);
    result.ambiguous.push({
      newPath: n.path,
      candidates: c.map((x) => ({ oldUid: x.it.uid!, d: x.d, ...info(x.it) })),
    });
  });
  O.items.forEach((it, i) => {
    if (usable.has(it) && !oMatched[i] && !candidateOf.has(i)) result.orphans.push({ oldUid: it.uid!, ...info(it) });
  });
  return result;
}

/** Đối chiếu hai chuỗi SVG đã làm sạch (bản cũ có `data-mat-uid`; bản mới chưa gán UID, có thể mang UID nguồn). */
export function matchSvg(oldSvg: string, newSvg: string, opt: MatchOptions = {}): MatchResult {
  const o = parseXml(oldSvg);
  const n = parseXml(newSvg);
  if (!o.ok) throw new Error('Bản cũ không đọc được: ' + o.message);
  if (!n.ok) throw new Error('Bản mới không đọc được: ' + n.message);
  return matchTrees(o.root, n.root, opt);
}

/** Ghi UID cuối vào cây (đã gán UID mới): `assign` theo đường dẫn; cập nhật `elements`. */
export function retagUids(root: Element, elements: ElementInfo[], assign: ReadonlyMap<string, string>): void {
  const list = bindablePaths(root);
  if (list.length !== elements.length) throw new Error('elements không khớp cây SVG');
  const remap = new Map<string, string>();
  list.forEach((b, i) => {
    const u = assign.get(b.path);
    if (u === undefined) return;
    remap.set(elements[i].uid, u);
    b.el.setAttribute('data-mat-uid', u);
  });
  for (const e of elements) {
    const nu = remap.get(e.uid);
    if (nu !== undefined) e.uid = nu;
    if (e.parent !== null) e.parent = remap.get(e.parent) ?? e.parent;
  }
}

export interface ApplyMatchResult {
  svg: string;
  elements: ElementInfo[];
  /** Phần tử cũ không được ai nhận (sau lựa chọn). */
  orphans: MatchResult['orphans'];
  /** Đường dẫn các lựa chọn bị từ chối (ngoài ứng viên hoặc trùng UID đã dùng). */
  rejected: string[];
}

/**
 * Áp lựa chọn của người dùng: `choices[newPath]` là UID cũ (một trong các ứng viên) hoặc null ("Mới").
 * Không chọn nghĩa là "Mới". Trả SVG cuối, `elements` và danh sách mồ côi còn lại.
 */
export function applyMatch(
  result: Extract<ImportResult, { ok: true }>,
  choices: Readonly<Record<string, string | null>>,
): ApplyMatchResult {
  const m = result.match;
  if (!m) return { svg: result.svg, elements: result.elements, orphans: [], rejected: [] };
  const parsed = parseXml(result.svg);
  if (!parsed.ok) throw new Error('SVG kết quả không đọc được');
  const used = new Set(m.pairs.map((p) => p.oldUid));
  const assign = new Map<string, string>();
  const rejected: string[] = [];
  for (const a of m.ambiguous) {
    const c = choices[a.newPath];
    if (c === undefined || c === null) continue;
    if (!a.candidates.some((x) => x.oldUid === c) || used.has(c)) {
      rejected.push(a.newPath);
      continue;
    }
    used.add(c);
    assign.set(a.newPath, c);
  }
  const elements = result.elements.map((e) => ({ ...e }));
  let svg = result.svg;
  if (assign.size > 0) {
    retagUids(parsed.root, elements, assign);
    svg = writeSvg(parsed.root);
  }
  const orphans: MatchResult['orphans'] = [...m.orphans];
  const seen = new Set(orphans.map((o) => o.oldUid));
  for (const a of m.ambiguous)
    for (const c of a.candidates)
      if (!used.has(c.oldUid) && !seen.has(c.oldUid)) {
        seen.add(c.oldUid);
        orphans.push({ oldUid: c.oldUid, name: c.name, hasBinding: c.hasBinding, hasEvent: c.hasEvent });
      }
  return { svg, elements, orphans, rejected };
}
