// Máy trạng thái thuần của client /api/v1/live, protocol 1.0.0
// (specs/002-vertical-slice/contracts/live-ws.md) và phần thêm của 1.1.0
// (specs/005-device-online/contracts/live-protocol-1.1.md: `hello.project.digest`, mã đóng 1012).
// Không đụng WebSocket/DOM để test được; connection.ts lo phần kết nối.

export const PROTOCOL_MAJOR = 1;
export const CLOSE_MAX_CLIENTS = 4429;
// 4408 (im lặng quá hạn) và 4409 (tràn hàng đợi) không có xử lý riêng: kết nối lại theo backoff.
export const CLOSE_SILENT_SERVER = 4001;
/**
 * Protocol 1.1.0: máy chủ chạy lại để kích hoạt project mới hoặc quay về bản cũ ("Service Restart"). Client thử
 * lại nhanh (connection.ts); giá trị vẫn chuyển STALE như mọi lần mất kết nối.
 */
export const CLOSE_SERVICE_RESTART = 1012;
/**
 * Protocol 1.2.0 (specs/006-tags-modbus/contracts/live-protocol-1.2.md §3): `SESSION_ENDED`. Phiên đã dùng để mở kết nối
 * hết hạn hoặc bị thu hồi: không tự kết nối lại bằng token cũ (connection.ts gọi `onSessionEnded`).
 */
export const CLOSE_SESSION_ENDED = 4401;

export type TagValue = boolean | number | string | null;
export type Quality = 'GOOD' | 'BAD' | 'UNCERTAIN' | 'STALE';

export interface TagChange {
  id: string;
  value: TagValue;
  quality: Quality;
  /**
   * Protocol 1.2.0: mã lý do khi `quality` khác GOOD (data-model §6). Giữ nguyên chuỗi máy chủ gửi, kể cả mã lạ:
   * giao diện hiện "không rõ" kèm mã. Vắng khi GOOD hoặc máy chủ 1.1.0 trở xuống.
   */
  reason?: string;
}

export interface LiveError {
  code: string;
  message: string;
}

export interface HelloInfo {
  protocolVersion: string;
  serverVersion: string;
  maxClients: number;
  heartbeatMs: number;
  timeoutMs: number;
  /**
   * `null` khi thiết bị không có project hợp lệ. `digest` (protocol 1.1.0): digest nội dung của project đang chạy,
   * `null` khi thiết bị báo null; máy chủ 1.0.0 không gửi thì không có khóa này.
   */
  project: { projectId: string; projectVersion: string; digest?: string | null } | null;
}

export interface LiveState {
  ids: string[];
  values: TagValue[];
  qualities: Quality[];
  /** Mã lý do theo từng Tag (protocol 1.2.0); chuỗi rỗng khi không có. */
  reasons: string[];
  unknown: string[];
  sequence: number;
  subscriptionId: string;
  /** requestId của subscribe gần nhất đã gửi: snapshot/delta của đăng ký khác bị bỏ. */
  expectedSubscription: string;
  hasSnapshot: boolean;
  /** Đã thấy sequence nhảy: phải đăng ký lại để lấy snapshot mới. */
  needResync: boolean;
  seqGaps: number;
  deltas: number;
  lastDeltaTs: number;
  hello: HelloInfo | null;
  lastError: LiveError | null;
}

export type ServerMessage = Record<string, unknown> & { type?: unknown };

export function createLiveState(): LiveState {
  return {
    ids: [],
    values: [],
    qualities: [],
    reasons: [],
    unknown: [],
    sequence: 0,
    subscriptionId: '',
    expectedSubscription: '',
    hasSnapshot: false,
    needResync: false,
    seqGaps: 0,
    deltas: 0,
    lastDeltaTs: 0,
    hello: null,
    lastError: null,
  };
}

/** JSON → object; trả null nếu không phải JSON object (không ném lỗi trong onmessage). */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as ServerMessage) : null;
  } catch {
    return null;
  }
}

export function isCompatibleProtocol(version: string): boolean {
  const major = Number(/^(\d+)\./.exec(version)?.[1]);
  return major === PROTOCOL_MAJOR;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const QUALITIES = new Set(['GOOD', 'BAD', 'UNCERTAIN', 'STALE']);
const quality = (v: unknown): Quality => (QUALITIES.has(v as string) ? (v as Quality) : 'BAD');
const reasonOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const tagValue = (v: unknown): TagValue =>
  typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : null;

/** `project` của hello. `digest` chỉ nhận chuỗi hoặc null; thiếu (máy chủ 1.0.0) hay sai kiểu thì bỏ qua. */
function helloProject(p: Record<string, unknown>): NonNullable<HelloInfo['project']> {
  const out: NonNullable<HelloInfo['project']> = {
    projectId: str(p.projectId),
    projectVersion: str(p.projectVersion),
  };
  if (typeof p.digest === 'string' || p.digest === null) out.digest = p.digest;
  return out;
}

/** Thay đổi của Tag thứ `i`; `reason` chỉ có khi máy chủ gửi (protocol 1.2.0). */
function change(st: LiveState, i: number): TagChange {
  const out: TagChange = { id: st.ids[i], value: st.values[i], quality: st.qualities[i] };
  if (st.reasons[i]) out.reason = st.reasons[i];
  return out;
}

/** Áp một bản tin server vào state; trả về danh sách Tag đã đổi (để cập nhật DOM). */
export function applyMessage(st: LiveState, msg: ServerMessage): TagChange[] {
  switch (msg.type) {
    case 'hello': {
      const p = msg.project as Record<string, unknown> | null | undefined;
      st.hello = {
        protocolVersion: str(msg.protocolVersion),
        serverVersion: str(msg.serverVersion),
        maxClients: num(msg.maxClients),
        heartbeatMs: num(msg.heartbeatMs),
        timeoutMs: num(msg.timeoutMs),
        project: p && typeof p === 'object' ? helloProject(p) : null,
      };
      return [];
    }
    case 'snapshot': {
      const sub = str(msg.subscriptionId);
      if (st.expectedSubscription && sub !== st.expectedSubscription) return [];
      const tags = Array.isArray(msg.tags) ? (msg.tags as Array<Record<string, unknown>>) : [];
      st.ids = tags.map((t) => str(t.id));
      st.values = tags.map((t) => tagValue(t.value));
      st.qualities = tags.map((t) => quality(t.quality));
      st.reasons = tags.map((t) => reasonOf(t.reason));
      st.unknown = Array.isArray(msg.unknown) ? msg.unknown.map(str) : [];
      st.sequence = num(msg.sequence);
      st.subscriptionId = sub;
      st.hasSnapshot = true;
      st.needResync = false;
      return st.ids.map((_, i) => change(st, i));
    }
    case 'delta': {
      // Delta tới trước snapshot, của đăng ký khác, hoặc khi đang chờ đăng ký mới: bỏ.
      if (!st.hasSnapshot) return [];
      if (str(msg.subscriptionId) !== st.subscriptionId) return [];
      if (st.expectedSubscription && st.expectedSubscription !== st.subscriptionId) return [];
      const seq = num(msg.sequence);
      if (seq !== st.sequence + 1) {
        // Đã mất delta: không áp delta này (màn hình sẽ ghép giá trị mới với giá trị cũ của Tag
        // thuộc delta bị mất, chất lượng vẫn GOOD). Giữ nguyên trạng thái tới snapshot mới
        // (US3 kịch bản 3, audit FR-012).
        st.seqGaps++;
        st.needResync = true;
        return [];
      }
      st.sequence = seq;
      st.deltas++;
      st.lastDeltaTs = num(msg.ts);
      const changed: TagChange[] = [];
      const tags = Array.isArray(msg.tags) ? (msg.tags as unknown[]) : [];
      for (const entry of tags) {
        if (!Array.isArray(entry)) continue;
        const [index, value, q, reason] = entry as [unknown, unknown, unknown, unknown];
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= st.ids.length)
          continue;
        const i = index as number;
        st.values[i] = tagValue(value);
        st.qualities[i] = quality(q);
        st.reasons[i] = reasonOf(reason);
        changed.push(change(st, i));
      }
      return changed;
    }
    case 'error':
      st.lastError = { code: str(msg.code), message: str(msg.message) };
      return [];
    default:
      return [];
  }
}

/** Server chỉ giữ slot khi còn nhận dữ liệu từ client (im > 15 s → đóng 4408): echo heartbeat. */
export function heartbeatReply(
  msg: ServerMessage,
  now: number,
): { type: 'heartbeat'; ts: number } | null {
  return msg.type === 'heartbeat' ? { type: 'heartbeat', ts: now } : null;
}

/** Mất kết nối: giữ giá trị cuối nhưng đánh dấu STALE để không hiển thị như dữ liệu sống. */
export function staleChanges(st: LiveState): TagChange[] {
  return st.ids.map((_, i) => ({ ...change(st, i), quality: 'STALE' as const }));
}
