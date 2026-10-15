// Đường ống nhập SVG (FR-015, FR-021; contract svg-import §1):
// byte → tiền xử lý → parse → đếm thô và độ sâu → nhận diện phần mềm → tên và UID nguồn → CSS → chuẩn hóa (trước)
// → allowlist (@mat/svg-renderer) → chuẩn hóa (sau) → mở `use` đếm hiệu dụng → Tối ưu (tùy chọn) → đếm sau
// → UID và tên → ghi → báo cáo. Thuần: không ném lỗi cho đầu vào xấu (trả `ok: false`).
import { inspectSvg, parseSvg, sanitizeSvg } from '@mat/svg-renderer';
import type { SanitizeReport } from '@mat/svg-renderer';
import { applyCss } from './css.ts';
import { parseXml } from './dom.ts';
import { deriveName } from './name.ts';
import { matchTrees, retagUids } from './match.ts';
import { normalizePost, normalizePre } from './normalize.ts';
import { optimizeSvg } from './optimize.ts';
import { prescan } from './prescan.ts';
import { ReportBuilder, fileNameOf, sha256Hex } from './report.ts';
import type { ReportInit } from './report.ts';
import { DEFAULT_IMPORT_LIMITS } from './types.ts';
import type {
  ImportErrorCode,
  ImportOptions,
  ImportResult,
  MatchResult,
  RemovedKind,
} from './types.ts';
import { assignUids, makeCryptoUid } from './uid.ts';
import { bindablePaths } from './signature.ts';
import { countEffective } from './usecount.ts';
import { writeSvg } from './write.ts';

const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const HEAVY_BYTES = 1024 * 1024;

const ELEMENT_CODES: ReadonlySet<string> = new Set([
  'R_SCRIPT', 'R_FOREIGN', 'R_NAMESPACE', 'R_ELEMENT_NOT_ALLOWED', 'R_SMIL', 'R_META', 'R_FILTER_LIMIT',
]); // prettier-ignore
const IMAGE_CODES: ReadonlySet<string> = new Set([
  'R_IMAGE_LINKED',
  'R_IMAGE_BAD',
  'R_IMAGE_LIMIT',
]);

/** Mã lý do mà bộ lọc sẽ dùng cho một phần tử bị loại theo khóa của `SanitizeReport.removedElements`. */
function codeForRemovedKey(key: string): string {
  if (key === 'script') return 'R_SCRIPT';
  if (key === 'foreignobject') return 'R_FOREIGN';
  if (key.indexOf(':') >= 0) return 'R_NAMESPACE';
  if (key === 'metadata' || key === 'desc') return 'R_META';
  if (['animate', 'animatemotion', 'animatetransform', 'set', 'mpath', 'discard'].includes(key))
    return 'R_SMIL';
  return 'R_ELEMENT_NOT_ALLOWED';
}

function recordSanitize(sr: SanitizeReport, rep: ReportBuilder): void {
  const names = new Map<string, string[]>();
  for (const [key, count] of Object.entries(sr.removedElements)) {
    const code = codeForRemovedKey(key);
    const list = names.get(code) ?? [];
    list.push(count > 1 ? `${key} (x${count})` : key);
    names.set(code, list);
  }
  for (const [code, count] of Object.entries(sr.codes)) {
    let kind: RemovedKind = 'attribute';
    if (ELEMENT_CODES.has(code)) kind = 'element';
    else if (IMAGE_CODES.has(code)) kind = 'image';
    else if (code === 'R_TEXT_LONG') kind = 'element';
    const listed = names.get(code);
    let name: string;
    if (listed) name = [...new Set(listed.map((s) => s.split(' (x')[0]))].sort().join(', ');
    else if (kind === 'image') name = 'image';
    else if (code === 'R_FILTER_LIMIT') name = 'filter';
    else if (code === 'R_FILTER_HEAVY') name = 'stdDeviation';
    else if (code === 'R_TEXT_LONG') name = 'text';
    else name = 'thuộc tính';
    rep.removed(kind, code, name, undefined, count);
  }
  if (sr.unwrapped > 0)
    rep.removed(
      'element',
      'R_ELEMENT_NOT_ALLOWED',
      'a (mở vỏ, giữ phần tử con)',
      undefined,
      sr.unwrapped,
    );
}

/**
 * Chạy lại allowlist trên chuỗi SVG; ném lỗi nếu còn gì để loại. Dùng cho harness và test:
 * "bản đã nhập không còn gì ngoài allowlist".
 */
export function assertAllowlisted(svg: string): void {
  const root = parseSvg(svg);
  const r = sanitizeSvg(root);
  const problems: string[] = [];
  if (Object.keys(r.removedElements).length > 0)
    problems.push('phần tử: ' + Object.keys(r.removedElements).join(','));
  if (r.removedAttributes > 0) problems.push(`${r.removedAttributes} thuộc tính`);
  if (r.removedDataAttributes > 0) problems.push(`${r.removedDataAttributes} data-*`);
  if (r.unwrapped > 0) problems.push('phần tử mở vỏ');
  if (Object.keys(r.codes).length > 0) problems.push('mã: ' + Object.keys(r.codes).join(','));
  if (problems.length > 0) throw new Error('SVG còn phần ngoài allowlist: ' + problems.join('; '));
}

export function importSvg(input: Uint8Array | string, opt: ImportOptions = {}): ImportResult {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...opt.limits };
  const rep = new ReportBuilder();
  const fileName = fileNameOf(opt.fileName ?? 'unnamed.svg');

  // Dữ liệu byte để tính băm; chuỗi quá lớn không mã hóa (đã bị từ chối ở prescan).
  let u8: Uint8Array | null = null;
  if (typeof input === 'string') {
    if (input.length <= limits.maxBytes) u8 = new TextEncoder().encode(input);
  } else u8 = input;
  const bytes = u8 ? u8.length : (input as string).length;
  const file = {
    name: fileName,
    bytes,
    sha256: u8 && bytes <= limits.maxBytes ? sha256Hex(u8) : '',
  };

  const base = (over: Partial<ReportInit> = {}): ReportInit => ({
    file,
    generator: { name: 'không rõ', certainty: 'không rõ', evidence: [] },
    counts: { elementsBefore: 0, elementsAfter: 0, depth: 0, uidAssigned: 0, named: 0 },
    viewBox: null,
    optimize: { enabled: opt.optimize === true, merged: 0, elementsSaved: 0 },
    ...over,
  });
  const fail = (
    code: ImportErrorCode,
    message: string,
    over: Partial<ReportInit> = {},
  ): ImportResult => ({
    ok: false,
    error: { code, message },
    report: rep.build(base(over)),
  });

  // 1-2. byte, mã hóa, DTD, PI
  const pre = prescan(u8 ?? input, limits.maxBytes);
  if (!pre.ok) return fail(pre.code, pre.message);
  for (const t of pre.pis) rep.removed('pi', 'R_PI', t);
  if (pre.dtdRemoved) rep.removed('dtd', 'R_DTD', 'DOCTYPE');
  if (pre.entities > 0)
    rep.converted('C_ENTITY', 'entity namespace Adobe', 'thay bằng URI', pre.entities);

  // 3. parse
  const parsed = parseXml(pre.text);
  if (!parsed.ok) return fail(parsed.code, parsed.message);
  const root = parsed.root;

  // nhập lại: đọc bản cũ, lấy tập UID được phép giữ
  let prevRoot: Element | null = null;
  let prevUids: ReadonlySet<string> | null = null;
  if (opt.previous) {
    const po = parseXml(opt.previous.svg);
    if (!po.ok) return fail('E_IMPORT_PARSE', 'Bản đang dùng không đọc được: ' + po.message);
    prevRoot = po.root;
    prevUids =
      opt.previous.uids ??
      new Set(
        bindablePaths(po.root)
          .map((b) => b.el.getAttribute('data-mat-uid') ?? '')
          .filter((u) => u !== ''),
      );
  }

  // 4. đếm thô và độ sâu (không đệ quy)
  const all: Element[] = [];
  {
    const stack: Array<{ el: Element; depth: number }> = [{ el: root, depth: 1 }];
    while (stack.length > 0) {
      const { el, depth } = stack.pop()!;
      all.push(el);
      if (all.length > limits.rawNodeCap)
        return fail('E_IMPORT_LIMIT', `Quá ${limits.rawNodeCap} phần tử thô`, {
          counts: {
            elementsBefore: all.length,
            elementsAfter: 0,
            depth: 0,
            uidAssigned: 0,
            named: 0,
          },
        });
      if (depth > limits.maxDepth) return fail('E_IMPORT_LIMIT', `Độ sâu vượt ${limits.maxDepth}`);
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i], depth: depth + 1 });
    }
  }
  const elementsBefore = all.length;

  // 5. nhận diện phần mềm (trên cây chưa lọc)
  let generator: ReportInit['generator'] = {
    name: 'không rõ',
    certainty: 'không rõ',
    evidence: [],
  };
  try {
    const ins = inspectSvg(root, pre.text);
    generator = { name: ins.generator, certainty: ins.certainty, evidence: ins.evidence };
  } catch {
    // nhận diện chỉ để báo cáo
  }

  // 6. tên từ nhãn nguồn và bỏ UID nguồn (ADR-003 mục 4: không tin cậy)
  for (const el of all) {
    const srcUid = el.getAttribute('data-mat-uid');
    if (srcUid !== null && !(prevUids && prevUids.has(srcUid))) {
      el.removeAttribute('data-mat-uid');
      rep.removed('attribute', 'R_DATA_ATTR', 'data-mat-uid');
    }
    const label = el.getAttributeNS(INKSCAPE_NS, 'label');
    const dataName = el.getAttribute('data-name');
    if (label || dataName) {
      const d = deriveName({ label, dataName, tag: el.localName, index: 1 });
      if (d.labelled) el.setAttribute('data-mat-name', d.name);
    }
  }

  // 7-9. CSS, chuẩn hóa (trước), allowlist, chuẩn hóa (sau)
  applyCss(root, rep);
  normalizePre(root, rep);
  recordSanitize(sanitizeSvg(root), rep);
  const post = normalizePost(root, rep);
  if (!post.ok) return fail(post.code, post.message, { generator });

  // 10. bom `use`
  const eff = countEffective(root, limits.useExpansionCap);
  if (eff.cycle) return fail('E_IMPORT_USE_BOMB', 'Vòng tham chiếu use', { generator });
  if (eff.total > limits.useExpansionCap)
    return fail(
      'E_IMPORT_USE_BOMB',
      `Số phần tử hiệu dụng sau mở use vượt ${limits.useExpansionCap}`,
      { generator },
    );

  // 11. Tối ưu (tùy chọn)
  let optimize = { enabled: false, merged: 0, elementsSaved: 0 };
  if (opt.optimize === true) optimize = { enabled: true, ...optimizeSvg(root) };

  // 12. đếm sau và độ sâu cuối
  let elementsAfter = 0;
  let maxDepth = 0;
  {
    const stack: Array<{ el: Element; depth: number }> = [{ el: root, depth: 1 }];
    while (stack.length > 0) {
      const { el, depth } = stack.pop()!;
      elementsAfter++;
      if (depth > maxDepth) maxDepth = depth;
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i], depth: depth + 1 });
    }
  }
  if (elementsAfter > limits.maxNodes) {
    const hint = opt.optimize === true ? '' : ' (bật Tối ưu để gộp hình liền kề)';
    return fail(
      'E_IMPORT_LIMIT',
      `Sau chuẩn hóa còn ${elementsAfter} phần tử, vượt ${limits.maxNodes}${hint}`,
      {
        generator,
        counts: { elementsBefore, elementsAfter, depth: maxDepth, uidAssigned: 0, named: 0 },
        optimize,
      },
    );
  }

  // 13-15. UID và tên, ghi, báo cáo
  let match: MatchResult | undefined;
  if (prevRoot && prevUids) {
    match = matchTrees(prevRoot, root, {
      uids: prevUids,
      bound: opt.previous!.bound,
      events: opt.previous!.events,
      thresholds: opt.previous!.thresholds,
    });
  }
  const baseGen = opt.uid ?? makeCryptoUid();
  const gen = prevUids
    ? () => {
        let u = baseGen();
        while (prevUids.has(u)) u = baseGen();
        return u;
      }
    : baseGen;
  const { elements, named } = assignUids(root, gen);
  if (match) retagUids(root, elements, new Map(match.pairs.map((p) => [p.newPath, p.oldUid])));
  if (!elements.some((e) => e.tag !== 'g')) rep.warn('W_IMPORT_NO_DRAWABLE');
  const svg = writeSvg(root);
  if (svg.length >= HEAVY_BYTES) rep.warn('W_IMPORT_HEAVY');
  const report = rep.build({
    file,
    generator,
    counts: { elementsBefore, elementsAfter, depth: maxDepth, uidAssigned: elements.length, named },
    viewBox: post.viewBox,
    optimize,
    match: match
      ? {
          kept: match.pairs.length,
          added: match.added.length,
          ambiguous: match.ambiguous.length,
          orphans: match.orphans.length,
        }
      : undefined,
  });
  return { ok: true, svg, viewBox: post.viewBox, elements, report, ...(match ? { match } : {}) };
}
