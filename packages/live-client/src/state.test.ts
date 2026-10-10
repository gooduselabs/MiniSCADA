// Máy trạng thái thuần của client dữ liệu sống, protocol 1.0.0
// (specs/002-vertical-slice/contracts/live-ws.md). Giữ các quy tắc Sprint 0 (review I-5, S-5).
import { describe, expect, it } from 'vitest';
import {
  applyMessage,
  createLiveState,
  heartbeatReply,
  isCompatibleProtocol,
  parseServerMessage,
  staleChanges,
} from './state.ts';

const snapshot = (sequence: number, subscriptionId = 'r1') => ({
  type: 'snapshot',
  subscriptionId,
  sequence,
  ts: 1000,
  tags: [
    { id: 'TANK01.LEVEL', value: 10, quality: 'GOOD', revision: 1 },
    { id: 'MOTOR01.RUN', value: true, quality: 'GOOD', revision: 1 },
    { id: 'CNT', value: '9007199254740993', quality: 'BAD', revision: 1 },
    { id: 'NONE', value: null, quality: 'BAD', revision: 0 },
  ],
  unknown: ['X'],
});

const subscribed = (seq = 7) => {
  const st = createLiveState();
  st.expectedSubscription = 'r1';
  applyMessage(st, snapshot(seq));
  return st;
};

describe('snapshot', () => {
  it('nạp Tag theo thứ tự, giữ đúng kiểu giá trị và trả mọi Tag là đã đổi', () => {
    const st = subscribed();
    expect(st.ids).toEqual(['TANK01.LEVEL', 'MOTOR01.RUN', 'CNT', 'NONE']);
    expect(st.values).toEqual([10, true, '9007199254740993', null]);
    expect(st.unknown).toEqual(['X']);
    expect(st.sequence).toBe(7);
    expect(st.subscriptionId).toBe('r1');
    expect(st.hasSnapshot).toBe(true);
  });

  it('bỏ snapshot của đăng ký cũ khi đang chờ đăng ký mới', () => {
    const st = subscribed();
    st.expectedSubscription = 'r2';
    expect(applyMessage(st, snapshot(20, 'r1'))).toEqual([]);
    expect(st.sequence).toBe(7);
    expect(applyMessage(st, snapshot(21, 'r2')).length).toBe(4);
    expect(st.subscriptionId).toBe('r2');
  });
});

describe('delta', () => {
  it('cập nhật theo chỉ số của snapshot và tăng sequence', () => {
    const st = subscribed();
    const changed = applyMessage(st, {
      type: 'delta',
      subscriptionId: 'r1',
      sequence: 8,
      ts: 1250,
      tags: [
        [0, 55.5, 'GOOD'],
        [1, false, 'BAD'],
      ],
    });
    expect(changed).toEqual([
      { id: 'TANK01.LEVEL', value: 55.5, quality: 'GOOD' },
      { id: 'MOTOR01.RUN', value: false, quality: 'BAD' },
    ]);
    expect(st.sequence).toBe(8);
    expect(st.seqGaps).toBe(0);
    expect(st.deltas).toBe(1);
    expect(st.lastDeltaTs).toBe(1250);
  });

  it('delta tới trước snapshot bị bỏ và không tính là mất sequence', () => {
    const st = createLiveState();
    st.expectedSubscription = 'r1';
    expect(
      applyMessage(st, {
        type: 'delta',
        subscriptionId: 'r1',
        sequence: 41,
        tags: [[0, 1, 'GOOD']],
      }),
    ).toEqual([]);
    applyMessage(st, snapshot(41));
    applyMessage(st, { type: 'delta', subscriptionId: 'r1', sequence: 42, tags: [] });
    expect(st.seqGaps).toBe(0);
    expect(st.needResync).toBe(false);
  });

  it('bỏ delta của đăng ký khác hoặc khi đang chờ đăng ký mới', () => {
    const st = subscribed();
    expect(
      applyMessage(st, {
        type: 'delta',
        subscriptionId: 'zz',
        sequence: 8,
        tags: [[0, 1, 'GOOD']],
      }),
    ).toEqual([]);
    st.expectedSubscription = 'r2';
    expect(
      applyMessage(st, {
        type: 'delta',
        subscriptionId: 'r1',
        sequence: 8,
        tags: [[0, 1, 'GOOD']],
      }),
    ).toEqual([]);
    expect(st.values[0]).toBe(10);
  });

  it('bước nhảy sequence → needResync; snapshot mới xóa cờ', () => {
    const st = subscribed(1);
    applyMessage(st, { type: 'delta', subscriptionId: 'r1', sequence: 50, tags: [] });
    expect(st.seqGaps).toBe(1);
    expect(st.needResync).toBe(true);
    applyMessage(st, snapshot(60));
    expect(st.needResync).toBe(false);
  });

  it('chỉ số không hợp lệ bị bỏ qua', () => {
    const st = subscribed(1);
    const changed = applyMessage(st, {
      type: 'delta',
      subscriptionId: 'r1',
      sequence: 2,
      tags: [[99, 1, 'GOOD'], [0.5, 1, 'GOOD'], [Number.NaN, 1, 'GOOD'], ['1', 1, 'GOOD'], 'x'],
    });
    expect(changed).toEqual([]);
  });
});

describe('hello, error, heartbeat', () => {
  it('hello lưu thông tin protocol 1.0.0', () => {
    const st = createLiveState();
    applyMessage(st, {
      type: 'hello',
      protocolVersion: '1.0.0',
      serverVersion: '0.2.0',
      maxClients: 10,
      heartbeatMs: 5000,
      timeoutMs: 15000,
      project: { projectId: 'tank-demo', projectVersion: '0.1.0' },
    });
    expect(st.hello).toEqual({
      protocolVersion: '1.0.0',
      serverVersion: '0.2.0',
      maxClients: 10,
      heartbeatMs: 5000,
      timeoutMs: 15000,
      project: { projectId: 'tank-demo', projectVersion: '0.1.0' },
    });
  });

  it('chỉ chấp nhận cùng MAJOR của protocol', () => {
    expect(isCompatibleProtocol('1.0.0')).toBe(true);
    expect(isCompatibleProtocol('1.4.2')).toBe(true);
    expect(isCompatibleProtocol('2.0.0')).toBe(false);
    expect(isCompatibleProtocol('')).toBe(false);
  });

  it('error được ghi nhận', () => {
    const st = createLiveState();
    applyMessage(st, { type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    expect(st.lastError).toEqual({ code: 'MAX_CLIENTS_REACHED', message: 'full' });
  });

  it('trả lời heartbeat để server giữ slot', () => {
    expect(heartbeatReply({ type: 'heartbeat', ts: 1 }, 99)).toEqual({ type: 'heartbeat', ts: 99 });
    expect(heartbeatReply({ type: 'delta' }, 99)).toBeNull();
  });

  it('mất kết nối: mọi Tag chuyển STALE, giữ giá trị cuối', () => {
    const st = subscribed();
    expect(staleChanges(st)).toEqual([
      { id: 'TANK01.LEVEL', value: 10, quality: 'STALE' },
      { id: 'MOTOR01.RUN', value: true, quality: 'STALE' },
      { id: 'CNT', value: '9007199254740993', quality: 'STALE' },
      { id: 'NONE', value: null, quality: 'STALE' },
    ]);
  });

  it('bản tin không phải JSON object trả về null', () => {
    expect(parseServerMessage('{oops')).toBeNull();
    expect(parseServerMessage('42')).toBeNull();
    expect(parseServerMessage('{"type":"hello"}')).toEqual({ type: 'hello' });
  });
});
