// Thêm hàng loạt Tag ngoài (feature 006, T124, FR-045, US1-11): tạo N Tag với tên tăng số và địa chỉ tăng theo bước (mặc
// định bằng số thanh ghi của kiểu). Kết quả là MỘT sửa đổi `batch` để hoàn tác một lần. Hàm thuần.
import { parseAddress, parseMcAddress, type TagDataType } from '@mat/tag-codec';
import { mcDefaultStep, mcStepAddress } from '../mc.ts';
import type { ScanGroupName, TagV1 } from '@mat/project-schema';
import type { MessageKey } from '../../i18n/index.ts';
import { defaultStep, stepAddress, MAX_TAG_ROWS, type DeviceInfo } from '../tag-table.ts';
import type { ProjectEdit } from '../project-doc.ts';
import { nextTagId } from '../tag-ids.ts';
import { batchOf } from './batch.ts';

export interface BulkAddParams {
  count: number;
  /** Tên của Tag đầu; các Tag sau tăng nhóm số cuối (hoặc thêm `_1`). */
  namePattern: string;
  /** Địa chỉ bắt đầu. */
  address: string;
  /** Bước địa chỉ; `null`: bằng số thanh ghi của kiểu. */
  step: number | null;
  type: TagDataType;
  device: string;
  scanGroup: ScanGroupName;
  /** Bắt buộc với STRING (byte). */
  stringLength?: number;
}

export interface BulkAddContext {
  /** Tên Tag đã có trong project. */
  existing: readonly string[];
  devices: readonly DeviceInfo[];
  /** Số Tag hiện có. */
  total: number;
}

export interface BulkAddError {
  field: 'count' | 'namePattern' | 'address' | 'step' | 'device' | 'stringLength';
  reason: MessageKey;
  params?: Record<string, string | number>;
}

export interface BulkAddPlan {
  tags: TagV1[];
  edits: ProjectEdit[];
  errors: BulkAddError[];
  /** Tên và địa chỉ từng Tag sẽ tạo (cho xem trước). */
  preview: Array<{ id: string; address: string }>;
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export function planBulkAdd(p: BulkAddParams, ctx: BulkAddContext): BulkAddPlan {
  const errors: BulkAddError[] = [];
  const fail = (e: BulkAddError) => void errors.push(e);
  const empty = (): BulkAddPlan => ({ tags: [], edits: [], errors, preview: [] });

  if (!Number.isInteger(p.count) || p.count < 1) fail({ field: 'count', reason: 'tt.bulk.count' });
  else if (ctx.total + p.count > MAX_TAG_ROWS)
    fail({
      field: 'count',
      reason: 'tt.bulk.limit',
      params: { max: MAX_TAG_ROWS, room: Math.max(0, MAX_TAG_ROWS - ctx.total) },
    });
  const pattern = p.namePattern.trim();
  if (pattern.length > 64 || !ID_RE.test(pattern))
    fail({ field: 'namePattern', reason: 'tt.bulk.pattern' });
  if (!ctx.devices.some((d) => d.id === p.device))
    fail({ field: 'device', reason: 'tt.bulk.device' });
  if (p.type === 'STRING' && !(p.stringLength && p.stringLength >= 1 && p.stringLength <= 250))
    fail({ field: 'stringLength', reason: 'tt.bulk.stringLength' });
  const start = p.address.trim().toUpperCase();
  const dev = ctx.devices.find((d) => d.id === p.device);
  // feature 017: thiết bị của kênh Mitsubishi MC đọc địa chỉ theo ngữ pháp MC (D100, X1F…)
  const mc = dev?.channelKind === 'mc';
  const first = mc
    ? parseMcAddress(start, {
        rawType: p.type,
        stringLength: p.stringLength,
        xyNotation: dev?.xyNotation,
      })
    : parseAddress(start, {
        addressBase: dev?.addressBase ?? 0,
        rawType: p.type,
        stringLength: p.stringLength,
      });
  if (!first.ok) fail({ field: 'address', reason: 'tt.bulk.address' });
  if (p.step !== null && (!Number.isInteger(p.step) || p.step < 1))
    fail({ field: 'step', reason: 'tt.bulk.step' });
  if (errors.length) return empty();

  const per = p.step ?? (mc ? mcDefaultStep : defaultStep)(start, p.type, p.stringLength);
  const taken = new Set(ctx.existing);
  const tags: TagV1[] = [];
  const preview: BulkAddPlan['preview'] = [];
  let id = pattern;
  for (let i = 0; i < p.count; i++) {
    if (i > 0) id = nextTagId(id);
    if (taken.has(id)) {
      fail({ field: 'namePattern', reason: 'tt.bulk.nameTaken', params: { id } });
      return empty();
    }
    const address =
      i === 0
        ? start
        : mc
          ? mcStepAddress(start, per, i, dev?.xyNotation)
          : stepAddress(start, per, i);
    const check = !address
      ? null
      : mc
        ? parseMcAddress(address, {
            rawType: p.type,
            stringLength: p.stringLength,
            xyNotation: dev?.xyNotation,
          })
        : parseAddress(address, {
            addressBase: dev?.addressBase ?? 0,
            rawType: p.type,
            stringLength: p.stringLength,
          });
    if (!address || !check?.ok) {
      fail({ field: 'address', reason: 'tt.bulk.addressRange', params: { id } });
      return empty();
    }
    taken.add(id);
    const source: NonNullable<TagV1['source']> = { device: p.device, address };
    if (p.scanGroup !== 'normal') source.scanGroup = p.scanGroup;
    if (p.type === 'STRING') source.stringLength = p.stringLength;
    tags.push({ id, kind: 'external', type: p.type, source });
    preview.push({ id, address });
  }
  return {
    tags,
    edits: batchOf(tags.map((tag): ProjectEdit => ({ kind: 'tagUpsert', tag }))),
    errors,
    preview,
  };
}
