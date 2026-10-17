// Logic của thiết bị giả (feature 011, T145; contracts/device-api-011.md §4, §5): `system/info.logic`, `GET /api/v1/logic`,
// `POST /api/v1/logic/writes` (chỉ `enabled: false`, administrator; `enabled: true` → 403 LOGIC_ENABLE_ROOT_ONLY),
// `POST /api/v1/logic/reset` (engineer). Runtime chưa cài các endpoint này (nhánh khác): thiết bị giả theo đúng contract để
// Studio và e2e thử trước. Trạng thái giữ riêng theo thiết bị giả.
import type { ApiResult, DeviceError, Role } from './device-types.ts';

export interface MockLogicBlock {
  id: string;
  kind: string;
  state: string;
  reason?: string | null;
  lastFired?: string;
  fired?: number;
  outputs?: Record<string, unknown>;
}

export interface MockLogicConfig {
  /** `logic.writes` của runtime.json (`off` mặc định) hoặc đã dừng bởi administrator. */
  writes: 'off' | 'on' | 'stopped';
  blocks?: MockLogicBlock[];
  /** Không có logic.json trên thiết bị: `GET /logic` trả `{"enabled": false}`. */
  present?: boolean;
}

interface LogicState {
  configured: 'off' | 'on';
  stopped: boolean;
  present: boolean;
  blocks: MockLogicBlock[];
  audit: string[];
  perMinute: number;
}

const states = new WeakMap<object, LogicState>();

const RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  operator: 1,
  engineer: 2,
  administrator: 3,
};

export function configure(dev: object, c: MockLogicConfig): void {
  states.set(dev, {
    configured: c.writes === 'off' ? 'off' : 'on',
    stopped: c.writes === 'stopped',
    present: c.present ?? true,
    blocks: (c.blocks ?? []).map((b) => ({ ...b })),
    audit: [],
    perMinute: 0,
  });
}

function stateOf(dev: object): LogicState {
  let s = states.get(dev);
  if (!s) {
    s = { configured: 'off', stopped: false, present: false, blocks: [], audit: [], perMinute: 0 };
    states.set(dev, s);
  }
  return s;
}

const writesOf = (s: LogicState): 'off' | 'on' | 'stopped' =>
  s.stopped ? 'stopped' : s.configured;

/** Khối `logic` của system/info (runtime ≥ 1.0.0). */
export function systemInfoBlock(dev: object): { present: boolean; writes: string } {
  const s = stateOf(dev);
  return { present: s.present, writes: writesOf(s) };
}

export function auditOf(dev: object): string[] {
  return [...stateOf(dev).audit];
}

export function get(dev: object): ApiResult {
  const s = stateOf(dev);
  if (!s.present) return { status: 200, body: { enabled: false } };
  return {
    status: 200,
    body: {
      enabled: true,
      writes: {
        configured: s.configured,
        runtimeEnabled: s.configured === 'on' && !s.stopped,
        perMinute: s.perMinute,
        limitPerMinute: 20,
      },
      scan: { periodMs: 100, lastMs: 1.8, p99Ms: 3.1 },
      blocks: s.blocks.map((b) => ({ reason: null, ...b })),
    },
  };
}

export function stopWrites(dev: object, role: Role): ApiResult | DeviceError {
  if (RANK[role] < RANK.administrator) return { error: 'forbidden' };
  const s = stateOf(dev);
  if (!s.stopped) {
    s.stopped = true;
    s.audit.push('logic.writes.disabled');
  }
  return { status: 200, body: { enabled: false } };
}

export function reset(
  dev: object,
  role: Role,
  block: string,
  value: number,
): ApiResult | DeviceError {
  if (RANK[role] < RANK.engineer) return { error: 'forbidden' };
  const s = stateOf(dev);
  const b = s.blocks.find((x) => x.id === block);
  if (!b) return { error: 'http', detail: 404 };
  if (b.outputs) for (const k of Object.keys(b.outputs)) b.outputs[k] = value;
  s.audit.push('logic.reset');
  return { status: 200, body: { id: block, value } };
}
