// Máy trạng thái thuần của client /api/v1/live, protocol 1.0.0
// (specs/002-vertical-slice/contracts/live-ws.md). Không đụng WebSocket/DOM để test được;
// connection.ts lo phần kết nối.

export const PROTOCOL_MAJOR = 1;
export const CLOSE_MAX_CLIENTS = 4429;
export const CLOSE_HEARTBEAT_TIMEOUT = 4408;
export const CLOSE_RESYNC = 4409;
export const CLOSE_SILENT_SERVER = 4001;

export type TagValue = boolean | number | string | null;
export type Quality = 'GOOD' | 'BAD' | 'UNCERTAIN' | 'STALE';

export interface TagChange {
  id: string;
  value: TagValue;
  quality: Quality;
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
  project: { projectId: string; projectVersion: string } | null;
}

export interface LiveState {
  ids: string[];
  values: TagValue[];
  qualities: Quality[];
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
const tagValue = (v: unknown): TagValue =>
  typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : null;

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
        project:
          p && typeof p === 'object'
            ? { projectId: str(p.projectId), projectVersion: str(p.projectVersion) }
            : null,
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
      st.unknown = Array.isArray(msg.unknown) ? msg.unknown.map(str) : [];
      st.sequence = num(msg.sequence);
      st.subscriptionId = sub;
      st.hasSnapshot = true;
      st.needResync = false;
      return st.ids.map((id, i) => ({ id, value: st.values[i], quality: st.qualities[i] }));
    }
    case 'delta': {
      // Delta tới trước snapshot, của đăng ký khác, hoặc khi đang chờ đăng ký mới: bỏ.
      if (!st.hasSnapshot) return [];
      if (str(msg.subscriptionId) !== st.subscriptionId) return [];
      if (st.expectedSubscription && st.expectedSubscription !== st.subscriptionId) return [];
      const seq = num(msg.sequence);
      if (seq !== st.sequence + 1) {
        st.seqGaps++;
        st.needResync = true;
      }
      st.sequence = seq;
      st.deltas++;
      st.lastDeltaTs = num(msg.ts);
      const changed: TagChange[] = [];
      const tags = Array.isArray(msg.tags) ? (msg.tags as unknown[]) : [];
      for (const entry of tags) {
        if (!Array.isArray(entry)) continue;
        const [index, value, q] = entry as [unknown, unknown, unknown];
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= st.ids.length)
          continue;
        const i = index as number;
        st.values[i] = tagValue(value);
        st.qualities[i] = quality(q);
        changed.push({ id: st.ids[i], value: st.values[i], quality: st.qualities[i] });
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
  return st.ids.map((id, i) => ({ id, value: st.values[i], quality: 'STALE' as const }));
}
