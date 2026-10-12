// Mô phỏng trong StudioApp (T203, FR-052, US6-1, US6-3, US6-5, SC-017): bật/tắt bằng lệnh `tools.simulate`; có giá trị đủ mọi Tag
// ngay khi bật (≤ 1 s); Online và Mô phỏng loại trừ nhau (hỏi rồi chuyển, không bao giờ chạy cùng lúc); ghi tay áp ngay, không
// đăng nhập, không audit; mọi chỗ hiện giá trị dùng nguồn mô phỏng; không gọi DeviceLink nào.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSession } from '../ui/fake-session.ts';
import { cleanup, newApp, newApp02, settled } from '../ui/test-helpers.ts';
import { newOnlineApp } from '../ui/online-test-helpers.ts';
import { full02 } from '../model/test-fixtures.ts';
import type { StudioApp } from './app.ts';
import { writeResultView } from '../ui/editors/watch-write.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function withFake() {
  const session = new FakeSession();
  session.fakeState = 'idle';
  const env = await newApp02({ session });
  // Phiên giả: ngắt thật sự đổi trạng thái về idle.
  const disconnect = vi.spyOn(session, 'disconnect').mockImplementation(() => {
    session.fakeState = 'idle';
    session.push({ type: 'state', state: 'idle' } as never);
  });
  return { ...env, session, disconnect };
}

const answer = async (app: StudioApp, choice: 'ok' | 'cancel') => {
  await Promise.resolve();
  app.answer(choice);
  await settled();
};

describe('lệnh Mô phỏng', () => {
  it('khóa khi chưa mở project, bật khi đã mở', async () => {
    const closed = await newApp({ open: false });
    expect(closed.app.enabled('tools.simulate')).toBe('reason.noProject');
    const { app } = await newApp02();
    expect(app.enabled('tools.simulate')).toBe(true);
  });

  it('bật: có giá trị đủ mọi Tag ngay (kể cả Tag tính toán), nhãn trạng thái; tắt: hết giá trị', async () => {
    const { app } = await newApp02();
    expect(app.simulating()).toBe(false);
    await app.run('tools.simulate');
    expect(app.simulating()).toBe(true);
    expect(app.valuesLive()).toBe(true);
    for (const id of ['TANK01.LEVEL', 'TANK01.SP_HI', 'TANK01.VOLUME', 'PUMP01.STATE_TEXT'])
      expect(app.readValue(id)?.quality, id).toBe('GOOD');
    const level = app.readValue('TANK01.LEVEL')!.value as number;
    expect(app.readValue('TANK01.VOLUME')!.value).toBe(Math.fround(level * 12.5));
    await app.run('tools.simulate');
    expect(app.simulating()).toBe(false);
    expect(app.readValue('TANK01.LEVEL')).toBeUndefined();
  });

  it('đổi Tag tính toán khi đang chạy thì giá trị theo biểu thức mới', async () => {
    const { app } = await newApp02();
    await app.run('tools.simulate');
    const row = (app.store.state.outline.tags!.tags as unknown as { id: string }[]).findIndex(
      (x) => x.id === 'TANK01.VOLUME',
    );
    app.store.edit([{ kind: 'tagField', index: row, field: 'expression', value: '7 * 6' }]);
    expect(app.readValue('TANK01.VOLUME')!.value).toBe(42);
  });

  it('báo cho người nghe giá trị (xem trước, lưới): Tag nào đổi', async () => {
    const { app } = await newApp02();
    const seen: string[][] = [];
    app.subscribeValues((ids) => seen.push([...ids]));
    await app.run('tools.simulate');
    expect(seen.at(-1)).toContain('TANK01.LEVEL');
  });

  it('project 0.1 mở chỉ đọc: Tag mock chạy bằng legacy-mock', async () => {
    const { app } = await newApp();
    await app.run('tools.simulate');
    const tags = (app.store.state.outline.tags!.tags as unknown as { id: string }[]).map(
      (x) => x.id,
    );
    expect(tags.length).toBeGreaterThan(0);
    expect(app.readValue(tags[0]!)?.quality).toBeDefined();
    expect(typeof app.readValue(tags[0]!)?.value).not.toBe('undefined');
  });

  it('đóng project thì tắt Mô phỏng', async () => {
    const { app } = await newApp02();
    await app.run('tools.simulate');
    await app.closeProject();
    expect(app.simulating()).toBe(false);
  });
});

describe('Online và Mô phỏng loại trừ nhau (US6-3)', () => {
  it('đang Online mà bật Mô phỏng: hỏi; Hủy giữ nguyên Online, Chuyển thì ngắt Online rồi bật Mô phỏng', async () => {
    const { app, session, disconnect } = await withFake();
    session.fakeState = 'monitoring';
    const first = app.run('tools.simulate');
    await Promise.resolve();
    expect(app.ui.dialog).toEqual({ kind: 'simSwitch', to: 'sim' });
    await answer(app, 'cancel');
    await first;
    expect(app.simulating()).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();
    expect(app.online()).toBe(true);

    const second = app.run('tools.simulate');
    await Promise.resolve();
    expect(app.ui.dialog).toEqual({ kind: 'simSwitch', to: 'sim' });
    await answer(app, 'ok');
    await second;
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(app.online()).toBe(false);
    expect(app.simulating()).toBe(true);
  });

  it('đang Mô phỏng mà bật Online (Ctrl+K): hỏi; Hủy giữ Mô phỏng, Chuyển thì tắt Mô phỏng rồi làm tiếp', async () => {
    const { app } = await withFake();
    await app.run('tools.simulate');
    const first = app.run('online.connect');
    await Promise.resolve();
    expect(app.ui.dialog).toEqual({ kind: 'simSwitch', to: 'online' });
    await answer(app, 'cancel');
    await first;
    expect(app.simulating()).toBe(true);
    expect(app.store.state.active).not.toBe('device');

    const second = app.run('online.connect');
    await Promise.resolve();
    await answer(app, 'ok');
    await second;
    expect(app.simulating()).toBe(false);
    expect(app.store.state.active).toBe('device');
  });

  it('phiên vào trạng thái hoạt động bằng đường khác khi đang Mô phỏng: Mô phỏng tắt, có báo; không bao giờ chạy cùng lúc', async () => {
    const { app, session } = await withFake();
    await app.run('tools.simulate');
    session.fakeState = 'monitoring';
    session.push({ type: 'state', state: 'monitoring' } as never);
    expect(app.simulating()).toBe(false);
    expect(app.online()).toBe(true);
    expect(app.ui.toast?.text).toContain('Mô phỏng');
  });
});

describe('không đụng thiết bị (FR-052, SC-017)', () => {
  it('bật, ghi tay, tắt: DeviceLink không có lời gọi nào, không đăng nhập, không audit', async () => {
    const env = await newOnlineApp({ files: full02() });
    const before = env.dev.control.calls.length;
    await env.app.run('tools.simulate');
    env.app.simWrite([{ key: 'k', tag: 'TANK01.SP', text: '55' }]);
    await env.app.run('tools.simulate');
    expect(env.dev.control.calls.length).toBe(before);
    expect(env.app.session.state).toBe('idle');
  });
});

describe('ghi tay vào Mô phỏng (FR-050, FR-052, US6-5)', () => {
  const sp = { key: 'a', tag: 'TANK01.SP', text: '55' };

  it('Tag RW: áp ngay, không đăng nhập; kết quả ghi rõ "mô phỏng"', async () => {
    const { app } = await newApp02();
    await app.run('tools.simulate');
    const r = app.simWrite([sp]);
    expect(r).toEqual({ written: 1, blocked: 0 });
    expect(app.readValue('TANK01.SP')!.value).toBe(55);
    const view = writeResultView(app.writes.flow.row('a'));
    expect(view?.tone).toBe('ok');
    expect(view?.text.toLowerCase()).toContain('mô phỏng');
  });

  it('Tag chỉ đọc, Tag tính toán, Tag không có, giá trị sai hoặc ngoài giới hạn: không ghi, kèm lý do', async () => {
    const { app } = await newApp02();
    await app.run('tools.simulate');
    const r = app.simWrite([
      { key: 'r', tag: 'TANK01.LEVEL', text: '1' },
      { key: 'c', tag: 'TANK01.VOLUME', text: '1' },
      { key: 'n', tag: 'KHONG.CO', text: '1' },
      { key: 'x', tag: 'TANK01.SP', text: 'abc' },
      { key: 'o', tag: 'TANK01.SP', text: '120' },
    ]);
    expect(r).toEqual({ written: 0, blocked: 5 });
    for (const k of ['r', 'c', 'n', 'x', 'o']) {
      const v = writeResultView(app.writes.flow.row(k));
      expect(v?.tone, k).toBe('err');
      expect(v?.text.length, k).toBeGreaterThan(5);
    }
    expect(app.readValue('TANK01.SP')!.value).not.toBe(120);
  });

  it('Tag tính toán phụ thuộc cập nhật ngay khi ghi', async () => {
    const { app } = await newApp02();
    await app.run('tools.simulate');
    app.store.edit([
      {
        kind: 'tagUpsert',
        tag: { id: 'SP2', kind: 'calculated', type: 'FLOAT64', expression: 'TANK01.SP * 2' },
      },
    ]);
    app.simWrite([sp]);
    expect(app.readValue('SP2')!.value).toBe(110);
  });

  it('lệnh Ghi của Bảng theo dõi bật khi đang Mô phỏng, không cần Online hay role', async () => {
    const { app } = await newApp02();
    app.openEditor('watch:van-hanh');
    expect(app.enabled('watch.write')).toBe('reason.notOnline');
    await app.run('tools.simulate');
    expect(app.enabled('watch.write')).toBe(true);
    expect(app.enabled('watch.writeAll')).toBe(true);
  });
});
