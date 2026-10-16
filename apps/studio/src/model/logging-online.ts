// Số đo thực của thiết bị cho editor Lưu trữ (feature 010, T123, FR-047, FR-049; contracts/device-010.md §1,
// studio-010.md §1.2 và §4). Mọi số lấy từ khối `historian` của `system/info` (phiên thiết bị đã hỏi mỗi 5 s). Hàm thuần.
import type { LoggingConfig } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import type { DeviceInfo } from './device.ts';
import { displayModeOf } from './logging-doc.ts';
import { sizeText } from './size-text.ts';

export type IoSource = 'proc-self-io' | 'sqlite-vfs';

const ioSourceOf = (v: unknown): IoSource | null =>
  v === 'proc-self-io' || v === 'sqlite-vfs' ? v : null;

export interface LoggingMeasure {
  /** `io.bytesPerDay`: ghi của cả tiến trình runtime (null khi chưa đủ 600 s hoặc không đọc được /proc/self/io). */
  bytesPerDay: number | null;
  /** `io.source`: `proc-self-io` (kernel, cả tiến trình) hoặc `sqlite-vfs` (byte ghi đếm ở lớp SQLite, ADR-039); null = không rõ. */
  source: IoSource | null;
  estimateBytesPerDay: number | null;
  /** Số dòng thô 24 giờ theo id nhóm. */
  rows24h: Map<string, number>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Số đo của thiết bị; `null` khi thiết bị không báo gì dùng được (runtime cũ, chưa đủ số đo). */
export function measureOf(info: DeviceInfo | null | undefined): LoggingMeasure | null {
  const h = info?.historian;
  if (!h || typeof h !== 'object') return null;
  const io = h.io && typeof h.io === 'object' ? h.io : undefined;
  const bytesPerDay = num(io?.bytesPerDay);
  const rows24h = new Map<string, number>();
  if (Array.isArray(h.groupsInfo))
    for (const g of h.groupsInfo) {
      const rows = num(g?.rows24h);
      if (typeof g?.id === 'string' && rows !== null && rows >= 0) rows24h.set(g.id, rows);
    }
  if (bytesPerDay === null && rows24h.size === 0) return null;
  return {
    bytesPerDay,
    source: ioSourceOf(io?.source),
    estimateBytesPerDay: num(io?.estimateBytesPerDay),
    rows24h,
  };
}

/**
 * "Dùng số đo": điền `expectedRowsPerDay` của từng nhóm Thay đổi, Kết hợp, Kích hoạt bằng `rows24h` (làm tròn, ≥ 1). Nhóm chu
 * kỳ không có trường này; nhóm thiết bị không báo thì giữ nguyên. Không đổi gì thì trả đúng `cfg` ban đầu.
 */
export function applyMeasure(
  cfg: LoggingConfig,
  measure: LoggingMeasure,
): { cfg: LoggingConfig; changed: number } {
  let changed = 0;
  const groups = cfg.groups.map((g) => {
    if (displayModeOf(g) === 'cyclic') return g;
    const rows = measure.rows24h.get(g.id);
    if (rows === undefined) return g;
    const n = Math.max(1, Math.round(rows));
    if (g.expectedRowsPerDay === n) return g;
    changed++;
    return { ...g, expectedRowsPerDay: n };
  });
  return changed === 0 ? { cfg, changed } : { cfg: { ...cfg, groups }, changed };
}

const INT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** Các dòng tóm tắt lưu trữ của tab Thiết bị (ngoài dòng của 003/005); rỗng khi thiết bị chưa báo khối mới. */
export function historianLines(info: DeviceInfo | null | undefined): string[] {
  const h = info?.historian;
  if (!h || typeof h !== 'object') return [];
  const out: string[] = [];
  const real = num(h.io?.bytesPerDay);
  if (real !== null) {
    const est = num(h.io?.estimateBytesPerDay);
    const vfs = ioSourceOf(h.io?.source) === 'sqlite-vfs';
    out.push(
      est === null
        ? t(vfs ? 'hist.dev.ioVfs' : 'hist.dev.io', { real: sizeText(real) })
        : t(vfs ? 'hist.dev.ioVfsVsEst' : 'hist.dev.ioVsEst', {
            real: sizeText(real),
            est: sizeText(est),
          }),
    );
  }
  const q = h.query;
  if (q && typeof q === 'object' && num(q.served) !== null) {
    out.push(
      t('hist.dev.query', {
        served: INT.format(q.served!),
        busy: INT.format(num(q.rejectedBusy) ?? 0),
        limit: INT.format(num(q.rejectedLimit) ?? 0),
        p95: num(q.p95Ms) === null ? t('hist.dash') : `${INT.format(q.p95Ms!)} ms`,
      }),
    );
  }
  const a = h.aggregates;
  if (a && typeof a === 'object' && a.enabled) {
    const bf = a.backfill;
    if (bf && typeof bf === 'object' && bf.active) {
      const p = num(bf.progress);
      out.push(
        t('hist.dev.backfill', {
          group: typeof bf.group === 'string' ? bf.group : t('hist.dash'),
          pct: p === null ? t('hist.dash') : `${INT.format(p * 100)} %`,
        }),
      );
    }
    const m = num(a.rows?.minute);
    const hr = num(a.rows?.hour);
    if (m !== null || hr !== null)
      out.push(
        t('hist.dev.aggRows', {
          minute: m === null ? t('hist.dash') : INT.format(m),
          hour: hr === null ? t('hist.dash') : INT.format(hr),
        }),
      );
  }
  return out;
}
