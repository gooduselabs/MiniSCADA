// Hiển thị trạng thái kết nối của trang runtime (FR-015): badge, thời điểm cập nhật,
// banner "đầy" có đếm ngược 30 s và nút "Thử lại ngay" (Master Plan §10.2).
import type { ConnState } from '@mat/live-client';

export interface StatusInput {
  state: ConnState;
  retryAt: number | null;
  now: number;
  lastUpdate?: number;
}

export interface StatusModel {
  label: string;
  tone: 'ok' | 'warn' | 'bad';
  banner: { text: string; countdownS: number; canRetry: boolean } | null;
}

export const FULL_MESSAGE = 'Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau.';

export function statusModel(s: StatusInput): StatusModel {
  switch (s.state) {
    case 'live':
      return { label: 'Trực tuyến', tone: 'ok', banner: null };
    case 'offline':
      return { label: 'Mất kết nối — dữ liệu đang hiển thị là cũ', tone: 'bad', banner: null };
    case 'full':
      return {
        label: 'Đầy',
        tone: 'bad',
        banner: {
          text: FULL_MESSAGE,
          countdownS: Math.max(0, Math.ceil(((s.retryAt ?? s.now) - s.now) / 1000)),
          canRetry: true,
        },
      };
    case 'incompatible':
      return {
        label: 'Không tương thích',
        tone: 'bad',
        banner: {
          text: 'Phiên bản giao thức của thiết bị không tương thích với trang này. Tải lại trang sau khi cập nhật.',
          countdownS: 0,
          canRetry: false,
        },
      };
    case 'stopped':
      return { label: 'Đã dừng', tone: 'warn', banner: null };
    default:
      return { label: 'Đang kết nối…', tone: 'warn', banner: null };
  }
}

export interface StatusElements {
  badge: HTMLElement;
  updated: HTMLElement;
  banner: HTMLElement;
  bannerText: HTMLElement;
  bannerCount: HTMLElement;
  retry: HTMLButtonElement;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });

export class StatusView {
  private readonly els: StatusElements;
  constructor(els: StatusElements, onRetry: () => void) {
    this.els = els;
    els.retry.addEventListener('click', () => onRetry());
  }

  render(s: StatusInput): void {
    const m = statusModel(s);
    const { badge, updated, banner, bannerText, bannerCount, retry } = this.els;
    badge.textContent = m.label;
    badge.className = `badge ${m.tone}`;
    if (s.lastUpdate)
      updated.textContent =
        s.state === 'live'
          ? `Cập nhật lúc ${time(s.lastUpdate)}`
          : `Cập nhật cuối ${time(s.lastUpdate)}`;
    banner.hidden = m.banner === null;
    if (m.banner) {
      bannerText.textContent = m.banner.text;
      bannerCount.textContent = m.banner.canRetry ? `Tự thử lại sau ${m.banner.countdownS} s` : '';
      retry.hidden = !m.banner.canRetry;
    }
  }
}
