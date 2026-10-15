// Trạng thái làm việc của editor Màn hình 0.3 (feature 007, T112, T121, T132): vùng nhìn từng màn hình (giữ khi đổi tab),
// lưới và bắt dính, clipboard của Studio (không đọc clipboard hệ thống), chế độ xem trước (Tắt, Mô phỏng, Thiết bị) cùng nguồn
// giá trị và nơi chứa hành động tương ứng (model/preview-hosts.ts). Không DOM. Chế độ xem trước khóa chỉnh sửa; chuyển về Tắt
// thì giữ lựa chọn và vùng nhìn.
import type { ValueTable } from '@mat/expression';
import type { Binding04, TagDefinition, TagV1 } from '@mat/project-schema';
import type { ActionHost, TagSource } from '@mat/ui-components';
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
import {
  NOT_ENTERED,
  enterItem,
  exitItem,
  selectUids,
  syncEnter,
  type EnterState,
} from '../model/svg-select.ts';
import { TestStrip } from '../model/test-strip.ts';
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
  leftTab: 'details' | 'layers' | 'elements' = 'details';
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

  // ---------- Vào item svg (feature 008) ----------

  private enter: EnterState = NOT_ENTERED;
  /** Màn hình của item đang vào. */
  private enteredScreen: string | null = null;

  /** Item `svg` đang vào ở màn hình `screen`; `null` khi không vào (hoặc đang vào màn hình khác). */
  enteredItemId(screen: string): string | null {
    return this.enteredScreen === screen ? this.enter.enteredItemId : null;
  }

  /** UID phần tử đang chọn trong item đang vào. */
  get selectedUids(): readonly string[] {
    return this.enter.selectedUids;
  }

  /** Thanh Thử giá trị của item đang vào (feature 008, T073). Dựng lười: cần engine của app. */
  private strip: TestStrip | null = null;
  /** Nhóm đang xem của inspector phần tử SVG (giữ khi chọn phần tử khác). */
  svgTab: 'general' | 'bind' | 'events' | 'security' = 'bind';
  /** Bộ binding đã sao chép (Ctrl+C ở inspector Gắn Tag), dán cho phần tử khác (T074). */
  bindClip: Binding04[] | null = null;
  /** Cây phần tử: nút đã mở và chữ lọc; giữ khi đổi phần tử chọn. */
  treeExpanded = new Set<string>();
  treeFilter = '';
  /** Canvas cấp gốc Shadow DOM của item `svg` đang vào cho cây phần tử và khung chọn. */
  svgRootProvider: ((screen: string, itemId: string) => ShadowRoot | null) | null = null;
  /** Nhảy tới dòng, ô của inspector Gắn Tag (nhấp đúp lỗi ở tab Thông tin); `n` tăng để lặp lại cùng đích. */
  jump: { uid: string; rowId?: string; field: string; n: number } | null = null;
  /** Số lần DOM của item được dựng lại (cây và khung chọn đọc lại). */
  svgRevision = 0;

  get testStrip(): TestStrip {
    return (this.strip ??= new TestStrip(this.app.simulation.engine));
  }

  /** Gốc Shadow DOM của item đang vào; `null` khi chưa vào hoặc chưa dựng. */
  svgRoot(screen: string, itemId: string): ShadowRoot | null {
    return this.svgRootProvider?.(screen, itemId) ?? null;
  }

  /** Báo DOM của item đã dựng hoặc dựng lại. */
  bumpSvg(): void {
    this.svgRevision++;
    this.app.requestRender();
  }

  private syncTestLease(): void {
    this.app.simulation.lease('svg-test', (this.strip?.active.length ?? 0) > 0);
  }

  /** Cho phép thử các Tag này (Tag của binding và sự kiện của item đang vào). */
  allowTest(itemId: string, tagIds: Iterable<string>): void {
    this.testStrip.enter(itemId, tagIds);
  }

  testSet(tagId: string, value: boolean | number | string) {
    const r = this.testStrip.set(tagId, value);
    this.syncTestLease();
    return r;
  }

  testReset(tagId?: string): void {
    if (tagId === undefined) this.testStrip.resetAll();
    else this.testStrip.reset(tagId);
    this.syncTestLease();
    this.app.requestRender();
  }

  /** Tag đang bị đặt giá trị thử. */
  get testActive(): readonly string[] {
    return this.strip?.active ?? [];
  }

  enterSvgItem(screen: string, itemId: string): void {
    this.leaveTest();
    this.enter = enterItem(this.enter, itemId);
    this.enteredScreen = screen;
    this.treeExpanded = new Set();
    this.treeFilter = '';
    this.leftTab = 'elements';
  }

  exitSvgItem(): void {
    this.leaveTest();
    this.enter = exitItem();
    this.enteredScreen = null;
    this.jump = null;
    if (this.leftTab === 'elements') this.leftTab = 'details';
  }

  private leaveTest(): void {
    if (this.strip === null) return;
    this.strip.exit();
    this.syncTestLease();
  }

  setSelectedUids(uids: readonly string[]): void {
    this.enter = selectUids(this.enter, uids);
  }

  /**
   * Chọn phần tử SVG trong item đang vào (canvas, cây phần tử): đặt vùng chọn phần tử và đưa vùng chọn của editor về item
   * (đang chọn Tag ở Details thì inspector trở lại phần tử) rồi vẽ lại.
   */
  pickUids(uids: readonly string[]): void {
    const id = this.enter.enteredItemId;
    this.setSelectedUids(uids);
    if (id !== null && this.enteredScreen !== null) this.app.selectItems(this.enteredScreen, [id]);
    this.app.requestRender();
  }

  /** Vùng chọn item của canvas đổi: item đang vào không còn được chọn thì thoát. */
  syncSvgSelection(itemSelection: readonly string[]): void {
    const next = syncEnter(this.enter, itemSelection);
    if (next !== this.enter) this.exitSvgItem();
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
      const host = new SimActionHost({
        engine: app.simulation.engine,
        source,
        nav,
        user: t('preview.simUser'),
      });
      return { mode, source, host, device: null };
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
    return { mode, source: device, host, device };
  }
}
