// Điều phối lệnh Ghi của Bảng theo dõi (feature 006, T152, US2, FR-050): giữ `WriteFlow` (trạng thái từng dòng), định nghĩa Tag
// trên BL335 (`GET /api/v1/projects/active`) và bản xem trước đang chờ người dùng xác nhận. Không DOM. Mọi lệnh gửi đều qua
// `DeviceLink`; không bao giờ gửi lại lệnh khi chưa rõ kết quả (xem write-flow.ts).
import type { ApiResult, DeviceError, DeviceLink } from '../platform/device-types.ts';
import { isDeviceError } from '../platform/device-types.ts';
import {
  WriteFlow,
  deviceTagDefs,
  planWrite,
  type DeviceTagDef,
  type WriteDraft,
  type WritePlanContext,
  type WriteRowInput,
} from '../model/write-flow.ts';

export type DefsState = 'idle' | 'loading' | 'ready' | 'error';

export interface WriteControllerDeps {
  link: DeviceLink | null;
  deviceId(): string | null;
  /** Phiên hết hạn giữa lúc ghi: mở hộp thoại đăng nhập. */
  onRelogin(): void;
  /** Trạng thái đổi: giao diện vẽ lại. */
  onChange(): void;
}

export class WriteController {
  readonly flow: WriteFlow;
  private readonly deps: WriteControllerDeps;
  private defsMap: Map<string, DeviceTagDef> | null | undefined = undefined;
  private defsState: DefsState = 'idle';
  private digestValue: string | null = null;
  private pending: WriteDraft | null = null;

  constructor(deps: WriteControllerDeps) {
    this.deps = deps;
    this.flow = new WriteFlow({
      post: async (path, body) => {
        const id = deps.deviceId();
        return deps.link && id ? deps.link.post(id, path, body) : { error: 'unreachable' };
      },
      get: async (path, query) => {
        const id = deps.deviceId();
        return deps.link && id ? deps.link.get(id, path, query) : { error: 'unreachable' };
      },
      onRelogin: () => deps.onRelogin(),
    });
    this.flow.subscribe(() => deps.onChange());
  }

  /** Định nghĩa Tag trên BL335: `undefined` chưa đọc, `null` đọc lỗi. */
  get defs(): ReadonlyMap<string, DeviceTagDef> | null | undefined {
    return this.defsMap;
  }

  get state(): DefsState {
    return this.defsState;
  }

  /** Digest project đang chạy trên BL335 lúc đọc định nghĩa. */
  get digest(): string | null {
    return this.digestValue;
  }

  /** Bản xem trước đang chờ xác nhận (hộp thoại Xác nhận ghi). */
  get draft(): WriteDraft | null {
    return this.pending;
  }

  /** Đọc định nghĩa Tag trên BL335 (một lần mỗi phiên Online; gọi lại để làm mới). */
  async loadDefs(): Promise<void> {
    const id = this.deps.deviceId();
    if (!this.deps.link || !id || this.defsState === 'loading') return;
    this.defsState = 'loading';
    this.deps.onChange();
    const res: ApiResult | DeviceError = await this.deps.link
      .get(id, '/api/v1/projects/active')
      .catch((): DeviceError => ({ error: 'unreachable' }));
    if (isDeviceError(res)) {
      this.defsMap = null;
      this.defsState = 'error';
    } else {
      this.defsMap = deviceTagDefs(res.body);
      this.defsState = this.defsMap ? 'ready' : 'error';
      const d = (res.body as { digest?: unknown } | null)?.digest;
      this.digestValue = typeof d === 'string' ? d : null;
    }
    this.deps.onChange();
  }

  /** Rời Online: bỏ định nghĩa đã đọc và bản xem trước chờ xác nhận (không bỏ kết quả của các lệnh đã gửi). */
  reset(): void {
    this.defsMap = undefined;
    this.defsState = 'idle';
    this.digestValue = null;
    this.pending = null;
    this.deps.onChange();
  }

  /** Dựng bản xem trước cho các dòng; chưa gửi gì. */
  prepare(rows: readonly WriteRowInput[], ctx: Omit<WritePlanContext, 'defs'>): WriteDraft {
    this.pending = planWrite(rows, { ...ctx, defs: this.defsMap });
    this.deps.onChange();
    return this.pending;
  }

  cancel(): void {
    if (!this.pending) return;
    this.pending = null;
    this.deps.onChange();
  }

  /** Người dùng xác nhận rõ: gửi các dòng ghi được. Trả số dòng đã gửi. */
  async confirm(): Promise<number> {
    const draft = this.pending;
    this.pending = null;
    if (!draft) return 0;
    const items = draft.items.filter((i) => i.value !== undefined && !i.blocked);
    this.deps.onChange();
    await this.flow.submit(items.map((i) => ({ key: i.key, tag: i.tag, value: i.value! })));
    return items.length;
  }
}
