// Nhập bảng ánh xạ của mAT OPC DA Bridge (spec 021 US7, ADR-049) thành Tag external trỏ tới một thiết bị Modbus TCP (máy
// cầu nối). CSV do `mat-opcda-bridge export-csv` sinh: id, type, address, access, qualityAddress, description, unit, opcItem.
// Thêm mới hoặc cập nhật nguồn/kiểu theo tên Tag (không bao giờ xóa); tùy chọn thêm Tag quality `<id>_Q`. Hàm thuần.
import { t } from '../i18n/index.ts';
import { decodeCsvBytes, parseCsv } from './grid/csv.ts';
import type { ProjectEdit } from './project-doc.ts';

const TYPES = new Set(['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32']);
const ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const ADDR_RE = /^(C|HR|IR)[1-9]\d{0,4}$/;
const REQUIRED = ['id', 'type', 'address'] as const;

export interface OpcdaImportOptions {
  /** Mã thiết bị Modbus TCP của máy cầu nối. */
  device: string;
  /** Thêm Tag quality `<id>_Q` (UINT16, IR) cho mỗi item. */
  withQuality: boolean;
}

export interface OpcdaImportPlan {
  edits: ProjectEdit[];
  add: number;
  update: number;
  /** `line` tính cả dòng tiêu đề là 1. */
  errors: { line: number; reason: string }[];
  fatal?: string;
}

interface ExistingTag {
  id?: unknown;
}

export function planOpcdaImport(
  bytes: Uint8Array,
  existing: readonly ExistingTag[],
  opts: OpcdaImportOptions,
): OpcdaImportPlan {
  const plan: OpcdaImportPlan = { edits: [], add: 0, update: 0, errors: [] };
  const { text } = decodeCsvBytes(bytes);
  const rows = parseCsv(text).rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return { ...plan, fatal: 'empty' };
  const head = rows[0].map((h) =>
    h
      .trim()
      .replace(/^\uFEFF/u, '')
      .toLowerCase(),
  );
  const col = (name: string) => head.indexOf(name.toLowerCase());
  for (const r of REQUIRED) if (col(r) < 0) return { ...plan, fatal: `missing column '${r}'` };

  const index = new Map<string, number>();
  existing.forEach((t, i) => typeof t.id === 'string' && index.set(t.id.toLowerCase(), i));
  const seen = new Set<string>();
  const upserts: ProjectEdit[] = [];

  const put = (tag: Record<string, unknown>) => {
    const key = String(tag.id).toLowerCase();
    const at = index.get(key);
    if (at === undefined) {
      plan.add++;
      upserts.push({ kind: 'tagUpsert', tag: tag as never });
    } else {
      plan.update++;
      upserts.push({ kind: 'tagUpsert', index: at, tag: tag as never });
    }
  };

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const get = (name: string) => {
      const c = col(name);
      return c < 0 ? '' : (rows[i][c] ?? '').trim();
    };
    const id = get('id');
    const type = get('type').toUpperCase();
    const address = get('address').toUpperCase();
    const access = get('access').toUpperCase() === 'RW' ? 'RW' : 'R';
    const fail = (reason: string) => plan.errors.push({ line, reason });
    if (!ID_RE.test(id)) {
      fail(`invalid Tag name '${id}'`);
      continue;
    }
    if (seen.has(id.toLowerCase())) {
      fail(`duplicate Tag '${id}'`);
      continue;
    }
    if (!TYPES.has(type)) {
      fail(`unsupported type '${type}'`);
      continue;
    }
    if (!ADDR_RE.test(address)) {
      fail(`invalid address '${address}'`);
      continue;
    }
    seen.add(id.toLowerCase());
    const description = get('description') || (get('opcitem') ? `OPC DA: ${get('opcitem')}` : '');
    const unit = get('unit');
    const tag: Record<string, unknown> = {
      id,
      kind: 'external',
      type,
      ...(description ? { description } : {}),
      ...(unit ? { unit } : {}),
      access: address.startsWith('IR') ? 'R' : access,
      source: { device: opts.device, address },
    };
    put(tag);
    const q = get('qualityaddress').toUpperCase();
    if (opts.withQuality && ADDR_RE.test(q)) {
      const qid = `${id}_Q`;
      seen.add(qid.toLowerCase());
      put({
        id: qid,
        kind: 'external',
        type: 'UINT16',
        description: t('cn.opcda.qualityDesc', { id }),
        access: 'R',
        source: { device: opts.device, address: q },
      });
    }
  }
  if (upserts.length) plan.edits = [{ kind: 'batch', edits: upserts }];
  return plan;
}
