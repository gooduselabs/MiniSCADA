// Editor Kết nối với kênh Siemens S7 (feature 016, US4): nút Thêm kênh Siemens S7, form theo khuôn Modbus (rack, slot, PDU,
// TSAP), kiểm tại ô, xung đột TSAP với rack/slot, một CPU mỗi kênh, Thử kết nối chưa hỗ trợ (ghi chú thay cho panel), lỗi
// E_DRIVER_VERSION của bộ kiểm tra khi project chưa ở định dạng 1.1.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { VALIDATE_DELAY_MS } from '../../app/store.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { textOf } from '../online-test-helpers.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './connections-editor.ts';
import type { ConnectionsEditor } from './connections-editor.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Project 1.1 có kênh Modbus TCP, RTU và kênh S7 `s7-1` (CPU `cpu1`, rack 0, slot 1 ghi rõ). */
const v11S7 = () => readProjectDir(resolve(REPO, 'tests/project-vectors/v11-s7-valid-channel'));

const channels = (app: StudioApp) => app.store.state.outline.connections?.channels ?? [];

async function open(node: string, files?: Record<string, string>) {
  const env = await newApp02(files ? { files } : {});
  env.app.openEditor('connections');
  env.app.revealNode(node);
  const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
  await settled(el);
  return { ...env, el };
}

const input = (el: Element, id: string) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
async function change(el: Element, id: string, value: string) {
  const f = input(el, id);
  f.value = value;
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}
async function validated(app: StudioApp, el: Element) {
  await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 40));
  await app.store.idle();
  await settled(el);
}

describe('mat-connections-editor: kênh Siemens S7', () => {
  it('Thêm kênh Siemens S7: kênh s7-1 có sẵn CPU, được chọn, form rack/slot/PDU, cổng gợi ý 102', async () => {
    const { app, el } = await open('connections', v11S7());
    const btn = el.querySelector<HTMLButtonElement>('[data-act="add-channel-s7"]')!;
    expect(textOf(btn)).toContain('Thêm kênh Siemens S7');
    btn.click();
    await settled(el);
    const ch = channels(app).at(-1)!;
    expect(ch.kind).toBe('s7');
    expect(ch.id).toBe('s7-2');
    expect(ch.devices.map((d) => d.id)).toEqual(['cpu2']);
    expect(app.ui.treeSel).toBe('channel:s7-2');
    expect(textOf(el.querySelector('.cn-form h3'))).toContain('Siemens S7');
    for (const id of ['rack', 'slot', 'pduSize', 'localTsap', 'remoteTsap'])
      expect(el.querySelector(`#cn-channel-${id}`)).not.toBeNull();
    expect((input(el, 'cn-channel-port') as HTMLInputElement).placeholder).toBe('102');
    expect(textOf(el.querySelector('#cn-channel-port-h'))).toContain('102');
    expect(el.querySelector('#cn-channel-serialPort')).toBeNull();
    expect(el.querySelector('.cn-ports')).toBeNull();
    // Danh sách bên trái: chữ phụ S7, CPU kèm rack/slot.
    expect(textOf(el.querySelector('[data-node="channel:s7-2"] .sub'))).toBe('S7');
    expect(textOf(el.querySelector('[data-node="fdev:cpu2"] .sub'))).toBe('rack 0 · slot 1');
  });

  it('kiểm tại ô: rack ngoài 0–7, TSAP không phải 4 chữ số hex; giá trị đúng ghi vào khối s7', async () => {
    const { app, el } = await open('channel:s7-1', v11S7());
    await change(el, 'cn-channel-rack', '9');
    expect(textOf(el.querySelector('#cn-channel-rack-e'))).toContain('Ngoài khoảng');
    expect(input(el, 'cn-channel-rack').getAttribute('aria-invalid')).toBe('true');
    await change(el, 'cn-channel-rack', '1');
    expect(el.querySelector('#cn-channel-rack-e')).toBeNull();
    await change(el, 'cn-channel-pduSize', '960');
    const s7 = channels(app).find((c) => c.id === 's7-1')!.s7;
    expect(s7).toMatchObject({ rack: 1, pduSize: 960 });
    await change(el, 'cn-channel-pduSize', '100');
    expect(textOf(el.querySelector('#cn-channel-pduSize-e'))).toContain('Ngoài khoảng');
    await change(el, 'cn-channel-remoteTsap', '3C1');
    expect(textOf(el.querySelector('#cn-channel-remoteTsap-e'))).toContain('4 chữ số hex');
  });

  it('TSAP đích cùng rack/slot: cảnh báo ngay tại ô, không chặn; bộ kiểm tra báo E_S7_TSAP', async () => {
    const { app, el } = await open('channel:s7-1', v11S7());
    await change(el, 'cn-channel-remoteTsap', '03c1');
    expect(channels(app).find((c) => c.id === 's7-1')!.s7?.remoteTsap).toBe('03C1');
    expect(textOf(el.querySelector('#cn-channel-slot-w'))).toContain('bỏ trống rack và slot');
    await validated(app, el);
    expect(textOf(el.querySelector('#cn-channel-remoteTsap-e'))).toContain('TSAP đích');
    await change(el, 'cn-channel-rack', '');
    await change(el, 'cn-channel-slot', '');
    expect(el.querySelector('#cn-channel-slot-w')).toBeNull();
  });

  it('CPU: không có Thử kết nối mà có ghi chú; nút Thêm thiết bị trường khóa kèm lý do', async () => {
    const { app, el } = await open('fdev:cpu1', v11S7());
    expect(el.querySelector('#cn-device-maxGapBytes')).not.toBeNull();
    expect(el.querySelector('#cn-device-unitId')).toBeNull();
    expect(el.querySelector('#cn-device-byteOrder')).toBeNull();
    expect(el.querySelector('.cn-probe [data-role="probe-run"]')).toBeNull();
    expect(textOf(el.querySelector('[data-role="probe-unsupported"]'))).toContain(
      'Thử kết nối chưa hỗ trợ kênh Siemens S7',
    );
    const add = el.querySelector<HTMLButtonElement>('[data-act="add-device"]')!;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.title).toContain('Mỗi kênh Siemens S7 là một CPU');
    const before = channels(app).find((c) => c.id === 's7-1')!.devices.length;
    add.click();
    await settled(el);
    expect(channels(app).find((c) => c.id === 's7-1')!.devices.length).toBe(before);
    // Kênh Modbus vẫn có Thử kết nối như cũ.
    app.revealNode('fdev:plc1');
    await settled(el);
    expect(el.querySelector('.cn-probe [data-role="probe-run"]')).not.toBeNull();
    expect(el.querySelector('[data-role="probe-unsupported"]')).toBeNull();
  });

  it('project chưa ở định dạng 1.1: vẫn thêm được kênh S7; form kênh báo cần định dạng 1.1', async () => {
    const { app, el } = await open('connections');
    el.querySelector<HTMLButtonElement>('[data-act="add-channel-s7"]')!.click();
    await settled(el);
    expect(channels(app).at(-1)!.kind).toBe('s7');
    expect(textOf(el.querySelector('[data-role="s7-version"]'))).toContain('định dạng 1.1');
    await validated(app, el);
    // Project 0.2: schema của tệp kết nối chưa có kênh s7, bộ kiểm tra báo tại kênh đó.
    expect(app.store.state.issues.some((i) => i.path.startsWith('/channels/2'))).toBe(true);
  });

  it('project 1.0 có kênh S7: lỗi E_DRIVER_VERSION của bộ kiểm tra hiện ở form kênh', async () => {
    const files = readProjectDir(resolve(REPO, 'tests/project-vectors/v11-s7-version-in-1.0'));
    const { app, el } = await open('channel:s7-1', files);
    await validated(app, el);
    expect(app.store.state.issues.some((i) => i.code === 'E_DRIVER_VERSION')).toBe(true);
    expect(textOf(el.querySelector('.cn-issues'))).toContain('định dạng 1.1');
    expect(el.querySelector('[data-role="s7-version"]')).not.toBeNull();
  });
});
