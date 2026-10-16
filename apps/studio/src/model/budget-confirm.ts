// Chặn mềm khi nạp xuống cấu hình lưu trữ vượt ngân sách ghi (feature 010, FR-048, contracts/studio-010.md §1.3). Mô hình
// thuần, không DOM: nhìn `EstimateView` (số từ `estimateLogging`), quyết định có cần xác nhận không, giữ xác nhận cho ĐÚNG
// băm của ước tính (đổi số thì mất), và ghi nhật ký thao tác trong bộ nhớ của Studio (không lưu trong project).
import type { EstimateView } from './estimate-view.ts';

export type BudgetLevel = 'none' | 'soft' | 'extreme';
type OkView = Extract<EstimateView, { state: 'ok' }>;

export interface BudgetGate {
  level: BudgetLevel;
  /** Băm của ước tính; rỗng khi không chặn. */
  hash: string;
  view: OkView | null;
}

/** FNV-1a 32 bit, hex. Đủ để nhận ra "số ước tính đã đổi"; không dùng cho bảo mật. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function estimateHash(view: OkView): string {
  return fnv(
    JSON.stringify([
      view.estimate.writeBytesPerDay,
      view.estimate.storageBytes,
      view.warnings,
      view.groups.map((g) => [g.id, g.totalBytes]),
    ]),
  );
}

/** `W_LOG_WRITE_EXTREME`: gõ lại tên project; `W_LOG_WRITE_BUDGET`/`W_LOG_SIZE_CAP`: xác nhận một nút; còn lại không chặn. */
export function budgetGate(view: EstimateView): BudgetGate {
  if (view.state !== 'ok') return { level: 'none', hash: '', view: null };
  const w = view.warnings;
  const level: BudgetLevel = w.includes('W_LOG_WRITE_EXTREME')
    ? 'extreme'
    : w.includes('W_LOG_WRITE_BUDGET') || w.includes('W_LOG_SIZE_CAP')
      ? 'soft'
      : 'none';
  return { level, hash: level === 'none' ? '' : estimateHash(view), view };
}

/** Ô gõ lại tên project: so khớp chính xác (chỉ bỏ khoảng trắng hai đầu). */
export const nameMatches = (typed: string, projectName: string): boolean =>
  projectName.trim() !== '' && typed.trim() === projectName.trim();

export interface BudgetLogEntry {
  at: number;
  project: string;
  hash: string;
  level: Exclude<BudgetLevel, 'none'>;
  bytesPerDay: number;
}

export class BudgetConfirmations {
  private hash: string | null = null;
  private readonly entries: BudgetLogEntry[] = [];

  /** Băm đã được xác nhận (null: chưa có). */
  get confirmedHash(): string | null {
    return this.hash;
  }

  get log(): readonly BudgetLogEntry[] {
    return this.entries;
  }

  /** Xác nhận cho `gate` đã được nhớ và còn đúng số ước tính hiện tại. */
  isConfirmed(gate: BudgetGate): boolean {
    return gate.level === 'none' || this.hash === gate.hash;
  }

  /** Người dùng xác nhận: nhớ băm và ghi nhật ký. */
  confirm(gate: BudgetGate, project: string, at: number): void {
    if (gate.level === 'none' || !gate.view) return;
    this.hash = gate.hash;
    this.entries.push({
      at,
      project,
      hash: gate.hash,
      level: gate.level,
      bytesPerDay: gate.view.bytesPerDay,
    });
  }
}
