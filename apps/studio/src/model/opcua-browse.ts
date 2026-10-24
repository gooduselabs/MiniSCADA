// Lấy chứng chỉ và Duyệt node của kênh OPC UA qua thiết bị (feature 019, specs/019-driver-opcua/contracts/opcua.md
// §4): `POST /api/v1/drivers/opcua/browse` với `action: "endpoints"` hoặc `"browse"`. Không DOM. Studio không tự nối
// tới server OPC UA: BL335 nối thay (spec D12).
import type { Channel, TagV1 } from '@mat/project-schema';
import type { MessageKey } from '../i18n/index.ts';
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

export const BROWSE_PATH = '/api/v1/drivers/opcua/browse';
/** Gốc của cây duyệt: thư mục Objects. */
export const OBJECTS_NODE = 'i=85';

export interface OpcUaServerInfo {
  applicationUri: string;
  certSha256: string | null;
  certSubject: string | null;
  certNotAfter: string | null;
}

export interface OpcUaEndpoint {
  securityMode: string;
  securityPolicy: string;
  userTokens: string[];
}

export interface OpcUaReference {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  dataType?: string;
  tagType?: TagV1['type'];
  writable?: boolean;
  hasChildren: boolean;
}

export type BrowseFailure = 'rate' | 'badRequest' | 'audit' | 'device' | 'unknown';

export interface BrowseResult {
  ok: boolean;
  code: string;
  message?: string;
  elapsedMs?: number;
  server?: OpcUaServerInfo;
  endpoints: OpcUaEndpoint[];
  references: OpcUaReference[];
  truncated: boolean;
  failure?: BrowseFailure;
  retryAfterS?: number;
  issues?: string[];
  deviceError?: DeviceError;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const TAG_TYPES = new Set([
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
]);

/** Thân yêu cầu: khối `opcua` của kênh đang sửa (kênh chưa lưu cũng được). */
export function browseBody(
  channel: Channel,
  action: 'endpoints' | 'browse',
  nodeId?: string,
): object {
  return {
    channel: { id: channel.id, kind: 'opcua', opcua: channel.opcua ?? {} },
    action,
    ...(action === 'browse' ? { nodeId: nodeId ?? OBJECTS_NODE } : {}),
  };
}

/** Đọc trả lời của API (200 hay lỗi HTTP) thành kết quả cho giao diện. */
export function browseResultOf(res: ApiResult | DeviceError): BrowseResult {
  const empty: BrowseResult = {
    ok: false,
    code: '',
    endpoints: [],
    references: [],
    truncated: false,
  };
  if (isDeviceError(res)) return { ...empty, failure: 'device', deviceError: res };
  const body = isObj(res.body) ? res.body : {};
  if (res.status === 429)
    return {
      ...empty,
      code: 'TEST_RATE_LIMITED',
      failure: 'rate',
      ...(typeof body.retryAfterS === 'number' ? { retryAfterS: body.retryAfterS } : {}),
    };
  if (res.status === 400)
    return {
      ...empty,
      code: str(body.code) || 'BAD_REQUEST',
      failure: 'badRequest',
      issues: Array.isArray(body.issues)
        ? body.issues.filter(isObj).map((i) => String(i.code ?? ''))
        : [],
    };
  if (res.status === 503) return { ...empty, code: 'AUDIT_UNAVAILABLE', failure: 'audit' };
  if (res.status < 200 || res.status >= 300)
    return { ...empty, code: String(res.status), failure: 'unknown' };
  const out: BrowseResult = {
    ...empty,
    ok: body.ok === true,
    code: str(body.code),
    truncated: body.truncated === true,
  };
  if (typeof body.message === 'string') out.message = body.message;
  if (typeof body.elapsedMs === 'number') out.elapsedMs = body.elapsedMs;
  if (isObj(body.server))
    out.server = {
      applicationUri: str(body.server.applicationUri),
      certSha256: strOrNull(body.server.certSha256)?.toLowerCase() ?? null,
      certSubject: strOrNull(body.server.certSubject),
      certNotAfter: strOrNull(body.server.certNotAfter),
    };
  if (Array.isArray(body.endpoints))
    out.endpoints = body.endpoints.filter(isObj).map((e) => ({
      securityMode: str(e.securityMode),
      securityPolicy: str(e.securityPolicy),
      userTokens: Array.isArray(e.userTokens) ? e.userTokens.map(String) : [],
    }));
  if (Array.isArray(body.references))
    out.references = body.references
      .filter((r): r is Obj => isObj(r) && typeof r.nodeId === 'string' && r.nodeId !== '')
      .map((r) => {
        const ref: OpcUaReference = {
          nodeId: str(r.nodeId),
          browseName: str(r.browseName),
          displayName: str(r.displayName) || str(r.browseName) || str(r.nodeId),
          nodeClass: str(r.nodeClass),
          hasChildren: r.hasChildren === true,
        };
        if (typeof r.dataType === 'string') ref.dataType = r.dataType;
        if (typeof r.tagType === 'string' && TAG_TYPES.has(r.tagType))
          ref.tagType = r.tagType as TagV1['type'];
        if (typeof r.writable === 'boolean') ref.writable = r.writable;
        return ref;
      });
  return out;
}

/** Chứng chỉ đã hết hạn so với `nowMs` (hiện cảnh báo, không chặn: spec D10). */
export function certExpired(server: OpcUaServerInfo | undefined, nowMs: number): boolean {
  if (!server?.certNotAfter) return false;
  const t = Date.parse(server.certNotAfter);
  return Number.isFinite(t) && t < nowMs;
}

/** SHA-256 chia nhóm 4 ký tự cho dễ đọc khi đối chiếu với màn hình của server. */
export const groupHex = (hex: string): string => hex.replace(/(.{4})(?=.)/g, '$1 ');

/** Tên Tag gợi ý từ node chọn: tên hiển thị, ký tự lạ thành `_`, tránh trùng. */
export function suggestTagId(ref: OpcUaReference, taken: ReadonlySet<string>): string {
  const base =
    ref.displayName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9_.]/g, '_')
      .replace(/^[^A-Za-z]+/, '')
      .slice(0, 48) || 'UA';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Tag ngoài mới cho node `ref` trên thiết bị `device` (kiểu theo gợi ý của server, mặc định FLOAT64). */
export function tagFromReference(
  ref: OpcUaReference,
  device: string,
  taken: ReadonlySet<string>,
): TagV1 {
  const type = ref.tagType ?? 'FLOAT64';
  return {
    id: suggestTagId(ref, taken),
    kind: 'external',
    type,
    // Chỉ đọc: cho ghi (RW, giới hạn, quyền) là quyết định của kỹ sư ở Bảng Tag.
    source: {
      device,
      address: ref.nodeId,
      ...(type === 'STRING' ? { stringLength: 64 } : {}),
    },
  } as TagV1;
}

export interface BrowseDeps {
  post(path: string, body: object): Promise<ApiResult | DeviceError>;
  gate(): MessageKey | null;
}

export interface TreeEntry {
  ref: OpcUaReference;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export interface BrowseState {
  running: boolean;
  locked: MessageKey | null;
  /** Kết quả `endpoints` gần nhất (Lấy chứng chỉ). */
  cert: BrowseResult | null;
  /** Lỗi của lần duyệt gần nhất. */
  error: BrowseResult | null;
  /** Con theo NodeId cha (gốc: OBJECTS_NODE). */
  children: Map<string, OpcUaReference[]>;
  expanded: Set<string>;
  loading: Set<string>;
  /** Node có hơn 1000 con (trả lời `truncated`). */
  truncated: Set<string>;
}

/** Bộ chạy Lấy chứng chỉ và Duyệt node của một kênh: mỗi lúc một yêu cầu, nghe được. */
export class OpcUaBrowser {
  state: BrowseState = {
    running: false,
    locked: null,
    cert: null,
    error: null,
    children: new Map(),
    expanded: new Set(),
    loading: new Set(),
    truncated: new Set(),
  };
  private readonly deps: BrowseDeps;
  private readonly listeners = new Set<() => void>();

  constructor(deps: BrowseDeps) {
    this.deps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(next: Partial<BrowseState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  refreshLock(): void {
    const locked = this.deps.gate();
    if (locked !== this.state.locked) this.set({ locked });
  }

  private async call(body: object): Promise<BrowseResult | null> {
    const locked = this.deps.gate();
    if (locked) {
      this.set({ locked });
      return null;
    }
    try {
      return browseResultOf(await this.deps.post(BROWSE_PATH, body));
    } catch {
      return {
        ok: false,
        code: '',
        endpoints: [],
        references: [],
        truncated: false,
        failure: 'device',
        deviceError: { error: 'unreachable' },
      };
    }
  }

  /** Lấy chứng chỉ và endpoint của server (action endpoints). */
  async fetchCert(channel: Channel): Promise<void> {
    if (this.state.running) return;
    this.set({ running: true, locked: null, cert: null });
    const r = await this.call(browseBody(channel, 'endpoints'));
    this.set({ running: false, ...(r ? { cert: r } : {}) });
  }

  /** Mở (đọc con nếu chưa có) hoặc gập một node; `OBJECTS_NODE` nạp gốc. */
  async toggle(channel: Channel, nodeId: string): Promise<void> {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(nodeId) && nodeId !== OBJECTS_NODE) {
      expanded.delete(nodeId);
      this.set({ expanded });
      return;
    }
    expanded.add(nodeId);
    if (this.state.children.has(nodeId)) {
      this.set({ expanded });
      return;
    }
    if (this.state.loading.has(nodeId)) return;
    this.set({ expanded, loading: new Set([...this.state.loading, nodeId]), error: null });
    const r = await this.call(browseBody(channel, 'browse', nodeId));
    const loading = new Set(this.state.loading);
    loading.delete(nodeId);
    if (!r || !r.ok) {
      const ex = new Set(this.state.expanded);
      ex.delete(nodeId);
      this.set({ loading, expanded: ex, error: r });
      return;
    }
    const children = new Map(this.state.children);
    children.set(nodeId, r.references);
    const truncated = new Set(this.state.truncated);
    if (r.truncated) truncated.add(nodeId);
    this.set({ loading, children, truncated });
  }

  /** Các dòng của cây đang mở, theo thứ tự hiện. */
  rows(): TreeEntry[] {
    const out: TreeEntry[] = [];
    const walk = (parent: string, depth: number, seen: Set<string>) => {
      for (const ref of this.state.children.get(parent) ?? []) {
        const expanded = this.state.expanded.has(ref.nodeId);
        out.push({ ref, depth, expanded, loading: this.state.loading.has(ref.nodeId) });
        if (expanded && !seen.has(ref.nodeId))
          walk(ref.nodeId, depth + 1, new Set([...seen, ref.nodeId]));
      }
    };
    walk(OBJECTS_NODE, 0, new Set([OBJECTS_NODE]));
    return out;
  }

  /** Đổi kênh hoặc cấu hình: bỏ cây và chứng chỉ cũ. */
  reset(): void {
    this.set({
      running: false,
      cert: null,
      error: null,
      children: new Map(),
      expanded: new Set(),
      loading: new Set(),
      truncated: new Set(),
    });
  }
}
