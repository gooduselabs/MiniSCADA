// Trạng thái làm việc của editor Màn hình 0.3 (feature 007, T112, T121, T132): vùng nhìn từng màn hình (giữ khi đổi tab),
// lưới và bắt dính, clipboard của Studio (không đọc clipboard hệ thống), chế độ xem trước (Tắt, Mô phỏng, Thiết bị) cùng nguồn
// giá trị và nơi chứa hành động tương ứng (model/preview-hosts.ts). Không DOM. Chế độ xem trước khóa chỉnh sửa; chuyển về Tắt
// thì giữ lựa chọn và vùng nhìn.
import type { ValueTable } from '@mat/expression';
import type { TagDefinition, TagV1 } from '@mat/project-schema';
import type { ActionHost, AlarmSource, TagSource } from '@mat/ui-components';
import { createAlarmPreview, type AlarmPreview } from '../model/alarm-preview.ts';
import { t } from '../i18n/index.ts';
import { isLive } from '../model/device-session.ts';
import { PRIORITY } from '../model/live-subscriptions.ts';
import {
  DeviceActionHost,
  DeviceTagSource,
  SimActionHost,
  SimTagSource,
  type PreviewNav,
} from '../model/preview-hosts.ts';
import { ClipboardStore } from '../model/screen-edit/clipboard.ts';
import { tagInfoOf, type TagInfo } from '../model/screen-catalog.ts';
import type { Viewport } from '../model/screen-edit/viewport.ts';
import type { StudioApp } from './app.ts';

export type PreviewMode = 'off' | 'sim' | 'device';

/** Vùng nhìn đã lưu của một màn hình; `fit`: đang ở "Vừa khung" (đổi cỡ vùng vẽ thì tính lại). */
export interface ScreenView {
  viewport: Viewport;
  fit: boolean;
}

export interface PreviewHosts {
  mode: Exclude<PreviewMode, 'off'>;
  source: TagSource;
  host: ActionHost;
  /** Chỉ chế độ Thiết bị: báo giá trị đổi. */
  device: DeviceTagSource | null;
  /** Nguồn alarm cho widget alarm-list, alarm-count (Mô phỏng: AlarmSim; Thiết bị: sống, chỉ đọc); null: "Không có dữ liệu alarm". */
  alarms: AlarmSource | null;
}

type AnyTag = TagV1 | TagDefinition;

export class ScreenWorkspace {
  /** Ô lưới (đơn vị thiết kế). */
  readonly gridSize = 20;
  grid = true;
  snap = true;
  /** Công cụ của canvas: Chọn hoặc Tay (kéo để cuộn; giữ Space cũng được). */
  tool: 'select' | 'hand' = 'select';
  /** Tab của vùng dưới cây khi mở màn hình 0.3: Details (Tag kéo được) hoặc Lớp. */
  leftTab: 'details' | 'layers' = 'details';
  /** Nhóm đang chọn của inspector item (Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật, Đồ họa). */
  inspTab = 'general';
  /** Con trỏ theo đơn vị thiết kế (thanh trạng thái); không đi qua app.emit vì đổi nhiều lần mỗi giây. */
  pointer: { x: number; y: number } | null = null;
  private readonly pointerListeners = new Set<() => void>();
  readonly clipboard = new ClipboardStore();
  private mode: PreviewMode = 'off';
  private readonly views = new Map<string, ScreenView>();
  private hosts: PreviewHosts | null = null;
  private infoCache: { tags: unknown; map: Map<string, TagInfo> } | null = null;
  /** Màn hình đang xem trước nếu khác màn hình của tab (nút `navigate` đổi); popup đang mở. */
  private nav: { screen: string | null; popup: string | null } = { screen: null, popup: null };
  private readonly app: StudioApp;
  private offValues: (() => void) | null = null;

  constructor(app: StudioApp) {
    this.app = app;
  }

  setPointer(p: { x: number; y: number } | null): void {
    const q = p ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
    if (q?.x === this.pointer?.x && q?.y === this.pointer?.y) return;
    this.pointer = q;
    for (const l of [...this.pointerListeners]) l();
  }

  onPointer(listener: () => void): () => void {
    this.pointerListeners.add(listener);
    return () => void this.pointerListeners.delete(listener);
  }

  // ---------- Vùng nhìn ----------

  view(id: string): ScreenView | undefined {
    return this.views.get(id);
  }

  setView(id: string, v: ScreenView): void {
    this.views.set(id, v);
  }

  forget(id: string): void {
    this.views.delete(id);
  }

  // ---------- TagInfo cho inspector ----------

  /** `TagInfo` của editor (kiểu, quyền, đơn vị, bảng, giới hạn) theo id Tag của project đang mở. */
  tagInfos(): ReadonlyMap<string, TagInfo> {
    const tags = this.app.store.state.outline.tags?.tags;
    if (this.infoCache !== null && this.infoCache.tags === tags) return this.infoCache.map;
    const map = new Map<string, TagInfo>();
    for (const tg of (tags ?? []) as unknown as AnyTag[]) {
      const x = tg as unknown as { id?: unknown; kind?: unknown };
      if (typeof x.id !== 'string') continue;
      // Tag 0.1 (không có `kind`) là Tag mô phỏng chỉ đọc.
      map.set(
        x.id,
        tagInfoOf(
          typeof x.kind === 'string'
            ? (tg as TagV1)
            : ({ ...tg, kind: 'simulation' } as unknown as TagV1),
        ),
      );
    }
    this.infoCache = { tags, map };
    return map;
  }

  // ---------- Xem trước ----------

  get previewMode(): PreviewMode {
    return this.mode;
  }

  get previewNav(): { screen: string | null; popup: string | null } {
    return this.nav;
  }

  /**
   * Đổi chế độ xem trước. Thiết bị chỉ khi phiên đang theo dõi (trả `false` kèm lý do để editor báo); Mô phỏng mượn
   * engine dùng chung (`lease`). Về Tắt thì nhả mọi thứ đã mượn.
   */
  setPreview(mode: PreviewMode): { ok: true } | { ok: false; reason: string } {
    const app = this.app;
    if (mode === 'device' && !isLive(app.session.state))
      return { ok: false, reason: t('preview.deviceLocked') };
    if (mode === this.mode) return { ok: true };
    this.release();
    this.mode = mode;
    this.nav = { screen: null, popup: null };
    if (mode !== 'off') this.hosts = this.build(mode);
    return { ok: true };
  }

  /** Nguồn và nơi chứa của chế độ hiện tại; `null` khi đang chỉnh sửa. */
  previewHosts(): PreviewHosts | null {
    if (this.mode === 'off') return null;
    // Phiên rớt giữa lúc xem trước bằng Thiết bị: giữ chế độ, nguồn báo `stale` (giá trị STALE, điều khiển khóa).
    return this.hosts;
  }

  /** Nhả mọi thứ đã mượn (đóng project, đóng editor). */
  release(): void {
    this.offValues?.();
    this.offValues = null;
    this.alarmPreview?.stop();
    this.alarmPreview = null;
    this.app.session.alarms.want(false);
    this.app.simulation.lease('screen-preview', false);
    this.app.live.release('screen-preview');
    this.hosts = null;
    this.mode = 'off';
    this.nav = { screen: null, popup: null };
  }

  /** Editor báo tập Tag của màn hình đang xem để xin thiết bị gửi (ưu tiên màn hình đang xem). */
  declareTags(ids: readonly string[]): void {
    if (this.mode === 'device') this.app.live.declare('screen-preview', ids, PRIORITY.preview);
  }

  private navigation(): PreviewNav {
    return {
      navigate: (id) => {
        this.nav = { screen: id, popup: null };
        this.app.requestRender();
      },
      openPopup: (id) => {
        this.nav = { ...this.nav, popup: id };
        this.app.requestRender();
      },
      closePopup: () => {
        this.nav = { ...this.nav, popup: null };
        this.app.requestRender();
      },
    };
  }

  private alarmPreview: AlarmPreview | null = null;

  private build(mode: 'sim' | 'device'): PreviewHosts {
    const app = this.app;
    const tags = (): readonly AnyTag[] =>
      (app.store.state.outline.tags?.tags ?? []) as unknown as AnyTag[];
    const tables = (): readonly ValueTable[] =>
      app.store.state.outline.valueTables.flatMap((v) =>
        v.doc ? [v.doc as unknown as ValueTable] : [],
      );
    const nav = this.navigation();
    if (mode === 'sim') {
      app.simulation.lease('screen-preview', true);
      const source = new SimTagSource({ engine: app.simulation.engine, tags, tables });
      this.alarmPreview = createAlarmPreview(
        app.store.state.outline,
        app.store.state.issues,
        tables() as unknown as ValueTable[],
      );
      const host = new SimActionHost({
        engine: app.simulation.engine,
        source,
        nav,
        user: t('preview.simUser'),
        alarms: this.alarmPreview?.actions ?? null,
      });
      return { mode, source, host, device: null, alarms: this.alarmPreview?.source ?? null };
    }
    const device = new DeviceTagSource({
      tags,
      tables,
      values: () => app.session.values,
      unknown: () => app.session.unknown,
      connection: () =>
        isLive(app.session.state) ? 'live' : app.session.state === 'lost' ? 'stale' : 'offline',
    });
    const host = new DeviceActionHost({
      flow: app.writes.flow,
      online: () => isLive(app.session.state) && app.session.state !== 'relogin',
      session: () => {
        const a = app.session.auth;
        return a ? { user: a.user, role: a.role } : null;
      },
      notOnlineMessage: t('preview.deviceLocked'),
      nav,
      requestLogin: () => app.run('online.login').then(() => undefined) as unknown as void,
    });
    this.offValues = app.subscribeValues((ids) => device.notify(ids));
    app.session.alarms.want(true);
    return { mode, source: device, host, device, alarms: app.session.alarms };
  }
}
