// Bộ chuyển giữa lệnh Rust của feature 005 và mã theo dõi của 004 (contracts/tauri-commands.md §6–7, §9,
// research R6). WebView không tự kết nối tới thiết bị nữa (CSP bỏ `http: ws:`): mọi request và WebSocket đi
// qua Rust. Mã của 004 đã có chỗ cắm nên chỉ cần bộ chuyển, không sửa giao thức:
// - `checkDevice` nhận `FetchFn`: `monitorFetch` (theo địa chỉ, `monitor_get`), `onlineFetch` (theo id,
//   `device_get`);
// - `LiveConnection` nhận `createSocket` (`SocketLike`): `liveSocket` bọc ba lệnh `live_open`, `live_send`,
//   `live_close`; `monitorSocket`, `onlineSocket` chọn đích. `@mat/live-client` không đổi giao diện.
import type { SocketLike } from '@mat/live-client';
import {
  deviceError,
  isDeviceError,
  type ApiResult,
  type DeviceError,
  type DeviceLink,
  type LiveEvent,
  type LiveTarget,
} from '../platform/device-types.ts';
import type { FetchFn } from './device.ts';

/**
 * Ba lệnh IPC của dữ liệu sống. `open` trả `liveId` (số u32 Rust cấp, tăng từ 1); sự kiện đến qua `onEvent`
 * theo đúng thứ tự gửi.
 */
export interface LiveIpc {
  open(target: LiveTarget, onEvent: (e: LiveEvent) => void): Promise<number>;
  send(liveId: number, text: string): Promise<void>;
  close(liveId: number, code?: number, reason?: string): Promise<void>;
}

/** Sự kiện đóng kèm lý do (mã lỗi bắt tay của Rust); SocketLike của live-client chỉ đọc `code`. */
export interface CloseInfo {
  code: number;
  reason?: string;
}

/**
 * SocketLike trên ba lệnh IPC, cư xử như WebSocket với LiveConnection:
 * - `send` trước khi `live_open` trả `liveId` (sự kiện `open` có thể tới trước) thì giữ lại, gửi theo thứ tự;
 * - `close` gọi `live_close` một lần; đóng sớm thì đóng ngay khi có `liveId`. Sau khi đóng thì không báo
 *   `open`, `message` nữa;
 * - `onclose` chỉ báo một lần, kèm `reason`. `live_open` bị từ chối thì báo close 1006, lý do là mã lỗi.
 */
export function liveSocket(ipc: LiveIpc, target: LiveTarget): SocketLike {
  let liveId: number | null = null;
  let ended = false;
  let closing: { code?: number; reason?: string } | null = null;
  const outbox: string[] = [];
  const ignore = () => undefined;
  const sock: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send(text: string) {
      if (ended || closing) return;
      if (liveId === null) outbox.push(text);
      // Gửi lỗi (kết nối đang đóng, quá 96 KiB) thì sự kiện close theo sau; không báo hai lần.
      else void ipc.send(liveId, text).catch(ignore);
    },
    close(code?: number, reason?: string) {
      if (closing) return;
      closing = { code, reason };
      outbox.length = 0;
      if (liveId !== null) void ipc.close(liveId, code, reason).catch(ignore);
    },
  };
  const finish = (info: CloseInfo) => {
    if (ended) return;
    ended = true;
    sock.onclose?.(info);
  };
  ipc
    .open(target, (e) => {
      if (ended) return;
      if (e.kind === 'close') finish({ code: e.code, reason: e.reason });
      else if (closing) return;
      else if (e.kind === 'open') sock.onopen?.();
      else sock.onmessage?.({ data: e.data });
    })
    .then(
      (id) => {
        liveId = id;
        if (closing) {
          void ipc.close(id, closing.code, closing.reason).catch(ignore);
          return;
        }
        for (const text of outbox.splice(0)) void ipc.send(id, text).catch(ignore);
      },
      (err: unknown) => finish({ code: 1006, reason: deviceError(err).error }),
    );
  return sock;
}

/**
 * Địa chỉ cho lệnh của chế độ theo dõi: `host:cổng` đúng như đã viết trong URL `http://`, `ws://` (giữ cả cổng
 * mặc định, khác `URL.host`). URL scheme khác (`https://`, `wss://`) giữ nguyên scheme để Rust từ chối
 * (`bad-address`, contract §12.7): chế độ này chỉ đi HTTP, không tự bỏ scheme rồi gọi HTTP (T085a).
 */
export function addressOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
  if (!m) return url;
  return /^(http|ws)$/i.test(m[1]) ? m[2] : `${m[1]}://${m[2]}`;
}

const pathOf = (url: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? url;

/** createSocket của chế độ theo dõi (004): `ws://host:port/api/v1/live` → `openLive({ address })`. */
export const monitorSocket =
  (link: DeviceLink) =>
  (url: string): SocketLike =>
    link.openLive({ address: addressOf(url) });

/** createSocket của chế độ online: theo id của thiết bị đã lưu; Rust mở `wss://` có ghim. */
export const onlineSocket =
  (link: DeviceLink, id: string): ((url: string) => SocketLike) =>
  () =>
    link.openLive({ id });

const SYSTEM_INFO = '/api/v1/system/info';

/** Phản hồi tối thiểu `checkDevice` đọc: `ok`, `status`, `json()`. */
function responseOf(status: number, body: unknown, badBody = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (badBody) throw new SyntaxError('bad-response');
      return body;
    },
  } as unknown as Response;
}

/** Chờ tín hiệu hủy của `checkDevice` (hạn chót của nó) rồi từ chối: `checkDevice` báo `timeout`. */
const untilAborted = (signal: AbortSignal | null | undefined): Promise<never> =>
  new Promise<never>((_, reject) => {
    const fail = () => reject(new DOMException('timeout', 'AbortError'));
    if (!signal) fail();
    else if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });

/**
 * Đổi kết quả lệnh Rust sang thứ `checkDevice` hiểu, để giữ đúng mã của 004: `timeout` → chờ hạn chót của
 * `checkDevice`; `http` (hoặc `{ http: mã }`) → phản hồi lỗi HTTP; `bad-response` → thân hỏng; mã khác → lỗi
 * mạng (`network`, `detail` là mã).
 */
function toResponse(r: ApiResult | DeviceError, init?: RequestInit): Promise<Response> {
  if (!isDeviceError(r)) return Promise.resolve(responseOf(r.status, r.body));
  switch (r.error) {
    case 'timeout':
      return untilAborted(init?.signal);
    case 'http':
      return Promise.resolve(responseOf(typeof r.detail === 'number' ? r.detail : 500, null));
    case 'bad-response':
      return Promise.resolve(responseOf(200, null, true));
    // Lọc nguồn của trang xem (006, ADR-018): 403 như thiết bị trả.
    case 'viewer-private':
      return Promise.resolve(responseOf(403, { error: 'SOURCE_NOT_ALLOWED' }));
    case 'viewer-off':
      return Promise.resolve(responseOf(403, { error: 'VIEWER_OFF' }));
    default:
      return Promise.reject(new TypeError(typeof r.detail === 'string' ? r.detail : r.error));
  }
}

/**
 * FetchFn của chế độ theo dõi chỉ đọc: chỉ `GET /api/v1/system/info`, qua `monitor_get` theo `host:cổng`
 * (HTTP thường, như 004, FR-035). Đường dẫn khác bị từ chối ngay (`bad-path`).
 */
export function monitorFetch(link: DeviceLink): FetchFn {
  return async (url, init) => {
    if (pathOf(url) !== SYSTEM_INFO) throw new TypeError('bad-path');
    return toResponse(await link.monitorGet(addressOf(url)), init);
  };
}

/**
 * FetchFn của chế độ online: `device_get` theo id (HTTPS có ghim, token trong Rust). Lỗi của thiết bị
 * (`session-expired`, `cert-mismatch`…) được báo cho `onError` trước khi đổi sang mã của `checkDevice`, để
 * phiên online xử lý (đăng nhập lại, chặn kết nối).
 */
export function onlineFetch(
  link: DeviceLink,
  id: string,
  onError?: (e: DeviceError) => void,
): FetchFn {
  return async (url, init) => {
    const r = await link.get(id, pathOf(url));
    if (isDeviceError(r)) onError?.(r);
    return toResponse(r, init);
  };
}
