// Trang xem tự tải lại khi project trên thiết bị đổi (feature 005, FR-025; contracts/live-protocol-1.1.md §3, §5):
// so digest của `hello` với digest đã nhớ từ /api/v1/projects/active; máy chủ 1.0.0 không có digest thì so
// projectId + projectVersion. Đồng hồ giả.
// T104a: trang mở lúc thiết bị chưa có project hợp lệ (503) không mở WebSocket (không chiếm 1 trong 10 phiên,
// Constitution IV); hỏi lại /api/v1/projects/active mỗi 5 s cộng ngẫu nhiên 0–1 s, có project thì tải lại một lần.
import { LiveConnection, type HelloInfo, type SocketLike } from '@mat/live-client';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_POLL_JITTER_MS,
  PROJECT_POLL_MS,
  PROJECT_POLL_TIMEOUT_MS,
  ProjectPoller,
  RELOAD_MAX_DELAY_MS,
  RELOAD_MESSAGE,
  ReloadWatcher,
  activeStamp,
  helloStamp,
  projectChanged,
  watchProject,
  type ActiveResponse,
  type ProjectStamp,
} from './reload.ts';

const D1 = `sha256:${'1'.repeat(64)}`;
const D2 = `sha256:${'2'.repeat(64)}`;

class Clock {
  t = 0;
  timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clear = (id: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== id);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

const hello = (project: HelloInfo['project'], protocolVersion = '1.1.0'): HelloInfo => ({
  protocolVersion,
  serverVersion: '0.4.0',
  maxClients: 10,
  heartbeatMs: 5000,
  timeoutMs: 15000,
  project,
});

/** Thân 200 của /api/v1/projects/active (runtime 0.4.0 thêm khóa cấp đầu `digest`). */
const active = (projectVersion: string, digest?: string | null) => ({
  project: { format: 'matscada-project', projectId: 'tank-demo', projectVersion },
  tags: { schemaVersion: '0.1.0', tags: [] },
  screens: {},
  ...(digest === undefined ? {} : { digest }),
});

function setup(loaded: ProjectStamp | null, random: () => number = () => 0.5) {
  const clock = new Clock();
  const shown: string[] = [];
  let reloads = 0;
  const watcher = new ReloadWatcher(loaded, {
    reload: () => reloads++,
    show: (text) => shown.push(text),
    random,
    setTimer: clock.set,
  });
  return { clock, shown, watcher, reloads: () => reloads };
}

describe('ReloadWatcher (đồng hồ giả)', () => {
  it('digest của hello khác digest đã nhớ: hiện "Đang nạp project mới…", tải lại đúng một lần', () => {
    const h = setup(activeStamp(200, active('1.0.0', D1)));
    expect(
      h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D2 })),
    ).toBe(true);
    expect(h.shown).toEqual([RELOAD_MESSAGE]);
    expect(RELOAD_MESSAGE).toBe('Đang nạp project mới…');
    expect(h.watcher.pending).toBe(true);
    h.clock.advance(499); // random 0,5 → 500 ms
    expect(h.reloads()).toBe(0);
    h.clock.advance(1);
    expect(h.reloads()).toBe(1);
    // Kết nối lại trước khi trang kịp tải: không hẹn thêm, không hiện thêm.
    h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D2 }));
    h.clock.advance(10_000);
    expect(h.reloads()).toBe(1);
    expect(h.shown).toHaveLength(1);
  });

  it('khoảng chờ ngẫu nhiên nằm trong 0–1000 ms', () => {
    expect(RELOAD_MAX_DELAY_MS).toBe(1000);
    for (const [r, ms] of [
      [0, 0],
      [0.25, 250],
      [0.999, 999],
      [1, 1000],
    ] as const) {
      const h = setup(activeStamp(200, active('1.0.0', D1)), () => r);
      h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D2 }));
      if (ms > 0) {
        h.clock.advance(ms - 1);
        expect(h.reloads(), `random ${r}`).toBe(0);
      }
      h.clock.advance(1);
      expect(h.reloads(), `random ${r}`).toBe(1);
    }
  });

  it('chỉ một lần dù nhiều hello khác nhau tới trong lúc chờ', () => {
    const h = setup(activeStamp(200, active('1.0.0', D1)), () => 1);
    h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D2 }));
    h.clock.advance(300);
    h.watcher.check(hello(null));
    h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.1.0', digest: D1 }));
    h.clock.advance(5000);
    expect(h.reloads()).toBe(1);
    expect(h.shown).toEqual([RELOAD_MESSAGE]);
  });

  it('digest giống: không tải lại, không hiện gì', () => {
    const h = setup(activeStamp(200, active('1.0.0', D1)));
    expect(
      h.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D1 })),
    ).toBe(false);
    h.clock.advance(5000);
    expect(h.reloads()).toBe(0);
    expect(h.shown).toEqual([]);
    expect(h.watcher.pending).toBe(false);
    expect(h.watcher.check(null)).toBe(false); // chưa nhận hello
  });

  it('null ↔ có giá trị: tải lại', () => {
    const p = (digest: string | null) => ({
      projectId: 'tank-demo',
      projectVersion: '1.0.0',
      digest,
    });
    const cases: Array<[ProjectStamp | null, HelloInfo['project']]> = [
      // trang mở lúc thiết bị chưa có project hợp lệ (503), rồi có project
      [activeStamp(503, { error: 'NO_VALID_PROJECT', errors: [] }), p(D1)],
      // project trang đang hiện mất (thiết bị không còn project hợp lệ)
      [activeStamp(200, active('1.0.0', D1)), null],
      // digest null (project chưa vào kho) ↔ có digest
      [activeStamp(200, active('1.0.0', null)), p(D1)],
      [activeStamp(200, active('1.0.0', D1)), p(null)],
    ];
    for (const [loaded, project] of cases) {
      const h = setup(loaded);
      expect(h.watcher.check(hello(project)), JSON.stringify({ loaded, project })).toBe(true);
      h.clock.advance(RELOAD_MAX_DELAY_MS);
      expect(h.reloads()).toBe(1);
    }
  });

  it('không có project lúc mở trang, hello vẫn không có project: không tải lại', () => {
    const h = setup(activeStamp(503, { error: 'NO_VALID_PROJECT', errors: [] }));
    expect(h.watcher.check(hello(null))).toBe(false);
    h.clock.advance(5000);
    expect(h.reloads()).toBe(0);
  });

  it('máy chủ 1.0.0 không có digest: so projectId + projectVersion', () => {
    const loaded = activeStamp(200, active('1.0.0'));
    expect(loaded).toEqual({ projectId: 'tank-demo', projectVersion: '1.0.0' });
    const same = setup(loaded);
    expect(
      same.watcher.check(hello({ projectId: 'tank-demo', projectVersion: '1.0.0' }, '1.0.0')),
    ).toBe(false);
    for (const project of [
      { projectId: 'tank-demo', projectVersion: '1.0.1' },
      { projectId: 'other', projectVersion: '1.0.0' },
    ]) {
      const h = setup(loaded);
      expect(h.watcher.check(hello(project, '1.0.0')), project.projectId).toBe(true);
    }
  });

  it('một bên không có digest (trang mở từ runtime cũ, máy chủ đã lên 1.1.0): so projectId + projectVersion', () => {
    expect(
      projectChanged(
        { projectId: 'tank-demo', projectVersion: '1.0.0' },
        { projectId: 'tank-demo', projectVersion: '1.0.0', digest: D1 },
      ),
    ).toBe(false);
    expect(
      projectChanged(
        { projectId: 'tank-demo', projectVersion: '1.0.0', digest: D1 },
        { projectId: 'tank-demo', projectVersion: '1.1.0' },
      ),
    ).toBe(true);
    // Hai digest null: cũng so theo mã và phiên bản.
    expect(
      projectChanged(
        { projectId: 'tank-demo', projectVersion: '1.0.0', digest: null },
        { projectId: 'tank-demo', projectVersion: '1.0.0', digest: null },
      ),
    ).toBe(false);
    expect(projectChanged(null, null)).toBe(false);
  });
});

describe('activeStamp, helloStamp', () => {
  it('đọc project và khóa digest cấp đầu của /api/v1/projects/active', () => {
    expect(activeStamp(200, active('1.3.0', D1))).toEqual({
      projectId: 'tank-demo',
      projectVersion: '1.3.0',
      digest: D1,
    });
    expect(activeStamp(200, active('1.3.0', null))).toEqual({
      projectId: 'tank-demo',
      projectVersion: '1.3.0',
      digest: null,
    });
    // digest sai kiểu: bỏ qua như máy chủ không gửi
    expect(activeStamp(200, { ...active('1.3.0'), digest: 7 })).toEqual({
      projectId: 'tank-demo',
      projectVersion: '1.3.0',
    });
  });

  it('không có project hợp lệ (503) hoặc thân lạ: null', () => {
    expect(activeStamp(503, { error: 'NO_VALID_PROJECT', errors: [] })).toBeNull();
    expect(activeStamp(200, null)).toBeNull();
    expect(activeStamp(200, { project: 'x' })).toBeNull();
    expect(activeStamp(200, [])).toBeNull();
  });

  it('helloStamp: project của hello, giữ digest nếu có', () => {
    expect(helloStamp(hello(null))).toBeNull();
    expect(helloStamp(hello({ projectId: 'a', projectVersion: '1.0.0', digest: D1 }))).toEqual({
      projectId: 'a',
      projectVersion: '1.0.0',
      digest: D1,
    });
    expect(helloStamp(hello({ projectId: 'a', projectVersion: '1.0.0' }, '1.0.0'))).toEqual({
      projectId: 'a',
      projectVersion: '1.0.0',
    });
  });
});

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  sent: Array<{ type: string; requestId?: string }> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

describe('watchProject: nối vào LiveConnection', () => {
  function live(tags: string[], loaded: ProjectStamp | null) {
    const clock = new Clock();
    const sockets: FakeSocket[] = [];
    const conn = new LiveConnection({
      url: 'ws://dev/api/v1/live',
      tags,
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      random: () => 0,
      setTimer: clock.set,
      clearTimer: clock.clear,
    });
    let reloads = 0;
    const shown: string[] = [];
    const watcher = new ReloadWatcher(loaded, {
      reload: () => reloads++,
      show: (text) => shown.push(text),
      random: () => 0,
      setTimer: clock.set,
    });
    let subscribed = 0;
    conn.onSubscribed = () => subscribed++; // người nghe có sẵn vẫn được gọi
    watchProject(conn, watcher);
    const last = () => sockets[sockets.length - 1];
    /** Socket mới: mở, máy chủ gửi hello rồi trả kết quả đăng ký. */
    const accept = (project: HelloInfo['project']) => {
      last().onopen?.();
      last().msg({ ...hello(project), type: 'hello' });
      const sub = last().sent.find((m) => m.type === 'subscribe');
      if (sub)
        last().msg({
          type: 'snapshot',
          subscriptionId: sub.requestId,
          sequence: 1,
          tags: tags.map((id) => ({ id, value: 1, quality: 'GOOD' })),
          unknown: [],
        });
    };
    return {
      clock,
      conn,
      last,
      accept,
      reloads: () => reloads,
      shown,
      subscribed: () => subscribed,
    };
  }

  it('máy chủ đóng 1012, chạy lại với project mới: trang tải lại một lần', () => {
    const p = (digest: string) => ({ projectId: 'tank-demo', projectVersion: '1.0.0', digest });
    const h = live(['TANK01.LEVEL'], activeStamp(200, active('1.0.0', D1)));
    h.conn.start();
    h.accept(p(D1));
    expect(h.conn.state).toBe('live');
    expect(h.subscribed()).toBe(1);
    h.clock.advance(5000);
    expect(h.reloads()).toBe(0);
    h.last().onclose?.({ code: 1012 });
    h.clock.advance(1000); // thử lại nhanh sau 1012
    h.accept(p(D2));
    expect(h.subscribed()).toBe(2);
    expect(h.shown).toEqual([RELOAD_MESSAGE]);
    h.clock.advance(0);
    expect(h.reloads()).toBe(1);
  });

  // Trang xem không còn giữ phiên live khi chưa có project (T104a: hỏi lại bằng ProjectPoller); đây chỉ kiểm
  // watchProject với danh sách Tag rỗng.
  it('kết nối không đăng ký Tag nào, trang chưa có project: hello có project thì tải lại', () => {
    const h = live([], null);
    h.conn.start();
    h.accept(null);
    h.clock.advance(1000);
    expect(h.reloads()).toBe(0);
    h.last().onclose?.({ code: 1012 });
    h.clock.advance(1000);
    h.accept({ projectId: 'tank-demo', projectVersion: '1.0.0', digest: D1 });
    h.clock.advance(0);
    expect(h.reloads()).toBe(1);
  });
});

describe('ProjectPoller: trang mở lúc thiết bị chưa có project hợp lệ (T104a, đồng hồ giả)', () => {
  const NO_PROJECT: ActiveResponse = {
    status: 503,
    body: { error: 'NO_VALID_PROJECT', errors: [] },
  };
  const PROJECT: ActiveResponse = { status: 200, body: active('1.0.0', D1) };

  /** Lượt hỏi chờ test trả lời; `signal` là tín hiệu hủy poller truyền vào. */
  interface Ask {
    at: number;
    signal: AbortSignal;
    answer: (r: ActiveResponse) => void;
    fail: (e: unknown) => void;
  }

  function setup(randoms: number[] = [0.5]) {
    const clock = new Clock();
    const asks: Ask[] = [];
    const shown: string[] = [];
    let reloads = 0;
    let i = 0;
    const poller = new ProjectPoller({
      fetchActive: (signal) =>
        new Promise<ActiveResponse>((answer, fail) =>
          asks.push({ at: clock.t, signal, answer, fail }),
        ),
      reload: () => reloads++,
      show: (text) => shown.push(text),
      random: () => randoms[Math.min(i++, randoms.length - 1)],
      setTimer: clock.set,
      clearTimer: clock.clear,
    });
    /** Trả lời lượt hỏi gần nhất rồi cho các bước bất đồng bộ của poller chạy. */
    const reply = async (r: ActiveResponse | Error) => {
      const last = asks[asks.length - 1];
      if (r instanceof Error) last.fail(r);
      else last.answer(r);
      for (let k = 0; k < 5; k++) await Promise.resolve();
    };
    const advance = async (ms: number) => {
      clock.advance(ms);
      for (let k = 0; k < 5; k++) await Promise.resolve();
    };
    return { clock, poller, asks, shown, reloads: () => reloads, reply, advance };
  }

  it('hằng số: mỗi 5 s, cộng ngẫu nhiên 0–1 s; một lượt hỏi tối đa 5 s', () => {
    expect(PROJECT_POLL_MS).toBe(5000);
    expect(PROJECT_POLL_JITTER_MS).toBe(1000);
    expect(PROJECT_POLL_TIMEOUT_MS).toBe(5000);
  });

  it('chưa có project (503): hỏi lại /api/v1/projects/active sau 5 s cộng ngẫu nhiên 0–1 s, mỗi lần một lượt', async () => {
    const h = setup([0, 1, 0.5]);
    await h.advance(60_000);
    expect(h.asks).toEqual([]); // chưa start
    h.poller.start();
    await h.advance(60_000 + 4999 - h.clock.t);
    expect(h.asks).toHaveLength(0);
    await h.advance(1); // random 0 → 5000 ms
    expect(h.asks.map((a) => a.at)).toEqual([65_000]);
    await h.reply(NO_PROJECT);
    await h.advance(5999); // random 1 → 6000 ms
    expect(h.asks).toHaveLength(1);
    await h.advance(1);
    expect(h.asks.map((a) => a.at)).toEqual([65_000, 71_000]);
    await h.reply(NO_PROJECT);
    await h.advance(5500); // random 0,5 → 5500 ms
    expect(h.asks.map((a) => a.at)).toEqual([65_000, 71_000, 76_500]);
    expect(h.reloads()).toBe(0);
    expect(h.shown).toEqual([]);
  });

  it('có project: báo "Đang nạp project mới…", tải lại trang đúng một lần, thôi hỏi', async () => {
    const h = setup();
    h.poller.start();
    h.poller.start(); // gọi lại không hẹn thêm lượt
    await h.advance(5500);
    expect(h.asks).toHaveLength(1);
    await h.reply(NO_PROJECT);
    await h.advance(5500);
    await h.reply(PROJECT);
    expect(h.shown).toEqual([RELOAD_MESSAGE]);
    expect(h.reloads()).toBe(1);
    await h.advance(120_000);
    expect(h.asks).toHaveLength(2);
    expect(h.reloads()).toBe(1);
    h.poller.start(); // đã tải lại: không hỏi nữa
    await h.advance(60_000);
    expect(h.asks).toHaveLength(2);
  });

  it('lỗi mạng, mã HTTP khác, thân không phải project: hỏi tiếp lượt sau', async () => {
    const h = setup();
    h.poller.start();
    const answers: Array<ActiveResponse | Error> = [
      new TypeError('Failed to fetch'),
      { status: 500, body: null },
      { status: 200, body: { error: 'x' } },
      { status: 200, body: null },
    ];
    for (const [n, a] of answers.entries()) {
      await h.advance(5500);
      expect(h.asks, `lượt ${n + 1}`).toHaveLength(n + 1);
      await h.reply(a);
    }
    expect(h.reloads()).toBe(0);
    await h.advance(5500);
    await h.reply(PROJECT);
    expect(h.reloads()).toBe(1);
  });

  it('lượt hỏi chưa xong thì không hỏi chồng; treo quá 5 s thì hủy (abort) rồi hẹn lượt sau', async () => {
    const h = setup();
    h.poller.start();
    await h.advance(5500);
    expect(h.asks).toHaveLength(1);
    const first = h.asks[0];
    await h.advance(4999);
    expect(first.signal.aborted).toBe(false);
    expect(h.asks).toHaveLength(1);
    await h.advance(1); // quá hạn 5 s
    expect(first.signal.aborted).toBe(true);
    await h.advance(5499);
    expect(h.asks).toHaveLength(1);
    await h.advance(1);
    expect(h.asks.map((a) => a.at)).toEqual([5500, 16_000]);
    // Lượt cũ trả lời muộn (đã hủy): bỏ qua, không tải lại.
    first.answer(PROJECT);
    await h.advance(0);
    expect(h.reloads()).toBe(0);
    await h.reply(PROJECT);
    expect(h.reloads()).toBe(1);
  });

  it('stop(): thôi hỏi; lượt đang chờ trả lời có project cũng không tải lại', async () => {
    const h = setup();
    h.poller.start();
    await h.advance(5500);
    h.poller.stop();
    expect(h.asks[0].signal.aborted).toBe(true);
    await h.reply(PROJECT);
    await h.advance(60_000);
    expect(h.asks).toHaveLength(1);
    expect(h.reloads()).toBe(0);
  });
});
