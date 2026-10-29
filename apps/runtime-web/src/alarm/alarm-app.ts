// Ghép alarm vào trang vận hành (feature 009, FR-055 đến FR-059, FR-066; contracts/ui-alarm.md §6, §9, §11): nguồn alarm trên kết nối
// live DUY NHẤT của trang, chuông và bảng thông báo ở thanh trên (feature 026; kiosk: chuông nổi ở góc), huy hiệu menu, tiền tố tiêu đề tab, vùng đọc, âm thanh, trang Alarm
// và trang Lịch sử. main.ts chỉ tạo `AlarmApp` và gọi `showSystem`/`hideSystem` theo route.
import type { AlarmSource, ActionHost } from '@mat/ui-components';
import type { ConnState, LiveConnection } from '@mat/live-client';
import { vi } from '../i18n/vi.ts';
import type { AlarmMenuOptions } from '../menu.ts';
import { AlarmPage, injectAlarmPanelCss } from './alarm-page.ts';
import { LiveAlarmSource } from './alarm-client.ts';
import { TabTitle, applyBadge, badgeModel } from './badge.ts';
import { AlarmAnnouncer } from './announcer.ts';
import { AlarmBell } from './bell.ts';
import { HistoryPage } from './history-page.ts';
import { AlarmSound } from './sound.ts';

export interface AlarmAppDeps {
  conn: LiveConnection;
  onState: (fn: (s: ConnState) => void) => () => void;
  now: () => number;
  host: ActionHost;
  /** Nơi đặt trang Alarm và Lịch sử (vùng màn hình). */
  pageHost: HTMLElement;
  /** Nơi đặt chuông cảnh báo (thanh trên). */
  bellHost: HTMLElement;
  /** Khung menu: tìm huy hiệu `[data-badge="alarms"]` mỗi lần cập nhật. */
  navHost: HTMLElement;
  /** Menu cần dựng lại vì có/không có mục alarm (status đổi giữa none, unsupported, còn lại). */
  onMenuMode: (m: AlarmMenuOptions) => void;
  /** Feature 030: `navigation.alarmBell` của project (false: ẩn chuông và toast). Thiếu = true. */
  bell?: boolean;
  /** Feature 041: "Xem tất cả alarm" của chuông (main.ts chọn màn hình có Bảng alarm hoặc #/alarms). Vắng: #/alarms. */
  viewAll?: () => void;
  doc?: Document;
}

export type SystemPage = 'alarms' | 'alarm-history';

const must = <T extends HTMLElement>(doc: Document, id: string): T => {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`missing #${id} in index.html`);
  return e as T;
};

export class AlarmApp {
  readonly alarms: LiveAlarmSource;
  readonly bell: AlarmBell;
  readonly sound: AlarmSound;
  readonly page: AlarmPage;
  readonly history: HistoryPage;
  readonly #d: AlarmAppDeps;
  readonly #announcer: AlarmAnnouncer;
  readonly #title: TabTitle;
  readonly #soundBox: HTMLElement;
  readonly #soundBtn: HTMLButtonElement;
  readonly #soundHint: HTMLElement;
  readonly #muteBtn: HTMLButtonElement;
  readonly #float: HTMLElement;
  #menuKey = '';

  constructor(d: AlarmAppDeps) {
    this.#d = d;
    const doc = d.doc ?? document;
    this.alarms = new LiveAlarmSource({ conn: d.conn, onState: d.onState, now: d.now });
    const src: AlarmSource = this.alarms;

    injectAlarmPanelCss(doc);
    this.page = new AlarmPage({ source: src, host: d.host, doc });
    this.history = new HistoryPage({ source: src });
    d.pageHost.append(this.page.el, this.history.el);

    const status = doc.createElement('div');
    const alert = doc.createElement('div');
    status.className = alert.className = 'sr-only';
    doc.body.append(status, alert);
    this.#announcer = new AlarmAnnouncer({ status, alert });
    this.#title = new TabTitle(doc);

    this.sound = new AlarmSound();
    this.#soundBox = must(doc, 'app-sound');
    this.#soundBtn = must<HTMLButtonElement>(doc, 'app-sound-btn');
    this.#soundHint = must(doc, 'app-sound-hint');
    this.#muteBtn = must<HTMLButtonElement>(doc, 'app-sound-mute');
    this.bell = new AlarmBell({
      source: src,
      host: d.host,
      soundEl: this.#soundBox,
      navigate:
        d.viewAll ??
        (() => {
          location.hash = '#/alarms';
        }),
      enabled: d.bell !== false,
      doc,
    });
    d.bellHost.append(this.bell.el);
    this.#float = doc.createElement('div');
    this.#float.className = 'al-bell-float';
    this.#float.hidden = true;
    doc.body.append(this.#float);
    this.#soundBtn.addEventListener('click', () => void this.sound.toggle());
    this.#muteBtn.addEventListener('click', () => this.sound.mute());
    this.#muteBtn.textContent = vi.alarm.sound.mute;
    // Chrome chỉ cho phát sau thao tác người dùng: mọi thao tác đầu tiên khôi phục âm thanh đã bật từ lần trước.
    const unlock = (): void => void this.sound.unlock();
    doc.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    doc.addEventListener('keydown', unlock, { capture: true, passive: true });
    this.sound.subscribe(() => this.#renderSound());

    this.alarms.subscribe(() => this.#update());
    if (typeof MutationObserver !== 'undefined')
      new MutationObserver(() => this.#applyBadge()).observe(d.navHost, { childList: true });
  }

  start(): void {
    this.alarms.start();
    this.#update();
  }

  /** Gọi khi phiên đổi: khóa nút tính lại. */
  refreshSession(): void {
    this.bell.refresh();
    this.page.refresh();
    this.alarms.refresh();
  }

  /** Kiosk (?kiosk=1): thanh trên ẩn nên chuông nổi ở góc trên phải. */
  setKiosk(on: boolean): void {
    this.#float.hidden = !on;
    (on ? this.#float : this.#d.bellHost).append(this.bell.el);
  }

  showSystem(id: SystemPage): void {
    this.page.el.hidden = true;
    this.history.el.hidden = true;
    if (id === 'alarms') this.page.show();
    else this.history.show();
    this.#d.pageHost.dataset.system = id;
  }

  hideSystem(): void {
    this.page.hide();
    this.history.hide();
    delete this.#d.pageHost.dataset.system;
  }

  #update(): void {
    const snap = this.alarms.snapshot();
    const status = this.alarms.status();
    this.bell.refresh();
    this.#announcer.update(snap, status);
    this.sound.update(snap, status);
    this.#applyBadge();
    this.#title.set(status === 'live' || status === 'stale' ? snap.counts.unack : 0);
    const menu: AlarmMenuOptions = {
      show: status !== 'none' && status !== 'offline',
      unsupported: status === 'unsupported',
    };
    const key = `${menu.show}|${menu.unsupported}`;
    if (key !== this.#menuKey) {
      this.#menuKey = key;
      this.#d.onMenuMode(menu);
    }
    this.#renderSound();
  }

  /** Huy hiệu ở mục Alarm của menu (menu dựng lại thì áp lại). */
  #applyBadge(): void {
    const m = badgeModel(this.alarms.snapshot(), this.alarms.status());
    for (const b of this.#d.navHost.querySelectorAll<HTMLElement>('[data-badge="alarms"]'))
      applyBadge(b, m);
  }

  /** Nút Âm thanh: chỉ có khi project có alarm; chỉ báo khi cần tiếng mà chưa bật được; "Tắt tiếng" khi đang kêu. */
  #renderSound(): void {
    const status = this.alarms.status();
    const has = status !== 'none' && status !== 'unsupported' && status !== 'offline';
    this.#soundBox.hidden = !has;
    const on = this.sound.state === 'on';
    this.#soundBtn.setAttribute('aria-pressed', String(this.sound.state !== 'off'));
    this.#soundBtn.textContent =
      on || this.sound.state === 'suspended' ? vi.alarm.sound.on : vi.alarm.sound.off;
    const hint = this.sound.hintVisible();
    this.#soundHint.hidden = !hint;
    this.#soundHint.textContent =
      this.sound.state === 'suspended' ? vi.alarm.sound.hintSuspended : vi.alarm.sound.hintOff;
    this.#muteBtn.hidden = this.sound.playing === 'none';
  }
}
