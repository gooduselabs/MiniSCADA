// Editor Kết nối với kênh OPC UA (feature 019, US5): nút Thêm kênh OPC UA, form (endpoint, bảo mật, xác thực, cách đọc),
// kiểm tại ô, cảnh báo chế độ/policy, ẩn username khi anonymous, một server mỗi kênh, Thử kết nối thay bằng ghi chú; Online:
// Lấy chứng chỉ → Tin chứng chỉ này ghi serverCertSha256, Duyệt node → Thêm Tag với NodeId và kiểu gợi ý.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { MOCK_OPCUA_CERT } from '../../platform/mock-device-006.ts';
import { newOnlineApp, pinnedDevice, textOf } from '../online-test-helpers.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './connections-editor.ts';
import type { ConnectionsEditor } from './connections-editor.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Project 1.1 có kênh Modbus TCP, RTU và kênh OPC UA `ua-1` (server `srv1`, None, anonymous). */
const v11Ua = () => readProjectDir(resolve(REPO, 'tests/project-vectors/v11-opcua-valid-channel'));

const channels = (app: StudioApp) => app.store.state.outline.connections?.channels ?? [];
const ua1 = (app: StudioApp) => channels(app).find((c) => c.id === 'ua-1')!;

async function open(node: string) {
  const env = await newApp02({ files: v11Ua() });
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

describe('mat-connections-editor: kênh OPC UA', () => {
  it('Thêm kênh OPC UA: kênh ua-2 có sẵn server, được chọn, form endpoint/bảo mật/xác thực', async () => {
    const { app, el } = await open('connections');
    const btn = el.querySelector<HTMLButtonElement>('[data-act="add-channel-opcua"]')!;
    expect(textOf(btn)).toContain('Thêm kênh OPC UA');
    btn.click();
    await settled(el);
    const ch = channels(app).at(-1)!;
    expect(ch.kind).toBe('opcua');
    expect(ch.id).toBe('ua-2');
    expect(ch.opcua?.endpointUrl).toBe('opc.tcp://192.168.1.20:4840');
    expect(ch.devices).toHaveLength(1);
    expect(ch.devices[0].timeoutMs).toBe(1000);
    expect(app.ui.treeSel).toBe('channel:ua-2');
    expect(textOf(el.querySelector('.cn-form h3'))).toContain('OPC UA');
    for (const id of [
      'endpointUrl',
      'securityMode',
      'securityPolicy',
      'authMode',
      'serverCertSha256',
      'readMode',
      'sessionTimeoutMs',
    ])
      expect(el.querySelector(`#cn-channel-${id}`), id).not.toBeNull();
    // anonymous: không có ô tên đăng nhập, secretId
    expect(el.querySelector('#cn-channel-username')).toBeNull();
    expect(el.querySelector('#cn-channel-host')).toBeNull();
    expect(textOf(el.querySelector('[data-node="channel:ua-2"] .sub'))).toBe('OPC UA');
    expect(textOf(el.querySelector(`[data-node="fdev:${ch.devices[0].id}"] .sub`))).toBe(
      '192.168.1.20:4840',
    );
    expect(el.querySelector('.cn-ua-cert')).not.toBeNull();
    expect(el.querySelector('.cn-ua-browse')).not.toBeNull();
  });

  it('kiểm tại ô: endpoint không phải opc.tcp, SHA-256 sai; giá trị đúng ghi vào khối opcua (SHA chữ thường)', async () => {
    const { app, el } = await open('channel:ua-1');
    await change(el, 'cn-channel-endpointUrl', 'http://10.0.0.5:4840');
    expect(textOf(el.querySelector('#cn-channel-endpointUrl-e'))).toContain('opc.tcp://');
    await change(el, 'cn-channel-endpointUrl', 'opc.tcp://10.0.0.5:4841/ua');
    expect(el.querySelector('#cn-channel-endpointUrl-e')).toBeNull();
    await change(el, 'cn-channel-serverCertSha256', 'abc');
    expect(textOf(el.querySelector('#cn-channel-serverCertSha256-e'))).toContain('64');
    await change(el, 'cn-channel-serverCertSha256', MOCK_OPCUA_CERT.toUpperCase());
    expect(ua1(app).opcua).toMatchObject({
      endpointUrl: 'opc.tcp://10.0.0.5:4841/ua',
      serverCertSha256: MOCK_OPCUA_CERT,
    });
  });

  it('chế độ và policy không khớp: cảnh báo tại ô policy; khớp thì hết', async () => {
    const { app, el } = await open('channel:ua-1');
    await change(el, 'cn-channel-securityMode', 'SignAndEncrypt');
    expect(textOf(el.querySelector('#cn-channel-securityPolicy-w'))).toContain('không khớp');
    await change(el, 'cn-channel-securityPolicy', 'Basic256Sha256');
    expect(el.querySelector('#cn-channel-securityPolicy-w')).toBeNull();
    expect(textOf(el.querySelector('#cn-channel-serverCertSha256-w'))).toContain('Chưa tin');
    expect(ua1(app).opcua).toMatchObject({
      securityMode: 'SignAndEncrypt',
      securityPolicy: 'Basic256Sha256',
    });
  });

  it('xác thực username: hiện tên đăng nhập và secretId, ghi chú --set-secret; về anonymous thì bỏ cả khối auth', async () => {
    const { app, el } = await open('channel:ua-1');
    await change(el, 'cn-channel-authMode', 'username');
    expect(ua1(app).opcua?.auth).toEqual({ mode: 'username' });
    expect(textOf(el.querySelector('#cn-channel-authMode-w'))).toContain('không mã hóa');
    await change(el, 'cn-channel-username', 'operator');
    await change(el, 'cn-channel-secretId', 'Opcua 1');
    expect(textOf(el.querySelector('#cn-channel-secretId-e'))).toContain('chữ thường');
    await change(el, 'cn-channel-secretId', 'opcua-ua-1');
    expect(ua1(app).opcua?.auth).toEqual({
      mode: 'username',
      username: 'operator',
      secretId: 'opcua-ua-1',
    });
    expect(textOf(el.querySelector('[data-role="opcua-secret"]'))).toContain(
      'mat-runtime --set-secret opcua-ua-1',
    );
    await change(el, 'cn-channel-authMode', 'anonymous');
    expect(ua1(app).opcua?.auth).toBeUndefined();
    expect(el.querySelector('#cn-channel-username')).toBeNull();
  });

  it('một server mỗi kênh: Thêm thiết bị khóa kèm lý do; trang server có ghi chú thay Thử kết nối', async () => {
    const { el } = await open('fdev:srv1');
    const add = el.querySelector<HTMLButtonElement>('[data-act="add-device"]')!;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.title).toContain('một server');
    expect(el.querySelector('[data-role="probe-run"]')).toBeNull();
    expect(textOf(el.querySelector('[data-role="probe-unsupported"]'))).toContain('Lấy chứng chỉ');
    expect(el.querySelector('#cn-device-unitId')).toBeNull();
    expect(input(el, 'cn-device-timeoutMs').getAttribute('placeholder')).toBe('2000');
  });

  it('Offline: Lấy chứng chỉ và Duyệt node khóa kèm lý do', async () => {
    const { el, app } = await open('channel:ua-1');
    const fetch = el.querySelector<HTMLButtonElement>('[data-role="ua-cert-fetch"]')!;
    expect(fetch.getAttribute('aria-disabled')).toBe('true');
    expect(textOf(el.querySelector('[data-role="ua-lock"]'))).toContain('Cần Online');
    fetch.click();
    expect(app.opcua.state.cert).toBeNull();
  });
});

describe('mat-connections-editor: OPC UA qua thiết bị', () => {
  async function online(role = 'kysu1') {
    vi.useFakeTimers();
    const env = await newOnlineApp({ files: v11Ua() });
    env.dev.control.setRuntime('BL335-01', '1.1.0');
    env.app.openEditor('connections');
    env.app.revealNode('channel:ua-1');
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(20);
    await env.app.login(role, env.pw(role));
    await vi.advanceTimersByTimeAsync(60);
    const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
    await vi.advanceTimersByTimeAsync(10);
    await settled(el);
    return { ...env, el };
  }
  const click = async (el: Element, sel: string) => {
    el.querySelector<HTMLButtonElement>(sel)!.click();
    await vi.advanceTimersByTimeAsync(300);
    await settled(el);
  };

  it('Lấy chứng chỉ: SHA-256, chủ thể, hạn, endpoint; Tin chứng chỉ này ghi serverCertSha256', async () => {
    const { el, app } = await online();
    await click(el, '[data-role="ua-cert-fetch"]');
    expect(textOf(el.querySelector('[data-role="ua-cert-sha"]')).replace(/ /g, '')).toBe(
      MOCK_OPCUA_CERT,
    );
    expect(el.textContent).toContain('CN=mat-opcua-sim');
    expect(el.querySelectorAll('.cn-ua-endpoints tbody tr')).toHaveLength(3);
    await click(el, '[data-role="ua-cert-trust"]');
    expect(ua1(app).opcua?.serverCertSha256).toBe(MOCK_OPCUA_CERT);
    expect(el.querySelector('[data-role="ua-cert-trusted"]')).not.toBeNull();
  });

  it('Duyệt node: Objects → Tank → Temp; Thêm Tag tạo Tag ngoài với NodeId, kiểu FLOAT32; Level đã có Tag nên là Cập nhật', async () => {
    const { el, app } = await online();
    await click(el, '[data-role="ua-browse"]');
    expect(el.querySelector('[data-node="ns=2;s=Tank"]')).not.toBeNull();
    await click(el, '[data-node="ns=2;s=Tank"] [data-act="ua-expand"]');
    const temp = el.querySelector('[data-node="ns=2;s=Tank.Temp"]')!;
    expect(textOf(temp)).toContain('Float');
    expect(temp.getAttribute('aria-level')).toBe('2');
    await click(el, '[data-node="ns=2;s=Tank.Temp"] [data-act="ua-add-tag"]');
    const tags = (app.store.state.outline.tags?.tags ?? []) as unknown as Array<{
      id: string;
      type: string;
      source?: { device: string; address: string };
    }>;
    const added = tags.find((t) => t.source?.address === 'ns=2;s=Tank.Temp')!;
    expect(added).toMatchObject({ id: 'Temp', type: 'FLOAT32', source: { device: 'srv1' } });
    expect(
      textOf(el.querySelector('[data-node="ns=2;s=Tank.Level"] [data-act="ua-add-tag"]')),
    ).toContain('Cập nhật');
  });

  it('kênh có mã hóa chưa tin chứng chỉ: Duyệt node báo OPCUA_CERT_UNTRUSTED', async () => {
    const { el, app } = await online();
    const ch = ua1(app);
    const index = channels(app).indexOf(ch);
    app.store.edit([
      {
        kind: 'channelUpsert',
        index,
        channel: {
          ...ch,
          opcua: { ...ch.opcua!, securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256' },
        },
      },
    ]);
    await settled(el);
    await click(el, '[data-role="ua-browse"]');
    expect(textOf(el.querySelector('[data-role="ua-browse-error"]'))).toContain(
      'OPCUA_CERT_UNTRUSTED',
    );
  });
});
