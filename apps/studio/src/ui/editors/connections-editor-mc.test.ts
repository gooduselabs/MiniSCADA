// Editor Kết nối với kênh Mitsubishi MC (feature 017, US4, FR-011): nút và lệnh "Thêm kênh Mitsubishi MC" (cần project 1.1),
// form theo nhóm Kết nối, Khung, Định tuyến, Gom yêu cầu, Ghi; module I/O hex; gợi ý mềm tại ô; chữ phụ trên cây;
// Thử kết nối chưa có cho MC; menu chuột phải của cây có lệnh; chẩn đoán hiện end code hex.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { commandById, reasonOf } from '../../app/commands.ts';
import { REPO, readProjectDir } from '../../model/test-fixtures.ts';
import { textOf } from '../online-test-helpers.ts';
import '../mat-tree.ts';
import type { MatTree } from '../mat-tree.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './connections-editor.ts';
import type { ConnectionsEditor } from './connections-editor.ts';

afterEach(() => cleanup());

const V11 = resolve(REPO, 'tests/project-vectors/v11-valid-full');
const channels = (app: StudioApp) => app.store.state.outline.connections?.channels ?? [];
const legends = (el: Element) =>
  [...el.querySelectorAll('.cn-form fieldset legend')].map((l) => textOf(l));
const input = (el: Element, id: string) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
async function change(el: Element, id: string, value: string) {
  const f = input(el, id);
  f.value = value;
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}

async function open(v11 = true) {
  const env = await newApp02(v11 ? { files: readProjectDir(V11) } : {});
  env.app.openEditor('connections');
  env.app.revealNode('connections');
  const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
  await settled(el);
  return { ...env, el };
}

describe('Thêm kênh Mitsubishi MC', () => {
  it('project 1.1: nút thêm kênh mc1, chọn nó; form Kết nối, Khung, Nâng cao; cổng mặc định 5007', async () => {
    const { app, el } = await open();
    expect(app.store.state.outline.format11).toBe(true);
    const btn = el.querySelector<HTMLButtonElement>('[data-act="add-channel-mc"]')!;
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(textOf(btn)).toBe('Thêm kênh Mitsubishi MC');
    btn.click();
    await settled(el);
    const added = channels(app).at(-1)!;
    expect(added).toMatchObject({ id: 'mc1', kind: 'mc', tcp: { host: '192.168.3.39' } });
    expect(app.ui.treeSel).toBe('channel:mc1');
    expect(textOf(el.querySelector('[data-node="channel:mc1"] .sub'))).toBe('MC 3E');
    expect(legends(el)).toEqual(['Kết nối', 'Khung', 'Nâng cao']);
    expect((input(el, 'cn-channel-mcHost') as HTMLInputElement).value).toBe('192.168.3.39');
    expect((input(el, 'cn-channel-mcPort') as HTMLInputElement).placeholder).toBe('5007');
    expect(textOf(el.querySelector('.cn-form h3'))).toBe('Mitsubishi MC: Kênh 1');
    // Một bước hoàn tác
    app.store.undo();
    await settled(el);
    expect(channels(app).some((c) => c.id === 'mc1')).toBe(false);
  });

  it('khung 4E, UDP: chữ phụ "MC 4E UDP"; gợi ý mềm UDP và cổng 502 tại ô', async () => {
    const { app, el } = await open();
    await app.run('connections.addMc');
    await settled(el);
    await change(el, 'cn-channel-mcFrame', '4E');
    await change(el, 'cn-channel-mcTransport', 'udp');
    expect(channels(app).at(-1)!.mc).toEqual({ frame: '4E', transport: 'udp' });
    expect(textOf(el.querySelector('[data-node="channel:mc1"] .sub'))).toBe('MC 4E UDP');
    expect(textOf(el.querySelector('#cn-channel-mcTransport-w'))).toMatch(/UDP/);
    await change(el, 'cn-channel-mcPort', '502');
    expect(textOf(el.querySelector('#cn-channel-mcPort-w'))).toMatch(/Modbus/);
    await change(el, 'cn-channel-mcPort', '70000');
    expect(textOf(el.querySelector('#cn-channel-mcPort-e'))).toMatch(/Ngoài khoảng/);
  });

  it('thiết bị trường MC: Định tuyến, Gom yêu cầu, Ghi; module I/O hex; Thử kết nối chưa có', async () => {
    const { app, el } = await open();
    await app.run('connections.addMc');
    await app.run('tree.add');
    await settled(el);
    expect(app.ui.treeSel).toBe('fdev:mc1-d1');
    expect(textOf(el.querySelector('[data-node="fdev:mc1-d1"] .sub'))).toBe('mạng 0 · trạm FF');
    expect(legends(el)).toEqual(['Kết nối', 'Định tuyến', 'Gom yêu cầu', 'Ghi']);
    const io = input(el, 'cn-device-moduleIo') as HTMLInputElement;
    expect(io.placeholder).toBe('03FF');
    expect(io.getAttribute('inputmode')).toBeNull();
    await change(el, 'cn-device-moduleIo', '3e0');
    expect(channels(app).at(-1)!.devices[0].moduleIo).toBe(0x3e0);
    expect((input(el, 'cn-device-moduleIo') as HTMLInputElement).value).toBe('03E0');
    await change(el, 'cn-device-moduleIo', 'xyz');
    expect(textOf(el.querySelector('#cn-device-moduleIo-e'))).toMatch(/hex/);
    await change(el, 'cn-device-station', '3');
    expect(textOf(el.querySelector('#cn-device-station-w'))).toMatch(/255 \(FF\)/);
    expect(textOf(el.querySelector('[data-node="fdev:mc1-d1"] .sub'))).toBe('mạng 0 · trạm 03');
    await change(el, 'cn-device-mcRegisterBit', 'rmw');
    expect(channels(app).at(-1)!.devices[0].write).toEqual({ registerBit: 'rmw' });
    expect(el.querySelector('[data-role="probe-mc"]')).not.toBeNull();
    expect(el.querySelector('[data-role="probe-run"]')).toBeNull();
  });

  it('project dưới 1.1: nút và lệnh khóa kèm lý do "cần định dạng 1.1", không thêm gì', async () => {
    const { app, el } = await open(false);
    const before = channels(app).length;
    const btn = el.querySelector<HTMLButtonElement>('[data-act="add-channel-mc"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title).toMatch(/định dạng 1\.1/);
    btn.click();
    await settled(el);
    expect(channels(app).length).toBe(before);
    expect(app.ui.toast?.text).toMatch(/định dạng 1\.1/);
    const cmd = commandById('connections.addMc')!;
    expect(reasonOf(cmd, app.commandContext())).toMatch(/định dạng 1\.1/);
    await app.run('connections.addMc');
    expect(channels(app).length).toBe(before);
  });
});

describe('cây project: menu chuột phải của Kết nối', () => {
  it('có "Thêm kênh Mitsubishi MC"; chạy từ menu thêm kênh MC', async () => {
    const { app } = await newApp02({ files: readProjectDir(V11) });
    const tree = await mount<MatTree>('mat-tree', app);
    app.revealNode('connections');
    await settled(tree);
    tree
      .querySelector<HTMLElement>('[id="ti-connections"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settled(tree);
    const item = document.querySelector<HTMLElement>('.tree-ctx [data-cmd="connections.addMc"]')!;
    expect(item).not.toBeNull();
    expect(textOf(item)).toMatch(/Thêm kênh Mitsubishi MC/);
    item.click();
    await settled(tree);
    expect(channels(app).at(-1)).toMatchObject({ id: 'mc1', kind: 'mc' });
    expect(app.ui.treeSel).toBe('channel:mc1');
    expect(textOf(tree.querySelector('[id="ti-channel:mc1"]'))).toMatch(/MC 3E/);
  });
});
