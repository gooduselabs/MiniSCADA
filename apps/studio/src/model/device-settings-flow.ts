// Thiết lập thiết bị từ Studio (feature 027, specs/027-device-settings FR-007, ADR-054): đọc và lưu thiết lập
// (`/api/v1/admin/device-settings`), chứng chỉ (sinh lại, CSR, nhập) qua phiên Online có sẵn (Bearer của Rust). Sau khi đổi
// chứng chỉ, runtime khởi động lại với chứng chỉ mới: luồng dò lại, so fingerprint thấy với fingerprint thiết bị vừa trả, và
// chỉ ghim lại khi người dùng xác nhận (FR-008 của 005). Mật khẩu xác nhận chỉ đi qua lệnh, không giữ ở đây.
import {
  loweredKeys,
  overlayOf,
  parseDeviceSettings,
  sameFingerprint,
  type DeviceSettingKey,
  type DeviceSettingsInfo,
  type DeviceSettingsValues,
} from '@mat/access-model';
import {
  isDeviceError,
  loginPassword,
  type ApiResult,
  type DeviceError,
  type ProbeResult,
} from '../platform/device-types.ts';

export interface DeviceSettingsDeps {
  get(path: string): Promise<ApiResult | DeviceError>;
  post(path: string, body: object): Promise<ApiResult | DeviceError>;
  probe(): Promise<ProbeResult | DeviceError>;
  pin(fingerprint: string): Promise<unknown>;
  unpin(fingerprint: string): Promise<unknown>;
  /** Kết nối lại phiên Online sau khi ghim lại. */
  reconnect(): void;
  onChange(): void;
  /** Chờ (ms); test thay bằng hàm chạy ngay. */
  sleep?(ms: number): Promise<void>;
}

/** Lỗi của một thao tác: mã thiết bị (`REAUTH_REQUIRED`, `CONFLICT`, `CERT_KEY_MISMATCH`…) hoặc lỗi IPC. */
export interface FlowError {
  code: string;
  message: string;
}

export interface Repin {
  /** Fingerprint thiết bị trả khi đổi chứng chỉ. */
  expected: string;
  /** Fingerprint thấy khi dò lại sau khởi động lại; null khi chưa dò được. */
  seen: string | null;
  pinned: string | null;
  state: 'waiting' | 'confirm' | 'differs' | 'done' | 'failed';
}

export type SaveOutcome = 'saved' | 'needs-reauth' | 'error';

const errOf = (r: ApiResult | DeviceError): FlowError => {
  if (isDeviceError(r)) return { code: r.error, message: '' };
  const b = (r.body ?? {}) as Record<string, unknown>;
  return {
    code: typeof b.error === 'string' ? b.error : `HTTP_${r.status}`,
    message: typeof b.message === 'string' ? b.message : '',
  };
};
const ok = (r: ApiResult | DeviceError): r is ApiResult =>
  !isDeviceError(r) && r.status >= 200 && r.status < 300;
const body = (r: ApiResult): Record<string, unknown> => (r.body ?? {}) as Record<string, unknown>;

export class DeviceSettingsFlow {
  info: DeviceSettingsInfo | null = null;
  loading = false;
  busy = false;
  error: FlowError | null = null;
  /** Chữ báo kết quả gần nhất (mã i18n do giao diện chọn). */
  notice: 'saved' | 'saved-no-restart' | 'regen' | 'import' | 'csr' | null = null;
  csrPem = '';
  importWarnings: string[] = [];
  repin: Repin | null = null;
  readonly #d: DeviceSettingsDeps;

  constructor(d: DeviceSettingsDeps) {
    this.#d = d;
  }

  #sleep(ms: number): Promise<void> {
    return this.#d.sleep ? this.#d.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  async load(): Promise<void> {
    this.loading = true;
    this.#d.onChange();
    const r = await this.#d.get('/api/v1/admin/device-settings');
    this.loading = false;
    if (ok(r)) {
      this.info = parseDeviceSettings(r.body);
      this.error = null;
    } else this.error = errOf(r);
    this.#d.onChange();
  }

  /** Khóa giảm bảo vệ nếu lưu `edited` (giao diện hỏi mật khẩu trước khi gửi). */
  lowered(edited: DeviceSettingsValues): DeviceSettingKey[] {
    return this.info ? loweredKeys(this.info.effective, edited) : [];
  }

  async save(edited: DeviceSettingsValues, reauth?: string): Promise<SaveOutcome> {
    const s = this.info;
    if (!s || this.busy) return 'error';
    this.busy = true;
    this.error = null;
    this.#d.onChange();
    const r = await this.#d.post('/api/v1/admin/device-settings', {
      rev: s.rev,
      settings: overlayOf(s.base, edited),
      ...(reauth ? { reauth: loginPassword(reauth) } : {}),
    });
    this.busy = false;
    if (!ok(r)) {
      this.error = errOf(r);
      this.#d.onChange();
      return this.error.code === 'REAUTH_REQUIRED' ? 'needs-reauth' : 'error';
    }
    const restart = body(r).restart === true;
    this.notice = restart ? 'saved' : 'saved-no-restart';
    this.#d.onChange();
    if (restart) await this.#sleep(4000);
    await this.load();
    return 'saved';
  }

  async makeCsr(san: string[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.#d.onChange();
    const r = await this.#d.post('/api/v1/admin/cert/csr', { san });
    this.busy = false;
    if (ok(r)) {
      this.csrPem = typeof body(r).csrPem === 'string' ? (body(r).csrPem as string) : '';
      this.notice = 'csr';
    } else this.error = errOf(r);
    this.#d.onChange();
  }

  /** Sinh lại (`san`) hoặc nhập (`pem`) chứng chỉ; xong thì chờ runtime khởi động lại rồi dò để ghim lại. */
  async changeCert(
    op: { kind: 'regen'; san: string[] } | { kind: 'import'; pem: string },
    reauth: string,
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.#d.onChange();
    const r =
      op.kind === 'regen'
        ? await this.#d.post('/api/v1/admin/cert/regen', {
            reauth: loginPassword(reauth),
            san: op.san,
          })
        : await this.#d.post('/api/v1/admin/cert/import', {
            reauth: loginPassword(reauth),
            pem: op.pem,
          });
    this.busy = false;
    if (!ok(r)) {
      this.error = errOf(r);
      this.#d.onChange();
      return false;
    }
    const b = body(r);
    this.importWarnings = Array.isArray(b.warnings)
      ? b.warnings.filter((w): w is string => typeof w === 'string')
      : [];
    this.notice = op.kind;
    this.repin = {
      expected: typeof b.fingerprint === 'string' ? b.fingerprint : '',
      seen: null,
      pinned: null,
      state: 'waiting',
    };
    this.#d.onChange();
    await this.#waitForNewCert();
    return true;
  }

  async #waitForNewCert(): Promise<void> {
    const p = this.repin;
    if (!p) return;
    for (let i = 0; i < 15; i++) {
      await this.#sleep(i === 0 ? 3000 : 2000);
      const r = await this.#d.probe();
      if (isDeviceError(r)) continue;
      p.seen = r.fingerprint;
      p.pinned = r.pinned;
      if (sameFingerprint(r.fingerprint, p.expected)) {
        p.state = r.state === 'match' ? 'done' : 'confirm';
        this.#d.onChange();
        return;
      }
      if (r.pinned && sameFingerprint(r.fingerprint, r.pinned)) continue; // chưa khởi động lại
      p.state = 'differs';
      this.#d.onChange();
      return;
    }
    p.state = 'failed';
    this.#d.onChange();
  }

  /** Người dùng xác nhận fingerprint thấy đúng là fingerprint vừa đổi: bỏ ghim cũ, ghim mới, kết nối lại. */
  async confirmRepin(): Promise<boolean> {
    const p = this.repin;
    if (!p || p.state !== 'confirm' || !p.seen) return false;
    if (p.pinned) {
      const u = await this.#d.unpin(p.pinned);
      if (isDeviceError(u)) {
        p.state = 'failed';
        this.#d.onChange();
        return false;
      }
    }
    const r = await this.#d.pin(p.seen);
    if (isDeviceError(r)) {
      p.state = 'failed';
      this.#d.onChange();
      return false;
    }
    p.state = 'done';
    this.#d.onChange();
    this.#d.reconnect();
    return true;
  }
}
