// Biểu tượng alarm (contracts/ui-alarm.md §5): hình riêng từng mức ưu tiên và từng trạng thái, nội tuyến SVG, không tài
// nguyên ngoài. Dữ liệu đường vẽ dùng chung: Lit (`alarmIcon`) cho bảng/widget, DOM thuần (`createAlarmIcon`) cho banner.
// Hình luôn đi kèm chữ (FR-058: màu và hình không là tín hiệu duy nhất); `aria-hidden`.
import { svg, type TemplateResult } from 'lit';

export type AlarmIconName =
  | 'prio-critical'
  | 'prio-major'
  | 'prio-minor'
  | 'prio-advisory'
  | 'state-active-unack'
  | 'state-active-ack'
  | 'state-rtn-unack'
  | 'state-shelved'
  | 'state-disabled'
  | 'sound-off'
  | 'sound-on';

/** `fill`: tô bằng màu hiện hành; `stroke`: nét; `cut`: nét màu nền (khoét trên hình tô). */
export interface AlarmIconShape {
  d: string;
  mode: 'fill' | 'stroke' | 'cut';
}

const BELL = 'M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0';

export const ALARM_ICONS: Readonly<Record<AlarmIconName, readonly AlarmIconShape[]>> = {
  'prio-critical': [
    { d: 'M12 3l10 18H2z', mode: 'fill' },
    { d: 'M12 9.5v5M12 17.5h.01', mode: 'cut' },
  ],
  'prio-major': [{ d: 'M12 2l9 10-9 10-9-10z', mode: 'fill' }],
  'prio-minor': [{ d: 'M12 3a9 9 0 100 18 9 9 0 000-18z', mode: 'fill' }],
  'prio-advisory': [
    { d: 'M4 4h16v16H4z', mode: 'stroke' },
    { d: 'M12 11v6M12 7.5h.01', mode: 'stroke' },
  ],
  'state-active-unack': [{ d: BELL, mode: 'fill' }],
  'state-active-ack': [
    { d: BELL, mode: 'fill' },
    { d: 'M9 12l2 2 4-4', mode: 'cut' },
  ],
  'state-rtn-unack': [
    { d: BELL, mode: 'stroke' },
    { d: 'M4 4l16 16', mode: 'stroke' },
    { d: 'M10.5 9.5a1.5 1.5 0 113 0c0 1-1.5 1.2-1.5 2.5M12 14.5h.01', mode: 'stroke' },
  ],
  'state-shelved': [{ d: 'M7 3h10M7 21h10M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4', mode: 'stroke' }],
  'state-disabled': [{ d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8', mode: 'stroke' }],
  'sound-off': [{ d: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6', mode: 'stroke' }],
  'sound-on': [
    { d: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12', mode: 'stroke' },
  ],
};

/** Mô-đun `<svg>` Lit cho template của bảng và widget. */
export function alarmIcon(name: AlarmIconName, size = 16): TemplateResult {
  const shapes = ALARM_ICONS[name];
  return svg`<svg class="al-ic" viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true" focusable="false"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes.map((s) =>
      s.mode === 'fill'
        ? svg`<path d=${s.d} fill="currentColor" stroke="none"></path>`
        : s.mode === 'cut'
          ? svg`<path d=${s.d} fill="none" stroke="var(--mat-surface, #fff)"></path>`
          : svg`<path d=${s.d} fill="none" stroke="currentColor"></path>`,
    )}</svg>`;
}

const NS = 'http://www.w3.org/2000/svg';

/** Cùng biểu tượng dựng bằng DOM (banner, menu của trang runtime; không HTML thô). */
export function createAlarmIcon(
  name: AlarmIconName,
  size = 16,
  doc: Document = document,
): SVGSVGElement {
  const el = doc.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', 'al-ic');
  for (const s of ALARM_ICONS[name]) {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', s.d);
    p.setAttribute('fill', s.mode === 'fill' ? 'currentColor' : 'none');
    p.setAttribute(
      'stroke',
      s.mode === 'fill' ? 'none' : s.mode === 'cut' ? 'var(--mat-surface, #fff)' : 'currentColor',
    );
    el.append(p);
  }
  return el;
}
