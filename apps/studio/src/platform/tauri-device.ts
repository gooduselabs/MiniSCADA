// DeviceLink chạy trong Tauri (feature 005, contracts/tauri-commands.md §2–7, §9): gọi lệnh Rust bằng
// `invoke`, luồng sự kiện (tìm thiết bị, dữ liệu sống) qua `Channel`, lỗi IPC đổi thành DeviceError. Ở chế
// độ build `e2e`, Vite thay file này bằng `mock-device.ts` (vite.config.ts), nên mọi chỗ trong Studio import
// `deviceLink` từ đây.
import { Channel, invoke } from '@tauri-apps/api/core';
import { liveSocket, type LiveIpc } from '../model/device-adapters.ts';
import {
  deviceError,
  loginPassword,
  type ApiResult,
  type DeployEvent,
  type DeployOperation,
  type DeviceError,
  type DeviceLink,
  type DiscoverEvent,
  type DiscoverSummary,
  type KnownDevice,
  type LiveEvent,
  type NetInterface,
  type PackageInfo,
  type ProbeResult,
  type SessionInfo,
  type UpdateFile,
} from './device-types.ts';
import { asReadFailure, type PickResult, type ReadOutcome } from './types.ts';

/** Bỏ khóa `undefined` (tham số tùy chọn không gửi). */
const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Lệnh trả kết quả hoặc DeviceError (không ném). */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | DeviceError> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    return deviceError(e);
  }
}

/** Lệnh không có DeviceError trong kiểu trả về: lỗi làm promise bị từ chối với DeviceError. */
async function must<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw deviceError(e);
  }
}

const liveIpc: LiveIpc = {
  async open(target, onEvent) {
    const onEventChannel = new Channel<LiveEvent>(onEvent);
    const r = await invoke<{ liveId: number }>('live_open', { target, onEvent: onEventChannel });
    return r.liveId;
  },
  async send(liveId, text) {
    await invoke('live_send', { liveId, text });
  },
  async close(liveId, code, reason) {
    await invoke('live_close', defined({ liveId, code, reason }));
  },
};

export const tauriDevice: DeviceLink = {
  netInterfaces: () => must<NetInterface[]>('net_interfaces'),
  discover(ifaces, onFound) {
    const onEvent = new Channel<DiscoverEvent>((e) => {
      if (e.kind === 'found') onFound(e.device);
    });
    return must<DiscoverSummary>('discover_run', { interfaces: ifaces, onEvent });
  },
  devices: () => must<KnownDevice[]>('devices_list'),
  addDevice: (input) => call<KnownDevice>('device_add', defined({ ...input })),
  updateDevice: (input) => call<KnownDevice>('device_update', defined({ ...input })),
  async forgetDevice(id) {
    await must('device_forget', { id });
  },
  probe: (id) => call<ProbeResult>('device_probe', { id }),
  pin: (id, fingerprint) => call<KnownDevice>('device_pin', { id, fingerprint }),
  unpin: (id, fingerprint) => call<KnownDevice>('device_unpin', { id, fingerprint }),
  // Mật khẩu tới Rust ở dạng dựng sẵn (NFC, ADR-011): thiết bị so đúng byte.
  login: (id, user, password) =>
    call<SessionInfo>('device_login', { id, user, password: loginPassword(password) }),
  async logout(id) {
    // Rust luôn xóa token, kể cả khi thiết bị không trả lời: giao diện coi như đã đăng xuất.
    await call('device_logout', { id });
  },
  session: (id) => must<SessionInfo | null>('device_session', { id }),
  get: (id, path, query) => call<ApiResult>('device_get', defined({ id, path, query })),
  post: (id, path, body) => call<ApiResult>('device_post', { id, path, body }),
  monitorGet: (address) => call<ApiResult>('monitor_get', { address }),
  openLive: (target) => liveSocket(liveIpc, target),
  // US2 (tauri-commands §8). Tên tham số JS là camelCase của tham số Rust (`package_id` → `packageId`).
  buildPackage: (files) => call<PackageInfo>('package_build', { files }),
  deploy: (id, packageId, baseDigest, onEvent) =>
    call<DeployOperation>('device_deploy', {
      id,
      packageId,
      baseDigest,
      onEvent: new Channel<DeployEvent>(onEvent),
    }),
  restore: (id, seq, baseDigest, onEvent) =>
    call<DeployOperation>('device_restore', {
      id,
      seq,
      baseDigest,
      onEvent: new Channel<DeployEvent>(onEvent),
    }),
  fetchPackage: (id, seq) => call<PackageInfo>('device_fetch_package', defined({ id, seq })),
  async readPackageFile(packageId, rel): Promise<ReadOutcome> {
    try {
      return await invoke<{ text: string; hash: string }>('package_read', { packageId, rel });
    } catch (e) {
      return { error: asReadFailure(e) };
    }
  },
  async discardPackage(packageId) {
    await must('package_discard', { packageId });
  },
  extractPackage: (packageId) => call<PickResult | null>('package_extract', { packageId }),
  // Feature 011 (T145): lệnh logic của `device/logic.rs`.
  logicGet: (id) => call<ApiResult>('logic_get', { id }),
  logicStopWrites: (id) => call<ApiResult>('logic_writes_stop', { id }),
  logicReset: (id, block, value) => call<ApiResult>('logic_reset', { id, block, value }),
  // Feature 011 (T119): OTA của `device/update.rs`. Mật khẩu tới Rust ở dạng dựng sẵn (NFC) như đăng nhập.
  updatePick: () => call<UpdateFile | null>('update_pick'),
  updateUpload: (id, fileId, onEvent) =>
    call<ApiResult>('device_update_upload', {
      id,
      fileId,
      onEvent: new Channel<DeployEvent>(onEvent),
    }),
  updateStatus: (id) => call<ApiResult>('device_update_status', { id }),
  updateApply: (id, updateId, password) =>
    call<ApiResult>('device_update_apply', {
      id,
      updateId,
      password: loginPassword(password),
    }),
  updateCancel: (id, updateId) => call<ApiResult>('device_update_cancel', { id, updateId }),
  updateRollback: (id, password) =>
    call<ApiResult>('device_update_rollback', { id, password: loginPassword(password) }),
};

export const deviceLink: DeviceLink = tauriDevice;
