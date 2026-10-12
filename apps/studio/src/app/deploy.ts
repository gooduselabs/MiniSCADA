// Điều khiển hộp thoại Nạp xuống và Khôi phục (feature 005, US2, T124): giữ `DownloadFlow` đang chạy, danh sách bản
// lưu của thiết bị cho hộp thoại Khôi phục, và báo cho StudioApp mở, đóng hộp thoại. Không DOM, không chuỗi.
import { DownloadFlow } from '../model/download-flow.ts';
import type { DeviceSession } from '../model/device-session.ts';
import { deviceError, isDeviceError, type DeviceLink } from '../platform/device-types.ts';
import { createDownloadEnv, parseVersions, type VersionList } from './download-env.ts';
import type { StudioStore } from './store.ts';

export type DeployKind = 'download' | 'restore';

export type VersionsState =
  | { status: 'loading' }
  | { status: 'ready'; list: VersionList }
  | { status: 'error'; error: string };

export interface DeployHost {
  store: StudioStore;
  link: DeviceLink;
  session: DeviceSession;
  /** Lưu mọi file chưa lưu (hỏi khi xung đột); `true` khi đã lưu hết. */
  save: () => Promise<boolean>;
  /** Mở hộp thoại của `kind` (không đè hộp thoại 004 đang hỏi). */
  show: (kind: DeployKind) => void;
  /** Đóng hộp thoại của `kind`. */
  hide: (kind: DeployKind) => void;
  /** Báo giao diện vẽ lại. */
  emit: () => void;
}

const VERSIONS_PATH = '/api/v1/project/versions';

export class DeployController {
  private readonly host: DeployHost;
  private f: DownloadFlow | null = null;
  private k: DeployKind | null = null;
  private v: VersionsState = { status: 'loading' };
  /** Hộp thoại đã rời trạng thái `closed` ít nhất một lần (Khôi phục bắt đầu ở `closed`). */
  private started = false;

  constructor(host: DeployHost) {
    this.host = host;
  }

  get flow(): DownloadFlow | null {
    return this.f;
  }

  get kind(): DeployKind | null {
    return this.k;
  }

  get versions(): VersionsState {
    return this.v;
  }

  /** Có hộp thoại Nạp xuống hoặc Khôi phục đang chờ (kể cả lúc nhường chỗ cho hộp thoại khác). */
  get active(): boolean {
    return this.f !== null;
  }

  private begin(kind: DeployKind): DownloadFlow {
    this.f?.close();
    const flow = new DownloadFlow(
      createDownloadEnv({
        store: this.host.store,
        link: this.host.link,
        session: this.host.session,
        save: this.host.save,
      }),
    );
    this.f = flow;
    this.k = kind;
    this.started = false;
    flow.subscribe(() => {
      if (this.f !== flow) return;
      if (flow.state !== 'closed') this.started = true;
      else if (this.started) this.finish();
      this.host.emit();
    });
    return flow;
  }

  private finish(): void {
    const kind = this.k;
    this.f = null;
    this.k = null;
    this.started = false;
    if (kind) this.host.hide(kind);
    this.host.emit();
  }

  /** Ctrl+L: Nạp xuống thiết bị đang Online. */
  async openDownload(): Promise<void> {
    const flow = this.begin('download');
    this.host.show('download');
    this.host.emit();
    await flow.open();
  }

  /** Online › Khôi phục bản trước…: danh sách bản lưu của thiết bị. */
  async openRestore(): Promise<void> {
    const flow = this.begin('restore');
    this.v = { status: 'loading' };
    this.host.show('restore');
    this.host.emit();
    await this.loadVersions(flow);
  }

  private async loadVersions(flow: DownloadFlow): Promise<void> {
    const id = this.host.session.deviceId;
    const r = id
      ? await this.host.link.get(id, VERSIONS_PATH).catch((e: unknown) => deviceError(e))
      : { error: 'no-such-device' };
    if (this.f !== flow) return;
    if (isDeviceError(r)) this.v = { status: 'error', error: r.error };
    else {
      const list = parseVersions(r.body);
      this.v = list ? { status: 'ready', list } : { status: 'error', error: 'bad-response' };
    }
    this.host.emit();
  }

  /** Khôi phục bản `seq` đã chọn trong danh sách (digest đang chạy lấy từ chính danh sách đã xem). */
  async restore(seq: number): Promise<void> {
    const flow = this.f;
    if (!flow || this.k !== 'restore' || this.v.status !== 'ready') return;
    const { list } = this.v;
    const active = list.rows.find((r) => r.seq === list.active);
    await flow.restore(seq, active?.digest ?? 'none');
  }

  /** Đóng hộp thoại (Esc, Hủy, Đóng); không được khi đang chạy. */
  close(): boolean {
    const flow = this.f;
    if (!flow) return true;
    if (!flow.close()) return false;
    // `close()` của flow chỉ báo khi đang mở; Khôi phục ở màn danh sách chưa mở nên đóng thẳng.
    if (this.f === flow) this.finish();
    return true;
  }

  /**
   * Quay lại hộp thoại sau khi hộp thoại khác (đăng nhập lại) đã đóng: xem trước làm lại với phiên mới.
   * Trả `true` khi đã mở lại.
   */
  resume(): boolean {
    const kind = this.k;
    const flow = this.f;
    if (!kind || !flow) return false;
    this.host.show(kind);
    if (kind === 'download' && flow.state === 'preview') void flow.refresh();
    return true;
  }
}
