// Bảng lệnh Ctrl+Shift+P (feature 004, FR-009, contracts/commands.md): mọi lệnh của danh mục cộng lệnh
// mở từng màn hình; tìm theo nhãn, bỏ dấu và không phân biệt hoa thường ("bang tag" khớp "Mở Bảng Tag
// mặc định"). Khớp đầu nhãn xếp trước; lệnh bị khóa vẫn hiện kèm lý do (Enter chỉ hiện lý do).
import { fold, t, type MessageKey } from '../i18n/index.ts';
import { COMMANDS, type CommandContext } from './commands.ts';

export interface PaletteEntry {
  /** Id lệnh; lệnh mở màn hình là `open.screen:{id màn hình}`. */
  id: string;
  label: string;
  shortcut?: string;
  enabled: true | MessageKey;
  /** Lý do đã dịch khi bị khóa. */
  reason?: string;
}

export interface ScreenRef {
  id: string;
  name: string;
}

const entry = (
  id: string,
  label: string,
  enabled: true | MessageKey,
  shortcut?: string,
): PaletteEntry => ({
  id,
  label,
  enabled,
  ...(shortcut ? { shortcut } : {}),
  ...(enabled === true ? {} : { reason: t(enabled) }),
});

/** Các mục của bảng lệnh theo thứ tự danh mục, rồi lệnh mở từng màn hình. */
export function paletteEntries(
  ctx: CommandContext,
  screens: readonly ScreenRef[] = [],
): PaletteEntry[] {
  const screenEnabled = ctx.hasProject || 'reason.noProject';
  return [
    ...COMMANDS.map((c) => entry(c.id, t(c.label), c.enabled(ctx), c.shortcut)),
    ...screens.map((s) =>
      entry(`open.screen:${s.id}`, t('cmd.open.screen', { name: s.name }), screenEnabled),
    ),
  ];
}

const normalize = (q: string): string => fold(q).trim().replace(/\s+/g, ' ');

/** `q` xuất hiện ở đầu một từ của `label` (sau ký tự không phải chữ hoặc số). */
function atWordStart(label: string, q: string): boolean {
  for (let i = label.indexOf(q); i >= 0; i = label.indexOf(q, i + 1))
    if (i === 0 || !/[a-z0-9]/.test(label[i - 1])) return true;
  return false;
}

/**
 * Mức khớp, nhỏ hơn là tốt hơn: 0 khớp đầu nhãn, 1 khớp đầu một từ, 2 khớp giữa từ, 3 các từ của câu
 * tìm đều có nhưng không liền nhau; -1 không khớp.
 */
export function matchRank(label: string, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const l = fold(label);
  if (l.startsWith(q)) return 0;
  if (atWordStart(l, q)) return 1;
  if (l.includes(q)) return 2;
  return q.split(' ').every((w) => l.includes(w)) ? 3 : -1;
}

/**
 * Lọc và xếp theo mức khớp; cùng mức thì lệnh đang bật trước, rồi theo thứ tự danh mục. Câu tìm trống:
 * giữ nguyên thứ tự danh mục.
 */
export function searchPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  if (!normalize(query)) return [...entries];
  return entries
    .map((e, i) => ({ e, i, rank: matchRank(e.label, query) }))
    .filter((x) => x.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank || Number(a.e.enabled !== true) - Number(b.e.enabled !== true) || a.i - b.i,
    )
    .map((x) => x.e);
}
