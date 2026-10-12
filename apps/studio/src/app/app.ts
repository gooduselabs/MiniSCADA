// Bộ điều khiển giao diện của Studio (feature 004, US1, data-model §1, §6, §8, contracts/commands.md).
// Nối store (project, sửa, kiểm tra, lưu), không gian làm việc (bố cục, theme), phiên thiết bị và danh
// mục lệnh; giữ trạng thái giao diện không thuộc project: cây (mở/chọn), tab inspector, hộp thoại, bảng
// lệnh, thông báo ngắn. Logic thuần, không DOM; thành phần ui/* đăng ký nghe và gọi hành động ở đây.
// Feature 005 (US1): lớp DeviceLink (lệnh Rust) cho phiên thiết bị, tìm thiết bị, thiết bị đã lưu; ba hộp
// thoại Online (Thiết bị trong mạng, xác nhận chứng chỉ, đăng nhập) mở theo trạng thái của phiên. T085a
// (FR-031): mỗi project gắn một thiết bị đã lưu (thiết lập cục bộ, không ghi vào project); Ctrl+K và nút
// Online kết nối tới thiết bị đó, chưa gắn thì mở Thiết bị trong mạng.
import type { Issue } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import { monitorFetch, monitorSocket } from '../model/device-adapters.ts';
import { DeviceSession, type SessionState } from '../model/device-session.ts';
import { normalizeHttps, normalizeMonitor, parsePort, type FetchFn } from '../model/device.ts';
import { DiscoveryScan, type DeviceRow } from '../model/discovery.ts';
import { locate, severityOf, type Location } from '../model/issue-map.ts';
import {
  ancestorsOf,
  buildTree,
  DEFAULT_EXPANDED,
  findByEditor,
  findNode,
  type EditorId,
  type TreeNode,
} from '../model/tree.ts';
import { upgradeErrorText } from '../ui/dialogs/upgrade-dialog.ts';
import { deviceErrorText } from './device-errors.ts';
import { compareErrorText, uploadErrorText } from './compare-text.ts';
import { AuditFeed } from '../model/audit-feed.ts';
import { DiagnosticsFeed } from '../model/diagnostics-feed.ts';
import { DriverDiagFeed } from '../model/driver-diag.ts';
import { CompareController } from './compare.ts';
import { DeployController } from './deploy.ts';
import {
  deviceError,
  isDeviceError,
  type DeviceError,
  type DeviceLink,
  type KnownDevice,
  type NetInterface,
} from '../platform/device-types.ts';
import type { AppInfo, Platform, RecentEntry, WriteFailure } from '../platform/types.ts';
import { commandById, type CommandContext, type CommandId } from './commands.ts';
import { refOfNode } from '../model/tree.ts';
import { ConnectionProbe, SerialPortsLoader, portsGate, probeGate } from '../model/connections.ts';
import { WriteController } from './write-controller.ts';
import { SimController } from './sim-controller.ts';
import type { SimEngineOptions } from '../model/sim-engine.ts';
import { planSimWrite, type DeviceTagDef, type WriteRowInput } from '../model/write-flow.ts';
import type { LiveValue } from '../model/device-session.ts';
import { LiveSubscriptions, MAX_SUBSCRIBED, PRIORITY } from '../model/live-subscriptions.ts';
import { loadColumnChoice, saveColumnChoice, type ColumnChoice } from '../model/tag-table.ts';
import { treeAdd, treeDuplicate, treeRemove, treeRename } from './tree-commands.ts';
import { DeviceBindings } from './device-binding.ts';
import { saveNotice } from './save-policy.ts';
import { StudioStore, type SaveResult, type Selection, type UiContext } from './store.ts';
import {
  clampLayout,
  loadWorkspace,
  resetLayout,
  saveWorkspace,
  type StorageLike,
  type TaskCard,
  type Theme,
  type Workspace,
} from './workspace.ts';

export type InspectorTab = 'props' | 'info' | 'diag';

/** Hộp thoại của 004 (mat-dialog vẽ theo `kind`, trả lời bằng `answer`). */
export type CoreDialogSpec =
  | { kind: 'unsaved'; files: readonly string[] }
  | { kind: 'conflict'; rel: string }
  | { kind: 'saveError'; rel: string; reason: string }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  /** Online và Mô phỏng không chạy cùng lúc: hỏi trước khi chuyển (FR-052). `to` là chế độ sắp bật. */
  | { kind: 'simSwitch'; to: 'sim' | 'online' };

/**
 * Hộp thoại Online của feature 005 (ui/dialogs/*): Thiết bị trong mạng, xác nhận chứng chỉ, đăng nhập. Mở theo
 * lệnh và theo trạng thái của phiên thiết bị; không trả lời bằng `answer`.
 */
export type OnlineDialogSpec =
  | { kind: 'devices' }
  | { kind: 'pin' }
  | { kind: 'login' }
  | { kind: 'download' }
  | { kind: 'restore' }
  | { kind: 'upload' }
  // Feature 006: hộp thoại không đi qua `ask` (không có lời đáp) mà do thành phần của nó gọi hành động của app.
  | { kind: 'upgrade' }
  | { kind: 'refused'; version: string }
  // Hộp thoại của Bảng Tag và cây (ui/dialogs/*): tự giữ trạng thái form, gọi `store.edit`.
  | { kind: 'rename' }
  | { kind: 'bulkAdd' }
  | { kind: 'csvImport' }
  | { kind: 'writeConfirm' }
  /** Đổi tên Tag: `to` là tên mới gõ sẵn (từ ô tên của Bảng Tag). */
  | { kind: 'renameTag'; tagId: string; to?: string };

/** Loại hộp thoại chỉ có `kind` (không kèm dữ liệu). */
export type SimpleDialogKind = Exclude<
  OnlineDialogSpec,
  { kind: 'refused' } | { kind: 'renameTag' }
>['kind'];

/** Hộp thoại của Studio; mỗi lúc chỉ một hộp thoại. */
export type DialogSpec = CoreDialogSpec | OnlineDialogSpec;

export const isOnlineDialog = (d: DialogSpec | null): d is OnlineDialogSpec =>
  d?.kind === 'devices' ||
  d?.kind === 'pin' ||
  d?.kind === 'login' ||
  d?.kind === 'download' ||
  d?.kind === 'restore' ||
  d?.kind === 'upload' ||
  d?.kind === 'upgrade' ||
  d?.kind === 'refused' ||
  d?.kind === 'rename' ||
  d?.kind === 'bulkAdd' ||
  d?.kind === 'csvImport' ||
  d?.kind === 'writeConfirm' ||
  d?.kind === 'renameTag';

/** Việc làm tiếp sau khi Online và đăng nhập xong (nút "Đọc lên…" của hộp thoại Thiết bị trong mạng). */
export type OnlineIntent = 'upload-new' | 'compare';

/** Kết quả Thêm theo địa chỉ: mã lỗi của `normalizeHttps`, `http-port` (cổng HTTP sai), hoặc của `device_add`. */
export type AddDeviceResult =
  { ok: true; device: KnownDevice } | { ok: false; error: string; cause?: DeviceError };

export type DialogChoice = 'save' | 'discard' | 'cancel' | 'overwrite' | 'reload' | 'ok';

export interface UiState {
  /** Nút đang mở trên cây. */
  readonly expanded: ReadonlySet<string>;
  /** Nút đang chọn trên cây. */
  readonly treeSel: string | null;
  readonly inspectorTab: InspectorTab;
  readonly palette: boolean;
  readonly dialog: DialogSpec | null;
  /** `id` tăng mỗi lần báo, để thành phần biết có thông báo mới (kể cả cùng chữ). */
  readonly toast: { text: string; id: number } | null;
  readonly findQuery: string;
  readonly recent: readonly RecentEntry[];
  readonly appInfo: AppInfo | null;
  /** Cửa sổ hẹp (< 900 px): cây hiện dạng ngăn kéo. */
  readonly treeDrawer: boolean;
  /** Thời điểm áp kết quả kiểm gần nhất (ms). */
  readonly checkedAt: number | null;
}

/** Việc chỉ phần giao diện làm được (focus); mat-shell và task card gắn vào. */
export interface AppHooks {
  region?: (dir: 1 | -1) => void;
  focusFind?: () => void;
  /** F10: focus thanh menu. */
  focusMenu?: () => void;
  /** Trước khi lưu: editor xác nhận ô đang sửa dở (Ctrl+S khi đang gõ trong ô). */
  commitPending?: () => void;
}

export interface AppDeps {
  platform: Platform;
  storage?: StorageLike | null;
  windowWidth?: number;
  session?: DeviceSession;
  store?: StudioStore;
  now?: () => number;
  /**
   * Lớp nói chuyện với thiết bị qua Rust (feature 005). Có thì phiên thiết bị (cả chế độ theo dõi của 004)
   * và "Kiểm tra kết nối" đi qua Rust; WebView không tự kết nối ra mạng (CSP).
   */
  link?: DeviceLink;
  /**
   * Cổng phiên bản khi mở project (feature 006, FR-003, FR-005): mặc định bật (project 0.1 hỏi Nâng cấp / Mở chỉ đọc /
   * Hủy). `false`: không hỏi, project 0.1 sửa được như 004 (test của 004, 005 chạy trên project mẫu 0.1).
   */
  versionGate?: boolean;
  /** Đồng hồ và hẹn giờ của Mô phỏng (test). */
  sim?: SimEngineOptions;
}

/** Loại editor nhận vị trí lỗi (Location.editor). */
export type RevealTarget = Exclude<Location['editor'], null>;

/**
 * Phiên đang hoạt động (đang kết nối, theo dõi, chờ đăng nhập lại, mất kết nối hay chờ vì đầy): khung có viền
 * cam.
 */
export const sessionActive = (s: SessionState): boolean =>
  s === 'connecting' || s === 'monitoring' || s === 'relogin' || s === 'lost' || s === 'full';

const WRITE_REASON: Readonly<Record<WriteFailure, MessageKey>> = {
  changed: 'save.error.changed',
  'bad-path': 'save.error.bad-path',
  'no-project': 'save.error.no-project',
  io: 'save.error.io',
};

/** Lựa chọn hợp với editor đang mở; đổi tab thì bỏ lựa chọn không còn hợp. */
function selectionFor(editor: EditorId, current: Selection): Selection {
  if (editor === 'settings') return { kind: 'project' };
  if (editor === 'tags' || editor === 'calc') return current?.kind === 'tag' ? current : null;
  if (editor === 'logging') return current?.kind === 'group' ? current : null;
  if (editor.startsWith('screen:'))
    return current?.kind === 'element' && `screen:${current.screen}` === editor ? current : null;
  return null;
}

/** Câu cho lỗi của `store.upgrade()`. */
function upgradeFailure(error: { code: string }): string {
  return upgradeErrorText(error);
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export class StudioApp {
  readonly platform: Platform;
  readonly store: StudioStore;
  readonly session: DeviceSession;
  /** Đăng ký dữ liệu sống theo nơi dùng (feature 006): Bảng theo dõi, xem trước màn hình, dòng đang hiện của Bảng Tag. */
  readonly live: LiveSubscriptions;
  /** Thử kết nối của trang Kết nối (feature 006, FR-044): chỉ đi qua DeviceLink tới BL335. */
  readonly probe: ConnectionProbe;
  /** Danh sách cổng serial của BL335 cho kênh RTU (feature 006, T171). */
  readonly ports: SerialPortsLoader;
  /** Lệnh Ghi của Bảng theo dõi (feature 006, US2): trạng thái từng dòng, định nghĩa Tag trên BL335, bản chờ xác nhận. */
  readonly writes: WriteController;
  /** Mô phỏng dùng chung của Bảng Tag, Bảng theo dõi, xem trước (feature 006, FR-052). */
  readonly simulation: SimController;
  readonly hooks: AppHooks = {};
  /** Lớp nói chuyện với thiết bị qua Rust (feature 005); `null` trong test của 004. */
  readonly link: DeviceLink | null;
  /** FetchFn của "Kiểm tra kết nối" (trang Thiết bị): qua `monitor_get` khi có DeviceLink. */
  readonly checkFetch: FetchFn;
  /** Nạp xuống và Khôi phục (feature 005, US2); `null` khi không có lớp thiết bị (test của 004). */
  readonly deploy: DeployController | null;
  /** So sánh với thiết bị và Đọc lên (feature 005, US3); `null` khi không có lớp thiết bị (test của 004). */
  readonly compare: CompareController | null;
  /** Chẩn đoán đầy đủ (feature 005, US4): hỏi mỗi 5 s khi tab Chẩn đoán mở và đang Online có đăng nhập; `null` khi không có lớp thiết bị. */
  readonly diag: DiagnosticsFeed | null;
  /** Chẩn đoán driver (feature 006, FR-051): hỏi mỗi 2 s khi trang Chẩn đoán driver mở. */
  readonly driverDiag: DriverDiagFeed | null;
  /** Audit của thiết bị cho editor Audit (administrator); `null` khi không có lớp thiết bị. */
  readonly audit: AuditFeed | null;
  /** Thiết bị mà `diag` và `audit` đang giữ số liệu: đổi thiết bị hay Offline thì bỏ. */
  private feedDevice: string | null = null;
  /** Việc chờ Online xong (Đọc lên từ hộp thoại Thiết bị trong mạng). */
  private intent: OnlineIntent | null = null;
  private scanRef: DiscoveryScan | null = null;
  private known: KnownDevice[] = [];
  private nics: NetInterface[] | null = null;
  /** Thiết bị Online gần nhất: Đăng nhập… Online lại thiết bị này. */
  private lastOnline: KnownDevice | null = null;
  /** Hộp thoại Online chờ mở khi hộp thoại của 004 đang mở (không đè hộp thoại đang hỏi). */
  private pendingOnline: OnlineDialogSpec | null = null;
  /** Thiết bị gắn với từng project (thiết lập cục bộ theo thư mục project, T085a). */
  private readonly bindings: DeviceBindings;
  private readonly versionGate: boolean;
  private ws: Workspace;
  private u: UiState;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly valueListeners = new Set<(tags: readonly string[]) => void>();
  private readonly handlers = new Map<CommandId, () => void>();
  private columnPref: ColumnChoice;
  private uiContext: UiContext = {};
  private pendingReveal: Location | null = null;
  private dialogResolve: ((c: DialogChoice) => void) | null = null;
  private toastSeq = 0;
  private lastTitle: string | null = null;
  private lastSessionTags = '';
  private dirtyMemo: { docs: unknown; files: string[] } | null = null;
  private seenCheckSeq = 0;
  /** Lựa chọn cuối của từng editor: chuyển tab rồi quay lại thì chọn lại (data-model §8). */
  private readonly lastSelection = new Map<EditorId, Selection>();

  constructor(deps: AppDeps) {
    this.platform = deps.platform;
    this.storage = deps.storage ?? null;
    this.versionGate = deps.versionGate ?? true;
    this.now = deps.now ?? (() => Date.now());
    this.store = deps.store ?? new StudioStore({ platform: deps.platform });
    this.link = deps.link ?? null;
    const link = this.link;
    this.session =
      deps.session ??
      new DeviceSession(
        link ? { link, createSocket: monitorSocket(link), fetch: monitorFetch(link) } : {},
      );
    this.checkFetch = link ? monitorFetch(link) : (u, i) => fetch(u, i);
    this.deploy = link
      ? new DeployController({
          store: this.store,
          link,
          session: this.session,
          save: async () => (await this.save()).status === 'saved',
          show: (kind) => {
            this.showOnline(kind);
            this.emit();
          },
          hide: (kind) => {
            this.hideOnline([kind]);
            this.emit();
          },
          emit: () => this.emit(),
        })
      : null;
    this.compare = link
      ? new CompareController({ store: this.store, link, session: this.session, now: this.now })
      : null;
    this.diag = link
      ? new DiagnosticsFeed({
          get: async () => {
            const id = this.session.deviceId;
            return id ? link.get(id, '/api/v1/diagnostics') : { error: 'no-such-device' };
          },
          now: this.now,
          onChange: () => this.emit(),
        })
      : null;
    this.driverDiag = link
      ? new DriverDiagFeed({
          get: async () => {
            const id = this.session.deviceId;
            return id ? link.get(id, '/api/v1/drivers/diagnostics') : { error: 'no-such-device' };
          },
          now: this.now,
          onChange: () => this.emit(),
        })
      : null;
    this.live = new LiveSubscriptions((tags) => this.session.setTags(tags));
    this.probe = new ConnectionProbe({
      post: async (path, body) => {
        const id = this.session.deviceId;
        return link && id ? link.post(id, path, body) : { error: 'unreachable' };
      },
      gate: () => {
        const c = this.commandContext();
        return probeGate({
          online: c.onlineAuth,
          role: c.onlineAuth ? (this.session.auth?.role ?? null) : null,
        });
      },
    });
    this.probe.subscribe(() => this.emit());
    this.ports = new SerialPortsLoader({
      get: async (path, query) => {
        const id = this.session.deviceId;
        return link && id ? link.get(id, path, query) : { error: 'unreachable' };
      },
      gate: () => {
        const c = this.commandContext();
        return portsGate({
          online: c.onlineAuth,
          role: c.onlineAuth ? (this.session.auth?.role ?? null) : null,
        });
      },
    });
    this.ports.subscribe(() => this.emit());
    this.writes = new WriteController({
      link,
      deviceId: () => this.session.deviceId,
      onRelogin: () => {
        this.showOnline('login');
        this.emit();
      },
      onChange: () => this.emit(),
    });
    this.simulation = new SimController({
      ...(deps.sim ? { options: deps.sim } : {}),
      onValues: (ids) => {
        for (const l of [...this.valueListeners]) l(ids);
      },
      onChange: () => this.emit(),
    });
    this.audit = link
      ? new AuditFeed({
          get: async (query) => {
            const id = this.session.deviceId;
            return id ? link.get(id, '/api/v1/audit', query) : { error: 'no-such-device' };
          },
          onChange: () => this.emit(),
        })
      : null;
    this.bindings = new DeviceBindings(this.storage);
    this.columnPref = loadColumnChoice(this.storage);
    const width = deps.windowWidth ?? 1360;
    this.ws = loadWorkspace(this.storage, width);
    this.u = {
      expanded: new Set(DEFAULT_EXPANDED),
      treeSel: null,
      inspectorTab: 'props',
      palette: false,
      dialog: null,
      toast: null,
      findQuery: '',
      recent: [],
      appInfo: null,
      treeDrawer: false,
      checkedAt: null,
    };
    this.store.subscribe(() => this.onStoreChange());
    this.session.subscribe((e) => {
      if (e.type === 'values') for (const l of [...this.valueListeners]) l(e.tags);
      else {
        if (e.type === 'state') {
          if (sessionActive(e.state) && this.simulation.simulating) {
            this.simulation.setGlobal(false);
            this.toast(t('sim.stoppedByOnline'));
          }
          this.syncOnlineDialog(e.state);
          this.runIntent(e.state);
          this.syncWrites(e.state);
        }
        this.syncKnownDevice();
        this.compare?.sync();
        this.emit();
      }
    });
  }

  // ---------- Trạng thái, đăng ký nghe ----------

  get workspace(): Workspace {
    return this.ws;
  }

  get ui(): UiState {
    return this.u;
  }

  /** Báo khi trạng thái project, giao diện, không gian làm việc hay phiên thiết bị đổi. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Báo riêng khi giá trị sống đổi (nhiều lần mỗi giây): chỉ lưới, xem trước, inspector cần nghe. */
  subscribeValues(listener: (tags: readonly string[]) => void): () => void {
    this.valueListeners.add(listener);
    return () => void this.valueListeners.delete(listener);
  }

  private emit(): void {
    this.syncFeeds();
    for (const l of [...this.listeners]) l();
  }

  /**
   * Chẩn đoán hỏi mỗi 5 s chỉ khi tab Chẩn đoán đang mở và đang Online có đăng nhập (FR-032); Offline, đổi thiết bị
   * thì bỏ số liệu của chẩn đoán và audit.
   */
  private syncFeeds(): void {
    const s = this.session;
    const device =
      s.mode === 'online' && s.auth !== null && s.state === 'monitoring' ? s.deviceId : null;
    if (device !== this.feedDevice) {
      this.feedDevice = device;
      this.diag?.reset();
      this.driverDiag?.stop();
      this.ports.reset();
      if (this.audit && this.audit.state.status !== 'idle') this.audit.reset();
    }
    const want = device !== null && this.u?.inspectorTab === 'diag';
    if (!this.diag) return;
    if (want && !this.diag.active) this.diag.start();
    else if (!want && this.diag.active) this.diag.stop();
  }

  private setUi(patch: Partial<UiState>): void {
    this.u = { ...this.u, ...patch };
    this.emit();
  }

  private onStoreChange(): void {
    const s = this.store.state;
    // Chỉ nhớ lựa chọn hợp với editor đang mở (lúc đổi tab, lựa chọn cũ còn đứng một nhịp).
    if (s.project && s.selection && selectionFor(s.active, s.selection) === s.selection)
      this.lastSelection.set(s.active, s.selection);
    if (s.checkSeq !== this.seenCheckSeq) {
      this.seenCheckSeq = s.checkSeq;
      this.u = { ...this.u, checkedAt: this.now() };
    }
    this.syncTitle();
    this.syncSessionTags();
    if (s.project) this.simulation.sync(s.outline);
    else this.simulation.stopAll();
    this.compare?.sync();
    this.emit();
  }

  // ---------- Khởi động ----------

  /** Nạp danh sách gần đây, thông tin ứng dụng, gắn hỏi khi đóng cửa sổ, đặt tiêu đề. */
  async start(): Promise<void> {
    this.platform.onCloseRequested(() => this.confirmClose());
    this.syncTitle();
    const [recent, appInfo] = await Promise.all([
      this.platform.recentProjects().catch(() => []),
      this.platform.appInfo().catch(() => null),
    ]);
    this.setUi({ recent, appInfo });
  }

  async refreshRecent(): Promise<void> {
    const recent = await this.platform.recentProjects().catch(() => this.u.recent);
    this.setUi({ recent: [...recent] });
  }

  async forgetRecent(index: number): Promise<void> {
    await this.platform.forgetRecent(index);
    await this.refreshRecent();
  }

  // ---------- Dữ liệu suy ra ----------

  /** Tên hiển thị của project: projectName, không có thì tên thư mục. */
  projectName(): string {
    const s = this.store.state;
    const name = s.outline.project?.projectName;
    if (typeof name === 'string' && name.trim() !== '') return name;
    return s.project ? basename(s.project.display) : '';
  }

  /** File chưa lưu (nhớ theo đối tượng docs để không tuần tự hóa lại mỗi lần vẽ). */
  dirtyFiles(): string[] {
    const docs = this.store.state.docs;
    if (this.dirtyMemo?.docs !== docs) this.dirtyMemo = { docs, files: this.store.dirtyFiles() };
    return this.dirtyMemo.files;
  }

  isDirty(): boolean {
    return this.dirtyFiles().length > 0;
  }

  /** Editor có tài liệu chưa lưu (dấu chấm trên tab). */
  editorDirty(editor: EditorId): boolean {
    const files = this.dirtyFiles();
    if (editor === 'settings') return files.includes('project.json');
    if (editor === 'tags') return files.includes(this.store.state.outline.tagFile);
    return false;
  }

  counts(): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const i of this.store.state.issues)
      if (severityOf(i) === 'error') errors++;
      else warnings++;
    return { errors, warnings };
  }

  deviceAddress(): string {
    return this.ws.deviceAddress;
  }

  /**
   * Gốc URL đã chuẩn hóa của địa chỉ theo dõi (trang Thiết bị, chỉ HTTP); null nếu chưa nhập, sai, hoặc là
   * `https://` (thiết bị có HTTPS dùng Online, T085a).
   */
  deviceBase(): string | null {
    const n = normalizeMonitor(this.ws.deviceAddress);
    return n.ok ? n.base : null;
  }

  /** Đang làm việc với thiết bị (viền cam). */
  online(): boolean {
    return sessionActive(this.session.state);
  }

  tree(): TreeNode {
    const s = this.store.state;
    // Đang làm việc với thiết bị đã lưu (feature 005): nút thiết bị mang tên và địa chỉ của thiết bị đó. Không
    // làm việc với thiết bị: thiết bị gắn với project (T085a), không có thì địa chỉ đã nhập ở trang Thiết bị.
    const active = sessionActive(this.session.state);
    const d = active ? this.session.device : null;
    const bound = active ? null : this.projectDevice();
    const address = d
      ? this.session.mode === 'online'
        ? `${d.host}:${d.httpsPort}`
        : `${d.host}:${d.httpPort}`
      : bound
        ? `${bound.host}:${bound.httpsPort}`
        : this.ws.deviceAddress || null;
    return buildTree({
      folderName: s.project ? basename(s.project.display) : '',
      outline: s.outline,
      device: { name: d?.name ?? bound?.name ?? null, address, state: this.session.state },
      compare: this.session.compare.info?.result ?? null,
    });
  }

  commandContext(): CommandContext {
    const s = this.session;
    const ctx = this.store.commandContext({
      monitoring: this.online(),
      // Đang làm việc với thiết bị đã lưu (feature 005) thì mở được web của thiết bị đó.
      deviceAddressSet: this.webBase() !== null,
      ...this.uiContext,
    });
    const onlineAuth =
      s.mode === 'online' && s.auth !== null && sessionActive(s.state) && s.state !== 'relogin';
    return {
      ...ctx,
      treeKind: (this.u.treeSel ? refOfNode(this.u.treeSel)?.type : undefined) ?? null,
      selectedTag: this.selectedTagId(),
      simulating: this.simulating(),
      onlineAuth,
      onlineEngineer:
        onlineAuth && (s.auth?.role === 'engineer' || s.auth?.role === 'administrator'),
      onlineOperator:
        onlineAuth &&
        (s.auth?.role === 'operator' ||
          s.auth?.role === 'engineer' ||
          s.auth?.role === 'administrator'),
      relogin: s.state === 'relogin',
    };
  }

  // ---------- Mô phỏng (feature 006, FR-052) ----------

  /** Mô phỏng đang bật (thanh công cụ, dấu MÔ PHỎNG). */
  simulating(): boolean {
    return this.simulation.simulating;
  }

  /** Có nguồn giá trị để hiện: Online hoặc Mô phỏng. */
  valuesLive(): boolean {
    return this.online() || this.simulating();
  }

  /** Giá trị hiện tại của Tag từ nguồn đang dùng (phiên thiết bị khi Online, Mô phỏng khi bật); không có thì undefined. */
  readValue(id: string): LiveValue | undefined {
    if (this.online()) return this.session.values.get(id);
    if (!this.simulating()) return undefined;
    const e = this.simulation.read(id);
    return e
      ? {
          value: e.value,
          quality: e.quality,
          ts: e.ts,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
        }
      : undefined;
  }

  /**
   * Bật hoặc tắt Mô phỏng. Online và Mô phỏng không chạy cùng lúc: đang Online mà bật thì hỏi rồi ngắt Online trước.
   * Trả true khi trạng thái sau cùng đúng như yêu cầu.
   */
  async setSimulation(on: boolean): Promise<boolean> {
    if (!on) {
      this.simulation.setGlobal(false);
      return true;
    }
    if (!this.store.state.project) return false;
    if (this.online()) {
      const choice = await this.ask({ kind: 'simSwitch', to: 'sim' });
      if (choice !== 'ok') return false;
      this.session.disconnect();
    }
    this.simulation.setGlobal(true);
    return true;
  }

  /** Trước khi làm việc với thiết bị: đang Mô phỏng thì hỏi rồi tắt. False: người dùng không chuyển. */
  private async leaveSimulation(): Promise<boolean> {
    if (!this.simulating()) return true;
    const choice = await this.ask({ kind: 'simSwitch', to: 'online' });
    if (choice !== 'ok') return false;
    this.simulation.setGlobal(false);
    return true;
  }

  /**
   * Ghi tay vào Mô phỏng (Bảng theo dõi): áp ngay, không đăng nhập, không audit, không qua thiết bị. Kiểm cùng luật như ghi lên
   * thiết bị (kiểu, giới hạn, Tag RW, Tag tính toán) trên định nghĩa Tag của project; kết quả ghi rõ "mô phỏng" ở từng dòng.
   */
  simWrite(rows: readonly WriteRowInput[]): { written: number; blocked: number } {
    const local = new Map<string, DeviceTagDef>();
    for (const tag of (this.store.state.outline.tags?.tags ?? []) as unknown as DeviceTagDef[])
      local.set(tag.id, tag);
    const draft = planSimWrite(rows, local);
    let written = 0;
    let blocked = 0;
    for (const item of draft.items) {
      if (item.value === undefined || item.blocked) {
        blocked++;
        const b = item.blocked;
        this.writes.flow.recordLocal(item, {
          ok: false,
          message: b ? t(b.reason, b.params as never) : '',
        });
        continue;
      }
      const r = this.simulation.engine.write(item.tag, item.value);
      if (r.ok) {
        written++;
        this.writes.flow.recordLocal(
          { key: item.key, tag: item.tag, value: item.value },
          { ok: true },
        );
      } else {
        blocked++;
        this.writes.flow.recordLocal(item, {
          ok: false,
          message: t(r.reason === 'unknown' ? 'wf.lock.notInProject' : 'wf.lock.readonly'),
        });
      }
    }
    return { written, blocked };
  }

  /** Id của Tag đang chọn (selection của Bảng Tag, Tag tính toán); null khi không chọn Tag. */
  selectedTagId(): string | null {
    const sel = this.store.state.selection;
    if (sel?.kind !== 'tag') return null;
    const id = (this.store.state.outline.tags?.tags[sel.row] as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  }

  enabled(id: CommandId): true | MessageKey {
    const spec = commandById(id);
    return spec ? spec.enabled(this.commandContext()) : 'reason.noProject';
  }

  /** Lưới Tag báo focus và ô đang chọn (điều kiện của Điền xuống, Xóa dòng). */
  setUiContext(patch: UiContext): void {
    const next = { ...this.uiContext, ...patch };
    if (
      next.tagGridFocused === this.uiContext.tagGridFocused &&
      next.cellRow === this.uiContext.cellRow
    )
      return;
    this.uiContext = next;
    this.emit();
  }

  /** Editor đăng ký lệnh riêng (Điền xuống, Thêm Tag, Xóa dòng); `null` để bỏ. */
  setCommandHandler(id: CommandId, handler: (() => void) | null): void {
    if (handler) this.handlers.set(id, handler);
    else this.handlers.delete(id);
  }

  // ---------- Lệnh ----------

  /**
   * Chạy lệnh theo id (contracts/commands.md). Lệnh bị khóa không chạy và báo lý do. `arg`: chỉ số mục
   * của `project.openRecent`. `open.screen:{id}` mở màn hình theo id.
   */
  async run(id: string, arg?: number): Promise<void> {
    if (id.startsWith('open.screen:')) {
      if (this.store.state.project) this.openEditor(`screen:${id.slice('open.screen:'.length)}`);
      return;
    }
    const spec = commandById(id);
    if (!spec) return;
    // Ctrl+S khi đang gõ trong ô: xác nhận ô trước, rồi mới xét còn thay đổi chưa lưu không.
    if (spec.id === 'project.save') this.hooks.commitPending?.();
    const enabled = spec.enabled(this.commandContext());
    if (enabled !== true) {
      this.toast(t('reason.locked', { label: t(spec.label), reason: t(enabled) }));
      return;
    }
    switch (spec.id) {
      case 'project.open':
        return this.openProject();
      case 'project.openRecent':
        return arg === undefined ? undefined : this.openRecent(arg);
      case 'project.save':
        await this.save();
        return;
      case 'project.settings':
        return this.openEditor('settings');
      case 'project.close':
        return this.closeProject();
      case 'edit.undo':
        return this.store.undo();
      case 'edit.redo':
        return this.store.redo();
      case 'edit.find':
        this.setWorkspace({ taskCard: 'find', taskCardOpen: true });
        this.hooks.focusFind?.();
        return;
      case 'edit.fillDown':
      case 'tags.add':
      case 'tags.delete':
        if (spec.id === 'tags.add' && this.store.state.active !== 'tags') this.openEditor('tags');
        this.handlers.get(spec.id)?.();
        return;
      case 'view.palette':
        return this.openPalette();
      case 'view.themeSystem':
        return this.setTheme('system');
      case 'view.themeLight':
        return this.setTheme('light');
      case 'view.themeDark':
        return this.setTheme('dark');
      case 'view.taskCards':
        return this.setWorkspace({ taskCardOpen: !this.ws.taskCardOpen });
      case 'view.phases':
        return this.setWorkspace({ showPhases: !this.ws.showPhases });
      case 'view.resetLayout':
        this.ws = resetLayout(this.ws, this.windowWidth());
        saveWorkspace(this.storage, this.ws);
        this.toast(t('toast.layoutReset'));
        return;
      case 'view.nextRegion':
        return this.hooks.region?.(1);
      case 'view.prevRegion':
        return this.hooks.region?.(-1);
      case 'online.connect':
        return this.connect();
      case 'online.disconnect':
        return this.session.disconnect();
      case 'online.device':
        return this.openEditor('device');
      case 'online.openWeb':
        return this.openDeviceWeb();
      case 'online.devices':
        return this.openDevices();
      case 'online.login':
        return this.loginCommand();
      case 'online.logout':
        return this.logout();
      case 'online.download':
        return this.deploy?.openDownload();
      case 'online.restore':
        return this.deploy?.openRestore();
      case 'online.compare':
        return this.openEditor('compare');
      case 'online.upload':
        return this.showOnlineNow('upload');
      case 'online.audit':
        return this.openEditor('audit');
      case 'tools.validate':
        return this.validateNow();
      case 'help.shortcuts':
        await this.ask({ kind: 'shortcuts' });
        return;
      case 'help.about':
        await this.ask({ kind: 'about' });
        return;
      case 'help.roadmap':
      case 'open.start':
        return this.openEditor('start');
      case 'tree.add':
        return treeAdd(this);
      case 'tree.rename':
        return treeRename(this);
      case 'tree.duplicate':
        return treeDuplicate(this);
      case 'tree.remove':
        return treeRemove(this);
      case 'tags.bulkAdd':
        return this.openDialog({ kind: 'bulkAdd' });
      case 'tags.importCsv':
        return this.openDialog({ kind: 'csvImport' });
      case 'tags.rename': {
        const tagId = this.selectedTagId();
        return tagId === null ? undefined : this.openDialog({ kind: 'renameTag', tagId });
      }
      case 'tags.exportCsv':
      case 'watch.write':
      case 'watch.writeAll':
        this.handlers.get(spec.id)?.();
        return;
      case 'open.tags':
        return this.openEditor('tags');
      case 'open.logging':
        return this.openEditor('logging');
      case 'tools.simulate':
        await this.setSimulation(!this.simulating());
        return;
      default:
        return;
    }
  }

  private windowWidth(): number {
    return typeof window === 'undefined' ? 1360 : window.innerWidth;
  }

  // ---------- Project ----------

  /** Còn thay đổi chưa lưu thì hỏi; trả `true` nếu được đi tiếp (đã lưu hoặc bỏ). */
  private async settleUnsaved(): Promise<boolean> {
    // Ô đang gõ dở trong lưới cũng là thay đổi chưa lưu: xác nhận trước khi hỏi (FR-024).
    this.hooks.commitPending?.();
    const files = this.dirtyFiles();
    if (!files.length) return true;
    const choice = await this.ask({ kind: 'unsaved', files });
    if (choice === 'discard') return true;
    if (choice !== 'save') return false;
    return (await this.save()).status === 'saved';
  }

  /**
   * Cổng phiên bản sau khi mở project (feature 006, FR-003, FR-005): project 0.1 thì hỏi Nâng cấp / Mở chỉ đọc / Hủy;
   * project mới hơn mức hiểu thì từ chối. Hộp thoại không chặn lời gọi mở project.
   */
  private checkVersionGate(): void {
    if (!this.versionGate) return;
    const s = this.store.state;
    if (s.refusal)
      this.u = {
        ...this.u,
        dialog: { kind: 'refused', version: s.refusal.version },
        palette: false,
      };
    else if (s.pendingUpgrade) this.u = { ...this.u, dialog: { kind: 'upgrade' }, palette: false };
  }

  /** Nâng cấp trong bộ nhớ (nút Nâng cấp của hộp thoại). */
  async upgradeProject(): Promise<void> {
    const r = await this.store.upgrade();
    if (this.u.dialog?.kind === 'upgrade') this.u = { ...this.u, dialog: null };
    if (r.ok) {
      this.syncSessionTags();
      this.toast(t('upgrade.done'));
    } else {
      this.toast(t('upgrade.failedToast', { reason: upgradeFailure(r.error) }));
      this.checkVersionGate();
    }
    this.emit();
  }

  /** Mở chỉ đọc (nút của hộp thoại Nâng cấp). */
  openReadOnly(): void {
    this.store.openReadOnly();
    if (this.u.dialog?.kind === 'upgrade') this.u = { ...this.u, dialog: null };
    this.toast(t('upgrade.readonlyOpened'));
    this.emit();
  }

  /** Hủy hộp thoại Nâng cấp (Esc): đóng project, chưa đọc thêm gì. */
  async cancelUpgrade(): Promise<void> {
    if (this.u.dialog?.kind === 'upgrade') this.u = { ...this.u, dialog: null };
    this.session.disconnect();
    this.store.closeProject();
    this.lastSelection.clear();
    this.u = { ...this.u, expanded: new Set(DEFAULT_EXPANDED), treeSel: null };
    this.pendingReveal = null;
    this.emit();
  }

  private async afterOpen(): Promise<void> {
    this.lastSelection.clear();
    if (this.store.state.refusal) {
      this.checkVersionGate();
      this.emit();
      return;
    }
    this.u = {
      ...this.u,
      expanded: new Set(DEFAULT_EXPANDED),
      treeSel: null,
      inspectorTab: 'props',
      findQuery: '',
    };
    this.pendingReveal = null;
    this.syncSessionTags();
    this.checkVersionGate();
    this.emit();
    await this.refreshRecent();
    // Thiết bị gắn với project hiện trên cây, thanh trạng thái, trang Thiết bị (T085a).
    await this.refreshDevices();
  }

  async openProject(): Promise<void> {
    if (!(await this.settleUnsaved())) return;
    if (await this.store.openProject()) await this.afterOpen();
  }

  async openRecent(index: number): Promise<void> {
    if (!(await this.settleUnsaved())) return;
    const r = await this.store.openRecent(index);
    if (r === true) await this.afterOpen();
    else {
      this.toast(t('toast.recentMissing'));
      await this.refreshRecent();
    }
  }

  async closeProject(): Promise<void> {
    if (!(await this.settleUnsaved())) return;
    this.session.disconnect();
    this.store.closeProject();
    this.lastSelection.clear();
    this.u = { ...this.u, expanded: new Set(DEFAULT_EXPANDED), treeSel: null };
    this.pendingReveal = null;
    this.toast(t('toast.projectClosed'));
  }

  /** Lưu mọi file chưa lưu; xung đột thì hỏi Ghi đè / Tải lại / Hủy (FR-025). */
  async save(): Promise<SaveResult> {
    this.hooks.commitPending?.();
    if (!this.isDirty()) {
      this.toast(t('toast.nothingToSave'));
      return { status: 'saved', files: [] };
    }
    const written: string[] = [];
    const hadBackup = !!this.store.state.upgrade?.backup;
    let r = await this.store.save();
    while (r.status === 'conflict') {
      const choice = await this.ask({ kind: 'conflict', rel: r.rel });
      const rel = r.rel;
      r = await this.store.resolveConflict(
        choice === 'overwrite' ? 'overwrite' : choice === 'reload' ? 'reload' : 'cancel',
      );
      if (r.status === 'cancelled') {
        this.toast(t('toast.saveCancelled', { file: rel }));
        return r;
      }
      if (r.status === 'saved') written.push(...r.files);
    }
    if (r.status === 'saved') {
      const files = [...new Set([...written, ...r.files])];
      const backup = this.store.state.upgrade?.backup;
      this.toast(
        saveNotice(files, this.store.state.issues) +
          (backup && !hadBackup
            ? ' ' + t('upgrade.backedUp', { dir: backup.dir, abs: backup.abs })
            : ''),
      );
    } else if (r.status === 'backup-failed') {
      const reason =
        r.error === 'exists'
          ? t('save.backup.exists')
          : r.error === 'changed'
            ? t('save.backup.changed', { file: r.detail ?? '' })
            : t('save.backup.other', { reason: r.detail ?? r.error });
      await this.ask({
        kind: 'saveError',
        rel: '.mat-backup',
        reason: t('save.error.backup', { reason }),
      });
    } else if (r.status === 'error') {
      const reason = t(WRITE_REASON[r.error], { detail: r.detail ?? '' });
      await this.ask({ kind: 'saveError', rel: r.rel, reason });
    }
    return r;
  }

  /** Hỏi khi đóng cửa sổ (FR-024); `true` thì cho đóng. Đóng thì ngắt theo dõi để trả phiên. */
  async confirmClose(): Promise<boolean> {
    if (!(await this.settleUnsaved())) return false;
    this.session.disconnect();
    return true;
  }

  /** F7: đọc lại đĩa, kiểm toàn bộ, mở tab Thông tin, báo kết quả. */
  async validateNow(): Promise<void> {
    await this.store.validateNow();
    const { errors, warnings } = this.counts();
    this.setUi({ inspectorTab: 'info' });
    this.toast(t('toast.validated', { e: errors, w: warnings }));
  }

  private syncTitle(): void {
    const name = this.projectName();
    const title = !this.store.state.project
      ? t('shell.title')
      : this.isDirty()
        ? t('shell.titleDirty', { name })
        : t('shell.titleProject', { name });
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    void this.platform.setTitle(title).catch(() => undefined);
  }

  // ---------- Cây, tab ----------

  toggleNode(id: string): void {
    const expanded = new Set(this.u.expanded);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    this.setUi({ expanded });
  }

  setExpanded(id: string, open: boolean): void {
    if (this.u.expanded.has(id) !== open) this.toggleNode(id);
  }

  collapseAll(): void {
    this.setUi({ expanded: new Set(['root']) });
  }

  /** Chọn nút trên cây; `open` thì mở editor của nút (nút nhóm chỉ được chọn). */
  selectNode(id: string, open = true): void {
    const node = findNode(this.tree(), id);
    if (!node) return;
    this.u = { ...this.u, treeSel: id, treeDrawer: false };
    if (open && node.editor && (this.store.state.project || node.editor === 'start'))
      this.openEditor(node.editor, false);
    else this.emit();
  }

  /** Mở editor trong tab (tab có sẵn thì chuyển tới); `reveal` mở đường tới mục trên cây. */
  openEditor(id: EditorId, reveal = true): void {
    // Trang Thiết bị mở được cả khi chưa mở project (Online › Thiết bị… luôn bật, contracts/commands.md).
    if (id !== 'start' && id !== 'device' && id !== 'audit' && !this.store.state.project) return;
    this.store.openTab(id);
    this.afterActivate(id, reveal);
  }

  activate(id: EditorId): void {
    this.store.activate(id);
    this.afterActivate(id, true);
  }

  private afterActivate(id: EditorId, reveal: boolean): void {
    const tree = this.tree();
    const current = this.u.treeSel ? findNode(tree, this.u.treeSel) : undefined;
    let { treeSel, expanded } = this.u;
    if (current?.editor !== id) {
      const node = findByEditor(tree, id);
      treeSel = node?.id ?? treeSel;
      if (node && reveal) {
        const path = ancestorsOf(tree, node.id) ?? [];
        if (path.some((p) => !expanded.has(p))) expanded = new Set([...expanded, ...path]);
      }
    }
    this.u = { ...this.u, treeSel, expanded };
    const selection =
      selectionFor(id, this.store.state.selection) ??
      selectionFor(id, this.lastSelection.get(id) ?? null);
    if (selection !== this.store.state.selection) this.store.select(selection);
    else this.emit();
  }

  closeTab(id: EditorId): void {
    if (id === 'start') return;
    if (this.editorDirty(id)) this.toast(t('tabs.keptUnsaved', { title: this.editorTitle(id) }));
    this.store.closeTab(id);
    this.afterActivate(this.store.state.active, false);
  }

  /** Tiêu đề của editor (tab, thông báo): dùng nhãn của nút trên cây. */
  editorTitle(id: EditorId): string {
    if (id === 'device') return t('cmd.online.device').replace(/…$/, '');
    if (id === 'compare') return t('compare.tab');
    if (id === 'audit') return t('audit.tab');
    const node = findByEditor(this.tree(), id);
    if (node) return node.label;
    return id.startsWith('screen:') ? id.slice('screen:'.length) : id;
  }

  select(selection: Selection): void {
    this.store.select(selection);
  }

  // ---------- Lỗi → editor (FR-018) ----------

  /** Mở editor chứa chỗ sai và để sẵn vị trí cho editor lấy (`takeReveal`). */
  gotoIssue(issue: Issue): boolean {
    const loc = locate(issue, this.store.state.outline);
    if (loc.editor === null) {
      this.toast(t('insp.issue.noJump', { file: issue.file }));
      return false;
    }
    return this.revealLocation(loc);
  }

  /** Mở editor của vị trí ("Dùng ở đâu", lỗi) và để sẵn vị trí cho editor lấy (`takeReveal`). */
  revealLocation(loc: Location): boolean {
    if (loc.editor === null) return false;
    this.pendingReveal = loc;
    const editor: EditorId =
      loc.editor === 'screen'
        ? `screen:${loc.screen}`
        : loc.editor === 'watch'
          ? `watch:${loc.id}`
          : loc.editor === 'valueTable'
            ? `vt:${loc.name}`
            : loc.editor;
    this.openEditor(editor);
    return true;
  }

  /** Mở Bảng Tag và chọn ô tên của dòng `row` (Details, Tìm, "Dùng ở đâu"). */
  revealTag(row: number): void {
    this.pendingReveal = { editor: 'tags', row, column: 'id' };
    this.store.select({ kind: 'tag', row });
    this.openEditor('tags');
  }

  /** Editor lấy vị trí cần hiện (một lần); vị trí của editor khác thì để lại. */
  takeReveal(target: RevealTarget): Location | null {
    const loc = this.pendingReveal;
    if (!loc || loc.editor !== target) return null;
    this.pendingReveal = null;
    return loc;
  }

  // ---------- Không gian làm việc ----------

  private setWorkspace(patch: Partial<Workspace>): void {
    this.ws = { ...this.ws, ...patch };
    saveWorkspace(this.storage, this.ws);
    this.emit();
  }

  setTheme(theme: Theme): void {
    this.setWorkspace({ theme });
  }

  /** Kéo thanh đổi cỡ; `dims` là chiều cao đo được để kẹp (0 = chưa đo). */
  setLayout(
    patch: Partial<Pick<Workspace, 'leftWidth' | 'detailsHeight' | 'inspectorHeight'>>,
    dims = { leftColumnHeight: 0, centerHeight: 0 },
  ): void {
    this.ws = clampLayout({ ...this.ws, ...patch }, dims);
    saveWorkspace(this.storage, this.ws);
    this.emit();
  }

  /** Chọn task card; chọn lại thẻ đang mở thì thu lại (như dải tab dọc của TIA Portal). */
  setTaskCard(card: TaskCard): void {
    if (card === this.ws.taskCard && this.ws.taskCardOpen)
      this.setWorkspace({ taskCardOpen: false });
    else this.setWorkspace({ taskCard: card, taskCardOpen: true });
  }

  setShowPhases(show: boolean): void {
    this.setWorkspace({ showPhases: show });
  }

  setDeviceAddress(address: string): void {
    this.setWorkspace({ deviceAddress: address.trim() });
  }

  setInspectorTab(tab: InspectorTab): void {
    if (tab !== this.u.inspectorTab) this.setUi({ inspectorTab: tab });
  }

  setFindQuery(q: string): void {
    this.setUi({ findQuery: q });
  }

  setTreeDrawer(open: boolean): void {
    if (open !== this.u.treeDrawer) this.setUi({ treeDrawer: open });
  }

  // ---------- Hộp thoại, bảng lệnh, thông báo ----------

  /** Mở hộp thoại, chờ người dùng chọn. Hộp thoại đang mở (nếu có) được trả `cancel`. */
  ask(spec: DialogSpec): Promise<DialogChoice> {
    this.dialogResolve?.('cancel');
    // Hộp thoại Online đang mở (đăng nhập, xác nhận chứng chỉ): trả lời xong thì mở lại.
    if (isOnlineDialog(this.u.dialog)) this.pendingOnline = this.u.dialog;
    return new Promise<DialogChoice>((resolve) => {
      this.dialogResolve = resolve;
      this.setUi({ dialog: spec, palette: false });
    });
  }

  answer(choice: DialogChoice): void {
    const resolve = this.dialogResolve;
    this.dialogResolve = null;
    // Hộp thoại Online chờ trong lúc hỏi (ví dụ phiên hết hạn khi đang hỏi lưu): mở sau, nếu còn hợp.
    const next =
      this.pendingOnline && this.onlineDialogFits(this.pendingOnline) ? this.pendingOnline : null;
    this.pendingOnline = null;
    this.setUi({ dialog: next });
    resolve?.(choice);
  }

  openPalette(): void {
    if (!this.u.dialog) this.setUi({ palette: true });
  }

  closePalette(): void {
    if (this.u.palette) this.setUi({ palette: false });
  }

  toast(text: string): void {
    this.setUi({ toast: { text, id: ++this.toastSeq } });
  }

  // ---------- Thiết bị ----------

  private syncSessionTags(): void {
    const tags = (this.store.state.outline.tags?.tags ?? [])
      .map((tag) => (tag as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
    const key = tags.join('\n');
    if (key === this.lastSessionTags) return;
    this.lastSessionTags = key;
    // Project nhỏ: đăng ký mọi Tag như 004 (ưu tiên thấp nhất). Project lớn (> 1.000 Tag): chỉ các nơi đang cần khai.
    if (tags.length <= MAX_SUBSCRIBED) this.live.declare('project', tags, PRIORITY.base);
    else this.live.release('project');
    this.live.flush();
  }

  /**
   * Ctrl+K, nút Online (FR-031, T085a). Project đã gắn thiết bị đã lưu: Online thiết bị đó (dò chứng chỉ → xác
   * nhận ghim nếu chưa ghim → đăng nhập nếu Rust chưa có phiên → dữ liệu sống qua wss; HTTPS không trả lời mà
   * HTTP là runtime < 0.4.0 thì theo dõi chỉ đọc kèm `runtime-old`, FR-035). Chưa gắn (hoặc thiết bị đã gắn
   * không còn trong danh sách đã lưu): mở Thiết bị trong mạng để chọn. Không có lớp thiết bị (test của 004,
   * không có DeviceLink): theo dõi theo địa chỉ như 004.
   */
  private async connect(): Promise<void> {
    if (!(await this.leaveSimulation())) return;
    if (!this.link) return this.monitorAddress();
    const k = await this.boundDevice();
    if (!this.store.state.project || this.online()) return;
    if (k) {
      this.syncSessionTags();
      this.session.goOnline(k);
      return;
    }
    await this.openDevices();
  }

  /**
   * Trang Thiết bị › Kết nối theo dõi (004; FR-035): theo dõi chỉ đọc theo địa chỉ đã nhập, qua HTTP, cho thiết
   * bị runtime cũ. Cùng điều kiện với Ctrl+K (project, chưa theo dõi); chưa nhập địa chỉ (hoặc địa chỉ sai,
   * `https://`) thì mở trang Thiết bị.
   */
  monitorAddress(): void {
    if (this.simulating()) {
      void this.leaveSimulation().then((ok) => (ok ? this.monitorNow() : undefined));
      return;
    }
    this.monitorNow();
  }

  private monitorNow(): void {
    const enabled = this.enabled('online.connect');
    if (enabled !== true) {
      this.toast(t('reason.locked', { label: t('cmd.online.connect'), reason: t(enabled) }));
      return;
    }
    if (!this.deviceBase()) {
      this.openEditor('device');
      return;
    }
    this.syncSessionTags();
    this.session.connect(this.ws.deviceAddress);
  }

  /**
   * Gốc trang web của thiết bị: thiết bị đang làm việc (feature 005), địa chỉ đã nhập ở trang Thiết bị, hoặc
   * thiết bị gắn với project (T085a).
   */
  private webBase(): string | null {
    const d = sessionActive(this.session.state) ? this.session.device : null;
    if (d) return `http://${d.host}:${d.httpPort}`;
    const bound = this.projectDevice();
    return this.deviceBase() ?? (bound ? `http://${bound.host}:${bound.httpPort}` : null);
  }

  private async openDeviceWeb(): Promise<void> {
    const base = this.webBase();
    if (!base) return;
    try {
      await this.platform.openDeviceWeb(`${base}/`);
    } catch (e) {
      this.toast(t('toast.openWebFailed', { reason: e instanceof Error ? e.message : String(e) }));
    }
  }

  // ---------- Online (feature 005, US1) ----------

  /** Lượt quét của hộp thoại Thiết bị trong mạng (giữ kết quả khi Quay lại từ bước ghim, đăng nhập). */
  get discovery(): DiscoveryScan | null {
    if (!this.scanRef && this.link) {
      this.scanRef = new DiscoveryScan(this.link, this.now);
      this.scanRef.subscribe(() => this.emit());
    }
    return this.scanRef;
  }

  /** Bản sao danh sách thiết bị đã lưu (`devices.json` do Rust giữ). */
  get knownDevices(): readonly KnownDevice[] {
    return this.known;
  }

  /** Card mạng của máy (null khi chưa nạp). */
  get netInterfaces(): readonly NetInterface[] | null {
    return this.nics;
  }

  // ---------- Thiết bị gắn với project (T085a, FR-031) ----------

  /**
   * `id` của thiết bị đã lưu gắn với project đang mở (thiết lập cục bộ theo thư mục project, không nằm trong
   * file project); `null` khi chưa mở project, chưa gắn, hoặc không có lớp thiết bị.
   */
  boundDeviceId(): string | null {
    const p = this.store.state.project;
    return p && this.link ? this.bindings.get(p.display) : null;
  }

  /** Thiết bị gắn với project theo danh sách đã lưu đọc gần nhất; `null` nếu chưa gắn hoặc không còn trong danh sách. */
  projectDevice(): KnownDevice | null {
    const id = this.boundDeviceId();
    return id ? (this.known.find((k) => k.id === id) ?? null) : null;
  }

  /** Gắn thiết bị đã lưu với project đang mở (`null`: gỡ); chưa mở project thì không gắn. */
  private bindDevice(id: string | null): void {
    const p = this.store.state.project;
    if (!p || !this.link || this.bindings.get(p.display) === id) return;
    this.bindings.set(p.display, id);
    this.emit();
  }

  /** Thiết bị gắn với project, đọc lại danh sách đã lưu; thiết bị đã bị bỏ khỏi danh sách thì gỡ gắn. */
  private async boundDevice(): Promise<KnownDevice | null> {
    const id = this.boundDeviceId();
    if (!id) return null;
    await this.refreshDevices();
    // Project đổi trong lúc chờ: không dùng kết quả cũ.
    if (this.boundDeviceId() !== id) return null;
    const k = this.known.find((d) => d.id === id) ?? null;
    if (!k) this.bindDevice(null);
    return k;
  }

  /** Hộp thoại Online còn hợp với trạng thái của phiên không (mở lại sau hộp thoại của 004). */
  private onlineDialogFits(spec: OnlineDialogSpec): boolean {
    const s = this.session;
    if (spec.kind === 'devices' || spec.kind === 'upgrade' || spec.kind === 'refused') return true;
    if (spec.kind === 'download' || spec.kind === 'restore') return this.deploy?.kind === spec.kind;
    if (spec.kind === 'upload') return s.mode === 'online' && s.auth !== null;
    if (spec.kind === 'login') return s.state === 'login' || s.state === 'relogin';
    return s.state === 'pin-confirm' || (s.state === 'error' && s.error === 'cert-mismatch');
  }

  /** Mở hộp thoại Online; hộp thoại của 004 đang hỏi thì chờ nó xong. */
  private showOnline(kind: SimpleDialogKind): void {
    const spec: OnlineDialogSpec = { kind };
    const cur = this.u.dialog;
    if (cur && !isOnlineDialog(cur)) {
      this.pendingOnline = spec;
      return;
    }
    if (cur?.kind === kind) return;
    this.u = { ...this.u, dialog: spec, palette: false };
  }

  private hideOnline(kinds: ReadonlyArray<OnlineDialogSpec['kind']>): void {
    const cur = this.u.dialog;
    if (isOnlineDialog(cur) && kinds.includes(cur.kind)) this.u = { ...this.u, dialog: null };
    if (this.pendingOnline && kinds.includes(this.pendingOnline.kind)) this.pendingOnline = null;
  }

  /** Phiên đổi trạng thái: mở hộp thoại của bước tiếp theo (người nghe được báo ngay sau đó). */
  private syncOnlineDialog(state: SessionState): void {
    const s = this.session;
    if (s.mode === 'online' && s.device) this.lastOnline = s.device;
    switch (state) {
      case 'pin-confirm':
        this.showOnline('pin');
        break;
      case 'login':
      case 'relogin':
        this.showOnline('login');
        break;
      case 'error':
        if (s.mode === 'online' && s.error === 'cert-mismatch') this.showOnline('pin');
        // Lỗi khác ở bước ghim, đăng nhập: về danh sách thiết bị, lỗi hiện ngay trong hộp thoại.
        else if (this.u.dialog?.kind === 'pin' || this.u.dialog?.kind === 'login')
          this.u = { ...this.u, dialog: { kind: 'devices' } };
        break;
      case 'probing':
        break;
      case 'idle':
        this.hideOnline(['pin', 'login']);
        break;
      default:
        // connecting, monitoring, lost, full, incompatible: đã qua các bước, đóng hộp thoại Online.
        this.hideOnline(['devices', 'pin', 'login']);
        break;
    }
    // Nạp xuống, Khôi phục đang chờ: Offline thì đóng; đăng nhập lại xong thì mở lại, làm lại bước xem trước.
    const d = this.deploy;
    if (d?.active) {
      const loggedIn =
        s.mode === 'online' && s.auth !== null && sessionActive(state) && state !== 'relogin';
      if (state === 'idle') d.close();
      else if (loggedIn && !this.u.dialog) d.resume();
    }
  }

  /** Online › Thiết bị trong mạng…: mở hộp thoại, nạp thiết bị đã lưu, tự quét (quét lại card đã chọn). */
  async openDevices(rescan = true): Promise<void> {
    const link = this.link;
    if (!link) return;
    this.showOnline('devices');
    this.emit();
    await this.refreshDevices();
    if (rescan) await this.rescan(this.discovery?.ifaces ?? null);
    else if (!this.nics) {
      this.nics = await link.netInterfaces().catch(() => [] as NetInterface[]);
      this.emit();
    }
  }

  /**
   * Quét lại (mở hộp thoại, Tìm lại, đổi card); trả về khi lượt quét đã bắt đầu. Rust đánh số card theo lần
   * gọi `net_interfaces` gần nhất: đọc lại danh sách card ngay trước khi quét, chọn lại card đã chọn theo tên và
   * địa chỉ (card đã rút thì quét mọi card). `ifaces` là chỉ số trong `netInterfaces` đang hiện; `null`: mọi
   * card broadcast được.
   */
  async rescan(ifaces: number[] | null): Promise<void> {
    const link = this.link;
    const scan = this.discovery;
    if (!link || !scan || scan.state === 'scanning') return;
    const key = (n: NetInterface) => `${n.name}\n${n.address}`;
    const wanted =
      ifaces === null ? null : (this.nics ?? []).filter((n) => ifaces.includes(n.index)).map(key);
    const nics = await link.netInterfaces().catch(() => [] as NetInterface[]);
    this.nics = nics;
    this.emit();
    const next =
      wanted === null ? null : nics.filter((n) => wanted.includes(key(n))).map((n) => n.index);
    void scan.start(next?.length ? next : null);
  }

  /**
   * Phiên vừa đọc lại thiết bị từ Rust (T085b: dò thấy cổng HTTP của runtime cũ, Rust đổi `httpPort`): bản sao danh
   * sách đã lưu theo kịp, để trang web, thanh trạng thái dùng đúng cổng cả sau khi Offline.
   */
  private syncKnownDevice(): void {
    const d = this.session.device;
    if (!d) return;
    const i = this.known.findIndex((k) => k.id === d.id);
    if (i < 0 || this.known[i].httpPort === d.httpPort) return;
    this.known = this.known.map((k, j) => (j === i ? d : k));
  }

  /** Đọc lại danh sách thiết bị đã lưu. */
  async refreshDevices(): Promise<void> {
    if (!this.link) return;
    this.known = await this.link.devices().catch(() => this.known);
    this.emit();
  }

  /**
   * Thêm theo địa chỉ (IP hoặc tên, cổng HTTPS mặc định 8443); Nâng cao: cổng HTTP (trang xem, theo dõi chỉ đọc; để
   * trống là 8080; sai → `http-port`, T085b). Đã lưu thiết bị ở địa chỉ này (Rust trả mục cũ) thì sửa cổng HTTP theo ô
   * đã nhập. Thiết bị vừa thêm gắn với project đang mở.
   */
  async addDeviceAddress(text: string, opts: { httpPort?: string } = {}): Promise<AddDeviceResult> {
    const n = normalizeHttps(text);
    if (!n.ok) return { ok: false, error: n.error };
    const http = parsePort(opts.httpPort ?? '');
    if (!http.ok) return { ok: false, error: 'http-port' };
    if (!this.link) return { ok: false, error: 'ipc' };
    const httpPort = http.port;
    let r = await this.link.addDevice({
      host: n.host,
      httpsPort: n.port,
      ...(httpPort !== null ? { httpPort } : {}),
    });
    if (isDeviceError(r)) return { ok: false, error: r.error, cause: r };
    if (httpPort !== null && r.httpPort !== httpPort) {
      const u = await this.link.updateDevice({ id: r.id, httpPort });
      if (isDeviceError(u)) return { ok: false, error: u.error, cause: u };
      r = u;
    }
    this.bindDevice(r.id);
    await this.refreshDevices();
    return { ok: true, device: r };
  }

  /** Bỏ thiết bị khỏi danh sách đã lưu (project đang gắn thiết bị này thì gỡ gắn). */
  async forgetDevice(id: string): Promise<void> {
    await this.link?.forgetDevice(id).catch(() => undefined);
    if (this.boundDeviceId() === id) this.bindDevice(null);
    await this.refreshDevices();
  }

  /**
   * Online từ một dòng của bảng thiết bị: thiết bị tìm thấy chưa lưu thì lưu (kèm deviceId, MAC), đã lưu mà
   * đổi IP thì cập nhật host (ghim giữ nguyên: ghim gắn với chứng chỉ); gắn thiết bị với project đang mở
   * (T085a: lần sau Ctrl+K kết nối thẳng tới thiết bị này); rồi dò chứng chỉ.
   */
  async goOnline(row: DeviceRow, intent: OnlineIntent | null = null): Promise<void> {
    if (!(await this.leaveSimulation())) return;
    const link = this.link;
    if (!link) return;
    this.intent = intent;
    let k: KnownDevice;
    if (row.kind === 'saved') k = row.known;
    else {
      const d = row.device;
      if (row.known) {
        k = row.known;
        if (k.host !== d.ip || k.httpsPort !== d.httpsPort) {
          const u = await link.updateDevice({ id: k.id, host: d.ip, httpsPort: d.httpsPort });
          if (!isDeviceError(u)) k = u;
        }
      } else {
        const r = await link.addDevice({
          host: d.ip,
          httpsPort: d.httpsPort,
          ...(d.httpPort ? { httpPort: d.httpPort } : {}),
          name: d.name,
          fromDiscovery: { deviceId: d.deviceId, mac: d.mac ?? null, fingerprint: d.fingerprint },
        });
        if (isDeviceError(r)) {
          this.toast(t('devices.addErr.other', { reason: deviceErrorText(r) }));
          return;
        }
        k = r;
      }
      await this.refreshDevices();
    }
    this.bindDevice(k.id);
    this.syncSessionTags();
    this.session.goOnline(k);
  }

  // ---------- Đọc lên, So sánh (feature 005, US3) ----------

  /**
   * Phiên Online có đăng nhập (US2): đọc định nghĩa Tag trên BL335, đưa các dòng chờ đăng nhập lại về trạng thái chờ xác nhận lại,
   * hỏi kết quả của lệnh chưa rõ theo mã. Rời Online thì bỏ định nghĩa đã đọc.
   */
  private syncWrites(state: SessionState): void {
    const s = this.session;
    if (state === 'monitoring' && s.mode === 'online' && s.auth) {
      this.writes.flow.loggedIn();
      void this.writes.loadDefs();
      void this.writes.flow.recheck();
    } else if (
      state === 'idle' ||
      state === 'error' ||
      state === 'lost' ||
      state === 'incompatible'
    )
      this.writes.reset();
  }

  /** Lựa chọn bộ cột và cột của Bảng Tag (nhớ trong thiết lập của Studio). */
  columnChoice(): ColumnChoice {
    return this.columnPref;
  }

  setColumnChoice(choice: ColumnChoice): void {
    this.columnPref = choice;
    saveColumnChoice(this.storage, choice);
    this.emit();
  }

  /** Mở một hộp thoại của feature 006 (Đổi tên, Thêm hàng loạt, Nhập CSV, Xác nhận ghi). */
  openDialog(spec: OnlineDialogSpec): void {
    this.u = { ...this.u, dialog: spec, palette: false };
    this.emit();
  }

  /** Chọn nút trên cây và mở đường tới nó (sau khi thêm hoặc nhân bản). */
  revealNode(id: string): void {
    const tree = this.tree();
    if (!findNode(tree, id)) return;
    const path = ancestorsOf(tree, id) ?? [];
    const expanded = new Set(this.u.expanded);
    for (const p of path) expanded.add(p);
    this.u = { ...this.u, treeSel: id, expanded };
    this.emit();
  }

  /** Hộp thoại chọn file CSV (Nhập CSV). */
  csvOpen(): ReturnType<Platform['csvOpen']> {
    return this.platform.csvOpen();
  }

  /** Hộp thoại lưu file CSV (Xuất CSV). */
  csvSave(name: string, text: string): ReturnType<Platform['csvSave']> {
    return this.platform.csvSave(name, text);
  }

  /** Mở hộp thoại Online ngay (lệnh của menu). */
  private showOnlineNow(kind: SimpleDialogKind): void {
    this.showOnline(kind);
    this.emit();
  }

  /** Online và đăng nhập xong thì làm việc đã chọn trước đó; Online không thành thì bỏ. */
  private runIntent(state: SessionState): void {
    const intent = this.intent;
    if (!intent) return;
    if (state === 'idle' || state === 'error' || state === 'incompatible' || state === 'full') {
      this.intent = null;
      return;
    }
    const s = this.session;
    if (state !== 'monitoring' || s.mode !== 'online' || !s.auth) return;
    this.intent = null;
    if (intent === 'compare') {
      if (this.store.state.project) this.openEditor('compare');
      else this.toast(t('upload.noProject'));
    } else void this.uploadNew();
  }

  /**
   * Đọc lên phần chọn của So sánh (FR-030): lấy đối tượng của dòng từ thiết bị vào project trên máy thành một bước
   * sửa chưa lưu (Ctrl+Z hoàn tác). Báo kết quả bằng thông báo ngắn.
   */
  async takeFromDevice(row: { kind: string; key: string }): Promise<void> {
    const compare = this.compare;
    const result = this.session.compare.info?.result;
    const object = result?.objects.find((o) => o.kind === row.kind && o.key === row.key);
    if (!compare || !object) return;
    const label = `${t(('compare.kind.' + object.kind) as MessageKey)} ${object.key}`;
    const r = await compare.take([object]);
    if (isDeviceError(r))
      this.toast(t('compare.take.failed', { reason: compareErrorText(r.error) }));
    else if (r.applied.length) this.toast(t('compare.take.done', { object: label }));
    else this.toast(t('compare.take.skipped', { object: label }));
  }

  /** Hộp thoại Đọc lên: người dùng chọn "Thành project mới" hoặc "So với project đang mở". */
  startUpload(mode: 'new' | 'compare'): void {
    if (this.u.dialog?.kind === 'upload') this.u = { ...this.u, dialog: null };
    if (mode === 'compare') {
      if (this.store.state.project) this.openEditor('compare');
      else this.toast(t('upload.noProject'));
      this.emit();
      return;
    }
    void this.uploadNew();
  }

  /**
   * Đọc lên thành project mới (FR-028): hỏi lưu nếu project đang mở còn sửa dở; lấy gói đang chạy (Rust kiểm như
   * thiết bị); hộp thoại chọn thư mục rỗng; giải nén; mở project mới (gắn với thiết bị này) và báo kết luận kiểm tra
   * cùng việc digest có giống thiết bị không (US3-3).
   */
  async uploadNew(): Promise<void> {
    const link = this.link;
    const compare = this.compare;
    const s = this.session;
    const id = s.deviceId;
    if (!link || !compare || !id) return;
    if (s.auth?.role !== 'engineer' && s.auth?.role !== 'administrator') {
      this.toast(t('upload.needEngineer'));
      return;
    }
    if (this.store.state.project && !(await this.settleUnsaved())) return;
    const fail = (reason: string) => this.toast(t('upload.err', { reason }));
    this.toast(t('upload.fetching'));
    const pkg = await link.fetchPackage(id).catch((e: unknown) => deviceError(e));
    if (isDeviceError(pkg)) return fail(uploadErrorText(pkg));
    try {
      const r = await link.extractPackage(pkg.packageId).catch((e: unknown) => deviceError(e));
      if (r === null) return; // người dùng hủy hộp thoại chọn thư mục
      if (isDeviceError(r)) return fail(uploadErrorText(r));
      await this.store.openPicked(r.display);
      this.checkVersionGate();
      this.bindDevice(id);
      await this.store.idle();
      const { errors, warnings } = this.counts();
      const digest = await compare.localDigest();
      this.toast(
        t('upload.done', {
          name: pkg.manifest.project.projectName,
          dir: r.display,
          check:
            errors + warnings === 0
              ? t('upload.check.ok')
              : t('upload.check.issues', { errors, warnings }),
          digest: digest === pkg.digest ? t('upload.digest.same') : t('upload.digest.differ'),
        }),
      );
      this.openEditor('start');
      void compare.refresh();
    } finally {
      void link.discardPackage(pkg.packageId).catch(() => undefined);
    }
  }

  /** Người dùng xác nhận fingerprint (FR-008). */
  confirmPin(): Promise<void> {
    return this.session.confirmPin();
  }

  /** Gỡ ghim sau khi người dùng xác nhận rõ (FR-008). */
  unpin(): Promise<void> {
    return this.session.unpin();
  }

  /**
   * Đăng nhập, đăng nhập lại; mật khẩu chuyển thẳng xuống Rust, không giữ. Đăng nhập được thì đọc lại danh sách
   * đã lưu: Rust vừa cập nhật thiết bị (tài khoản gần nhất; tên thiết bị báo cho thiết bị thêm theo địa chỉ).
   */
  async login(user: string, password: string): Promise<void> {
    await this.session.login(user, password);
    if (this.session.auth) await this.refreshDevices();
  }

  /** Hủy bước ghim hoặc đăng nhập (về Offline); `back` thì quay về danh sách thiết bị. */
  cancelOnline(back: boolean): void {
    this.session.disconnect();
    if (back) void this.openDevices(false);
    else this.emit();
  }

  /**
   * Đóng hộp thoại Online đang mở (Esc, nút đóng). Đang chờ đăng nhập lại hay đang chặn vì chứng chỉ đổi thì
   * giữ phiên (thanh trạng thái nói lý do, mở lại được); đang dò chứng chỉ, bước ghim, đăng nhập lần đầu thì
   * hủy kết nối (không bật hộp thoại của bước sau khi người dùng đã đóng).
   */
  closeOnlineDialog(): void {
    const cur = this.u.dialog;
    if (!isOnlineDialog(cur)) return;
    if (cur.kind === 'download' || cur.kind === 'restore') {
      // Đang chạy trên thiết bị thì không đóng được (Esc bị bỏ qua).
      this.deploy?.close();
      this.emit();
      return;
    }
    if (cur.kind === 'upgrade') {
      void this.cancelUpgrade();
      return;
    }
    if (cur.kind === 'refused') {
      this.u = { ...this.u, dialog: null };
      this.emit();
      return;
    }
    const s = this.session;
    this.u = { ...this.u, dialog: null };
    const cancel =
      (s.mode === 'online' && s.state === 'probing') ||
      (cur.kind === 'pin' && s.state === 'pin-confirm') ||
      (cur.kind === 'login' && s.state === 'login');
    if (cancel) this.session.disconnect();
    this.emit();
  }

  /**
   * Online › Đăng nhập…: đăng nhập lại khi phiên hết hạn; không thì Online thiết bị gắn với project (T085a),
   * hoặc thiết bị Online gần nhất; chưa có thì mở Thiết bị trong mạng.
   */
  private async loginCommand(): Promise<void> {
    const s = this.session;
    if (s.state === 'relogin' || s.state === 'login') {
      this.showOnline('login');
      this.emit();
      return;
    }
    if (s.state === 'pin-confirm') {
      this.showOnline('pin');
      this.emit();
      return;
    }
    if (!this.link) return;
    const k = (await this.boundDevice()) ?? this.lastOnline;
    if (k) {
      this.syncSessionTags();
      s.goOnline(k);
    } else await this.openDevices();
  }

  /** Online › Đăng xuất: về Offline, Rust xóa token, thiết bị ghi audit. */
  private async logout(): Promise<void> {
    const name = this.session.device?.name ?? '';
    await this.session.logout();
    this.toast(t('online.toast.loggedOut', { name }));
  }
}
