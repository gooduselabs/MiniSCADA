// Mô hình kênh MQTT (feature 022, specs/022-driver-mqtt/spec.md) trong Studio: bảng trường, sửa trường (host, client id,
// SHA-256 chữ thường, khối tls luôn có `enabled`), kênh và broker mới, một broker mỗi kênh, không Thử kết nối, chữ phụ trên
// cây, cảnh báo tại ô; Bảng Tag với topic MQTT; chẩn đoán; câu lỗi của bộ kiểm tra.
import type { Channel, TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { issueText } from '../app/code-text.ts';
import { t } from '../i18n/index.ts';
import {
  canAddDevice,
  channelFields,
  channelSub,
  deviceFields,
  deviceSub,
  mqttNeedsPin,
  mqttPlainPassword,
  newChannel,
  newDevice,
  oneDeviceReason,
  probeSupported,
  setField,
  type FieldSpec,
} from './connections.ts';
import { mqttDetailRows } from './driver-diag.ts';
import { applyEdits, type EditableProject, type ProjectEdit } from './project-doc.ts';
import { addressInfoText, tagTable, type TagTable } from './tag-table.ts';

const taken = { channels: new Set<string>(), devices: new Set<string>() };
const spec = (key: string): FieldSpec => channelFields('mqtt').find((s) => s.key === key)!;
const ch = (mqtt: Channel['mqtt'] = { host: '192.0.2.30' }): Channel => ({
  id: 'mqtt1',
  name: 'Broker',
  kind: 'mqtt',
  mqtt,
  devices: [{ id: 'broker1', name: 'Broker' }],
});
const set = (c: Channel, key: string, text: string) => setField(c, spec(key), text, taken);
const value = (r: ReturnType<typeof set>): Channel => {
  if (!('value' in r)) throw new Error(JSON.stringify(r));
  return r.value;
};

describe('kênh MQTT: trường', () => {
  it('bảng trường kênh và broker', () => {
    expect(channelFields('mqtt').map((s) => s.key)).toEqual([
      'id',
      'name',
      'enabled',
      'host',
      'port',
      'mqttClientId',
      'mqttTls',
      'mqttCertSha256',
      'mqttServerName',
      'mqttUsername',
      'mqttSecretId',
      'mqttKeepAliveS',
      'mqttCleanSession',
      'mqttWillTopic',
      'mqttWillPayload',
      'mqttWillQos',
      'mqttWillRetain',
      'mqttMaxPublishPerS',
      'connectTimeoutMs',
      'reconnectMaxS',
    ]);
    expect(deviceFields('mqtt').map((s) => s.key)).toEqual([
      'id',
      'name',
      'enabled',
      'mqttStaleAfterMs',
      'timeoutMs',
      'writeDeadlineMs',
    ]);
    for (const s of [...channelFields('mqtt'), ...deviceFields('mqtt')]) {
      expect(t(s.label), s.key).not.toBe(s.label);
      expect(t(s.help), s.key).not.toBe(s.help);
    }
  });

  it('host, client id, topic di chúc theo mẫu của schema; mặc định không ghi khóa', () => {
    expect(set(ch(), 'host', 'broker có dấu')).toEqual({ error: 'cn.err.mqttHost' });
    expect(value(set(ch(), 'host', 'broker.plant.local')).mqtt?.host).toBe('broker.plant.local');
    expect(set(ch(), 'mqttClientId', 'a b')).toEqual({ error: 'cn.err.mqttClientId' });
    expect(set(ch(), 'mqttWillTopic', 'mat/+/status')).toEqual({ error: 'cn.err.mqttTopic' });
    expect(value(set(ch(), 'port', '1883')).mqtt).toEqual({ host: '192.0.2.30' });
    expect(value(set(ch(), 'mqttWillQos', '1')).mqtt?.will).toEqual({ qos: 1 });
  });

  it('khối tls luôn có enabled; SHA-256 ghi chữ thường; tắt hết thì bỏ khối', () => {
    const pin = 'AB'.repeat(32);
    const a = value(set(ch(), 'mqttCertSha256', pin));
    expect(a.mqtt?.tls).toEqual({ enabled: false, serverCertSha256: pin.toLowerCase() });
    const b = value(setField(a, spec('mqttTls'), 'true', taken));
    expect(b.mqtt?.tls?.enabled).toBe(true);
    expect(mqttNeedsPin(b)).toBe(false);
    const c = value(setField(b, spec('mqttCertSha256'), '', taken));
    expect(mqttNeedsPin(c)).toBe(true);
    const d = value(setField(c, spec('mqttTls'), 'false', taken));
    expect(d.mqtt?.tls).toBeUndefined();
  });

  it('cảnh báo mật khẩu không TLS', () => {
    expect(mqttPlainPassword(ch({ host: 'h', auth: { username: 'u', secretId: 's' } }))).toBe(true);
    expect(
      mqttPlainPassword(
        ch({ host: 'h', auth: { username: 'u', secretId: 's' }, tls: { enabled: true } }),
      ),
    ).toBe(false);
  });
});

describe('kênh MQTT: kênh, broker, cây', () => {
  it('kênh mới có sẵn một broker; không thêm broker thứ hai; không Thử kết nối', () => {
    const c = newChannel(['mqtt1'], 'mqtt', ['broker1']);
    expect(c).toMatchObject({ id: 'mqtt2', kind: 'mqtt', mqtt: { host: '192.0.2.30' } });
    expect(c.devices).toEqual([{ id: 'broker2', name: 'Broker 2' }]);
    expect(canAddDevice(c)).toBe(false);
    expect(t(oneDeviceReason(c))).toContain('broker');
    expect(canAddDevice({ ...c, devices: [] })).toBe(true);
    expect(newDevice({ ...c, devices: [] }, ['broker1'])).toEqual({
      id: 'broker2',
      name: 'Broker 2',
    });
    expect(probeSupported('mqtt')).toBe(false);
  });

  it('chữ phụ: MQTT, MQTT TLS; host:cổng (8883 khi TLS)', () => {
    expect(channelSub(ch())).toBe('MQTT');
    const tls = ch({ host: 'b.local', tls: { enabled: true } });
    expect(channelSub(tls)).toBe('MQTT TLS');
    expect(deviceSub(ch(), { id: 'b', name: 'B' })).toBe('192.0.2.30:1883');
    expect(deviceSub(tls, { id: 'b', name: 'B' })).toBe('b.local:8883');
  });
});

const DEVICES = [
  { id: 'plc1', name: 'PLC', addressBase: 0 as const, kind: 'modbus-tcp' },
  { id: 'broker1', name: 'Broker', kind: 'mqtt' },
];
const TAGS: TagV1[] = [
  { id: 'P.LEVEL', kind: 'external', type: 'FLOAT32', source: { device: 'plc1', address: 'HR1' } },
  {
    id: 'MQ.TEMP',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'broker1', address: 'sensors/+/data|$.temp' },
  },
];
const make = (tags: readonly TagV1[] = TAGS): TagTable =>
  tagTable({ tags, devices: DEVICES, valueTables: [], version: '0.2' });
function applyTo(tags: readonly TagV1[], edits: readonly ProjectEdit[]): TagV1[] {
  const base = {
    project: { schemaVersion: '1.1.0' },
    tags: { schemaVersion: '1.1.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

describe('Bảng Tag: topic MQTT', () => {
  it('địa chỉ giữ nguyên chữ hoa/thường; thông tin hướng, topic, trường, QoS', () => {
    const a = make();
    const out = a.apply([{ row: 1, col: 'address', text: ' pub:Plant/Cmd/SP|$.data.sp;qos=1 ' }]);
    expect(out.rejected).toEqual([]);
    const next = applyTo(TAGS, out.edits);
    expect(next[1].source?.address).toBe('pub:Plant/Cmd/SP|$.data.sp;qos=1');
    const info = make(next).addressInfo(1)!;
    expect(info).toMatchObject({
      ok: true,
      mqtt: { dir: 'pub', topic: 'Plant/Cmd/SP', path: '$.data.sp', qos: 1 },
    });
    expect(addressInfoText(info)).toBe(
      'gửi khi ghi · topic Plant/Cmd/SP · trường $.data.sp · QoS 1',
    );
    expect(addressInfoText(a.addressInfo(1)!)).toContain('nhận');
  });

  it('địa chỉ sai: lỗi theo mã; gợi ý cú pháp; không thứ tự byte', () => {
    const a = make();
    const bad = applyTo(TAGS, a.apply([{ row: 1, col: 'address', text: 'pub:a/+/b' }]).edits);
    expect(make(bad).addressInfo(1)).toMatchObject({ ok: false, error: 'tt.err.mqttAddress' });
    const q = applyTo(TAGS, a.apply([{ row: 1, col: 'address', text: 'a;qos=2' }]).edits);
    expect(make(q).addressInfo(1)).toMatchObject({ ok: false, error: 'tt.err.mqttQos' });
    expect(a.addressSyntaxHint(1)).toBe(t('tt.hint.mqttSyntax'));
    expect(a.isMqttRow(1)).toBe(true);
    expect(a.editable(1, 'byteOrder')).toBe(false);
    expect(a.apply([{ row: 1, col: 'byteOrder', text: 'CDAB' }]).rejected).toHaveLength(1);
  });
});

describe('MQTT: chẩn đoán và câu lỗi', () => {
  it('dòng thông tin theo thứ tự, bỏ khóa lạ', () => {
    expect(
      mqttDetailRows({ messagesIn: '5', broker: '192.0.2.30:1883', other: 'x', tls: 'off' }),
    ).toEqual([
      { key: 'broker', value: '192.0.2.30:1883' },
      { key: 'tls', value: 'off' },
      { key: 'messagesIn', value: '5' },
    ]);
  });

  it('câu tiếng Việt cho mã của bộ kiểm tra', () => {
    expect(
      issueText({ code: 'E_ADDR_SYNTAX', message: "MQTT address 'pub:a/+': E_ADDR_SYNTAX" }),
    ).toBe(t('issue.E_ADDR_SYNTAX.mqtt'));
    expect(issueText({ code: 'E_SCHEMA', message: 'byteOrder does not apply to MQTT tags' })).toBe(
      t('issue.E_SCHEMA.mqttByteOrder'),
    );
    for (const c of [
      'E_MQTT_TLS',
      'E_MQTT_DIRECTION',
      'E_MQTT_GROUP_TAG',
      'W_MQTT_TLS_NOT_PINNED',
      'W_MQTT_PLAIN_PASSWORD',
    ])
      expect(issueText({ code: c, message: 'x' })).not.toBe('x');
  });
});
