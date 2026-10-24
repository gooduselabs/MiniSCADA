// Mô hình kênh OPC UA (feature 019, contracts/opcua.md §1) và Lấy chứng chỉ / Duyệt node (§4): bảng trường, sửa trường
// (mẫu, chữ thường, khối auth), kênh và server mới, một server mỗi kênh; đọc trả lời API, cây duyệt, Tag từ node.
import type { Channel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  canAddDevice,
  channelFields,
  channelSub,
  deviceFields,
  deviceSub,
  issueField,
  newChannel,
  newDevice,
  opcuaNeedsPin,
  opcuaSecurityConflict,
  probeSupported,
  setField,
  visibleChannelFields,
  type FieldSpec,
} from './connections.ts';
import {
  OBJECTS_NODE,
  OpcUaBrowser,
  browseBody,
  browseResultOf,
  certExpired,
  groupHex,
  suggestTagId,
  tagFromReference,
} from './opcua-browse.ts';

const taken = { channels: new Set<string>(), devices: new Set<string>() };
const spec = (key: string): FieldSpec => channelFields('opcua').find((s) => s.key === key)!;
const ch = (opcua: Channel['opcua'] = { endpointUrl: 'opc.tcp://10.0.0.5:4840' }): Channel => ({
  id: 'ua-1',
  name: 'UA',
  kind: 'opcua',
  opcua,
  devices: [{ id: 'srv1', name: 'Server' }],
});
const set = (c: Channel, key: string, text: string) => setField(c, spec(key), text, taken);

describe('kênh OPC UA: trường', () => {
  it('bảng trường kênh và server theo hợp đồng §1 (mặc định)', () => {
    const keys = channelFields('opcua').map((s) => s.key);
    expect(keys).toEqual([
      'id',
      'name',
      'enabled',
      'endpointUrl',
      'securityMode',
      'securityPolicy',
      'authMode',
      'username',
      'secretId',
      'serverCertSha256',
      'readMode',
      'sessionTimeoutMs',
      'connectTimeoutMs',
      'reconnectMaxS',
    ]);
    const def = Object.fromEntries(channelFields('opcua').map((s) => [s.key, s.default]));
    expect(def).toMatchObject({
      securityMode: 'None',
      securityPolicy: 'None',
      authMode: 'anonymous',
      readMode: 'subscription',
      sessionTimeoutMs: 60000,
      connectTimeoutMs: 5000,
      reconnectMaxS: 10,
    });
    expect(deviceFields('opcua').map((s) => s.key)).toEqual([
      'id',
      'name',
      'enabled',
      'timeoutMs',
      'writeDeadlineMs',
    ]);
    expect(deviceFields('opcua').find((s) => s.key === 'timeoutMs')!.default).toBe(2000);
  });

  it('endpoint, SHA-256, secretId: mẫu; SHA ghi chữ thường; mặc định không ghi khóa', () => {
    expect(set(ch(), 'endpointUrl', 'http://x:4840')).toEqual({ error: 'cn.err.endpoint' });
    expect(set(ch(), 'endpointUrl', 'opc.tcp://plc.local:4840/ua')).toEqual({
      value: ch({ endpointUrl: 'opc.tcp://plc.local:4840/ua' }),
    });
    expect(set(ch(), 'serverCertSha256', 'AB')).toEqual({ error: 'cn.err.sha256' });
    const sha = 'AB'.repeat(32);
    const r = set(ch(), 'serverCertSha256', sha) as { value: Channel };
    expect(r.value.opcua?.serverCertSha256).toBe('ab'.repeat(32));
    expect(set(ch(), 'secretId', 'Bad Id')).toEqual({ error: 'cn.err.secretId' });
    const m = set(ch(), 'securityMode', 'None') as { value: Channel };
    expect(m.value.opcua).toEqual({ endpointUrl: 'opc.tcp://10.0.0.5:4840' });
  });

  it('khối auth: username thì có mode; anonymous bỏ cả khối kể cả username/secretId', () => {
    let c = (set(ch(), 'username', 'op') as { value: Channel }).value;
    expect(c.opcua?.auth).toEqual({ username: 'op', mode: 'username' });
    c = (set(c, 'secretId', 'opcua-ua-1') as { value: Channel }).value;
    expect(c.opcua?.auth).toEqual({ username: 'op', secretId: 'opcua-ua-1', mode: 'username' });
    expect(visibleChannelFields(c).some((s) => s.key === 'username')).toBe(true);
    c = (set(c, 'authMode', 'anonymous') as { value: Channel }).value;
    expect(c.opcua?.auth).toBeUndefined();
    expect(visibleChannelFields(c).some((s) => s.key === 'username')).toBe(false);
    c = (set(c, 'authMode', 'username') as { value: Channel }).value;
    expect(c.opcua?.auth).toEqual({ mode: 'username' });
  });

  it('chế độ/policy không khớp, chưa tin chứng chỉ', () => {
    expect(opcuaSecurityConflict(ch())).toBe(false);
    expect(opcuaSecurityConflict(ch({ endpointUrl: 'x', securityPolicy: 'Basic256Sha256' }))).toBe(
      true,
    );
    expect(opcuaSecurityConflict(ch({ endpointUrl: 'x', securityMode: 'Sign' }))).toBe(true);
    const enc = ch({
      endpointUrl: 'x',
      securityMode: 'SignAndEncrypt',
      securityPolicy: 'Basic256Sha256',
    });
    expect(opcuaSecurityConflict(enc)).toBe(false);
    expect(opcuaNeedsPin(enc)).toBe(true);
    expect(
      opcuaNeedsPin({ ...enc, opcua: { ...enc.opcua!, serverCertSha256: 'a'.repeat(64) } }),
    ).toBe(false);
    expect(opcuaNeedsPin(ch())).toBe(false);
  });

  it('kênh và server mới, một server mỗi kênh, chữ phụ, Thử kết nối không dùng', () => {
    const c = newChannel(['ua-1'], 'opcua', ['srv1']);
    expect(c).toMatchObject({
      id: 'ua-2',
      kind: 'opcua',
      opcua: { endpointUrl: 'opc.tcp://192.168.1.20:4840' },
      devices: [{ id: 'srv2', timeoutMs: 1000 }],
    });
    expect(canAddDevice(c)).toBe(false);
    expect(canAddDevice({ ...c, devices: [] })).toBe(true);
    expect(newDevice(c, ['srv1', 'srv2'])).toMatchObject({ id: 'srv3' });
    expect(channelSub(c)).toBe('OPC UA');
    expect(deviceSub(c, c.devices[0])).toBe('192.168.1.20:4840');
    expect(probeSupported('opcua')).toBe(false);
    expect(probeSupported('modbus-tcp')).toBe(true);
  });

  it('lỗi bộ kiểm tra theo trường: /channels/2/opcua/securityPolicy, /auth (cả khối)', () => {
    expect(issueField('/channels/2/opcua/securityPolicy', 'opcua')).toEqual({
      channel: 2,
      device: null,
      field: 'securityPolicy',
    });
    expect(issueField('/channels/2/opcua/auth', 'opcua')?.field).toBeNull();
    expect(issueField('/channels/2/devices/0/timeoutMs', 'opcua')?.field).toBe('timeoutMs');
  });
});

describe('Lấy chứng chỉ, Duyệt node: model', () => {
  const server = {
    applicationUri: 'urn:x',
    certSha256: 'AB'.repeat(32),
    certSubject: 'CN=x',
    certNotAfter: '2020-01-01T00:00:00Z',
  };

  it('thân yêu cầu: khối opcua của kênh đang sửa; browse có nodeId (mặc định Objects)', () => {
    expect(browseBody(ch(), 'endpoints')).toEqual({
      channel: { id: 'ua-1', kind: 'opcua', opcua: { endpointUrl: 'opc.tcp://10.0.0.5:4840' } },
      action: 'endpoints',
    });
    expect(browseBody(ch(), 'browse')).toMatchObject({ action: 'browse', nodeId: OBJECTS_NODE });
  });

  it('đọc trả lời: 200 ok, SHA chữ thường, tham chiếu bỏ mục thiếu NodeId, tagType lạ bỏ; 429, 400, lỗi thiết bị', () => {
    const r = browseResultOf({
      status: 200,
      body: {
        ok: true,
        code: 'OK',
        server,
        endpoints: [{ securityMode: 'None', securityPolicy: 'None', userTokens: ['anonymous'] }],
        references: [
          { nodeId: 'ns=2;s=A', displayName: 'A', nodeClass: 'Variable', tagType: 'FLOAT64' },
          { nodeId: 'ns=2;s=B', browseName: '2:B', nodeClass: 'Variable', tagType: 'DATETIME' },
          { displayName: 'no id' },
        ],
        truncated: true,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.server?.certSha256).toBe('ab'.repeat(32));
    expect(r.references.map((x) => [x.nodeId, x.displayName, x.tagType])).toEqual([
      ['ns=2;s=A', 'A', 'FLOAT64'],
      ['ns=2;s=B', '2:B', undefined],
    ]);
    expect(r.truncated).toBe(true);
    expect(browseResultOf({ status: 429, body: { retryAfterS: 7 } })).toMatchObject({
      failure: 'rate',
      retryAfterS: 7,
    });
    expect(
      browseResultOf({
        status: 400,
        body: { code: 'E_ADDR_SYNTAX', issues: [{ code: 'E_ADDR_SYNTAX' }] },
      }),
    ).toMatchObject({ failure: 'badRequest', code: 'E_ADDR_SYNTAX', issues: ['E_ADDR_SYNTAX'] });
    expect(browseResultOf({ error: 'unreachable' })).toMatchObject({ failure: 'device' });
    expect(certExpired(server, Date.parse('2026-10-24'))).toBe(true);
    expect(certExpired({ ...server, certNotAfter: null }, 0)).toBe(false);
    expect(groupHex('abcdef0123')).toBe('abcd ef01 23');
  });

  it('Tag từ node: tên không dấu, tránh trùng; STRING có stringLength; kiểu mặc định FLOAT64', () => {
    expect(suggestTagId({ displayName: 'Mức bồn 1' } as never, new Set())).toBe('Muc_bon_1');
    expect(suggestTagId({ displayName: 'Level' } as never, new Set(['Level']))).toBe('Level_2');
    expect(
      tagFromReference(
        {
          nodeId: 'ns=2;s=N',
          displayName: 'Name',
          browseName: '',
          nodeClass: 'Variable',
          tagType: 'STRING',
          hasChildren: false,
        },
        'srv1',
        new Set(),
      ),
    ).toEqual({
      id: 'Name',
      kind: 'external',
      type: 'STRING',
      source: { device: 'srv1', address: 'ns=2;s=N', stringLength: 64 },
    });
    expect(
      tagFromReference(
        {
          nodeId: 'i=1',
          displayName: '1x',
          browseName: '',
          nodeClass: 'Variable',
          hasChildren: false,
        },
        'srv1',
        new Set(),
      ).type,
    ).toBe('FLOAT64');
  });

  it('OpcUaBrowser: khóa khi Offline; mở gốc, mở/gập node con (đọc một lần), lỗi gập lại', async () => {
    const calls: Array<Record<string, unknown>> = [];
    let lock: string | null = 'cn.probe.offline';
    const b = new OpcUaBrowser({
      gate: () => lock as never,
      post: async (_path, body) => {
        calls.push(body as Record<string, unknown>);
        const node = (body as { nodeId?: string }).nodeId;
        if (node === 'ns=2;s=Bad')
          return { status: 200, body: { ok: false, code: 'OPCUA_BROWSE_FAILED' } };
        const refs =
          node === OBJECTS_NODE
            ? [
                { nodeId: 'ns=2;s=T', displayName: 'T', nodeClass: 'Object', hasChildren: true },
                {
                  nodeId: 'ns=2;s=Bad',
                  displayName: 'Bad',
                  nodeClass: 'Object',
                  hasChildren: true,
                },
              ]
            : [{ nodeId: 'ns=2;s=T.L', displayName: 'L', nodeClass: 'Variable' }];
        return { status: 200, body: { ok: true, code: 'OK', references: refs } };
      },
    });
    await b.toggle(ch(), OBJECTS_NODE);
    expect(b.state.locked).toBe('cn.probe.offline');
    expect(calls).toHaveLength(0);
    lock = null;
    await b.toggle(ch(), OBJECTS_NODE);
    expect(b.rows().map((r) => r.ref.nodeId)).toEqual(['ns=2;s=T', 'ns=2;s=Bad']);
    await b.toggle(ch(), 'ns=2;s=T');
    expect(b.rows().map((r) => [r.ref.nodeId, r.depth])).toEqual([
      ['ns=2;s=T', 0],
      ['ns=2;s=T.L', 1],
      ['ns=2;s=Bad', 0],
    ]);
    await b.toggle(ch(), 'ns=2;s=T'); // gập
    await b.toggle(ch(), 'ns=2;s=T'); // mở lại: không hỏi lại
    expect(calls).toHaveLength(2);
    await b.toggle(ch(), 'ns=2;s=Bad');
    expect(b.state.error?.code).toBe('OPCUA_BROWSE_FAILED');
    expect(b.state.expanded.has('ns=2;s=Bad')).toBe(false);
    b.reset();
    expect(b.rows()).toEqual([]);
  });
});
