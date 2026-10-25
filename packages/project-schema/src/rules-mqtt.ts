// Luật của kênh, nhóm publish và Tag MQTT (feature 022, specs/022-driver-mqtt/spec.md FR-006). Gọi từ rules-02.ts
// (kênh trong vòng kết nối, nhóm sau vòng Tag, Tag trong externalChecks). Bản C++ cài giống hệt:
// core/project-manager/rules_mqtt.cpp; vector chung tests/project-vectors/v11-mqtt-* (README-022.md).
import { parseMqttAddress } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode, type WarningCode } from './codes.ts';
import type { Channel, ConnectionsConfig, TagV1 } from './types-02.ts';

/** Một lỗi hoặc cảnh báo: mã, đường dẫn JSON trong tệp, thông điệp. */
export type MqttIssue = [ErrorCode, string, string];
export type MqttWarning = [WarningCode, string, string];

/** Thời hạn mặc định của thiết bị (broker) MQTT: CONNACK, SUBACK, PUBACK. */
export const MQTT_DEFAULT_TIMEOUT_MS = 2000;

/** Luật của kênh `ch` (chỉ số `ci`) loại `mqtt`, trong tệp connections. */
export function mqttChannelIssues(
  ch: Channel,
  ci: number,
  schemaVersion: string,
): { errors: MqttIssue[]; warnings: MqttWarning[] } {
  const errors: MqttIssue[] = [];
  const warnings: MqttWarning[] = [];
  const cp = `/channels/${ci}`;
  if (!SUPPORTED_SCHEMA_11.test(schemaVersion))
    errors.push(['E_DRIVER_VERSION', `${cp}/kind`, `channel kind 'mqtt' needs project format 1.1`]);
  const q = ch.mqtt;
  if (!q) return { errors, warnings };
  const tls = q.tls?.enabled === true;
  if (
    q.tls &&
    !tls &&
    (q.tls.serverCertSha256 !== undefined ||
      q.tls.caCertPem !== undefined ||
      q.tls.serverName !== undefined)
  )
    errors.push([
      'E_MQTT_TLS',
      `${cp}/mqtt/tls`,
      'serverCertSha256, caCertPem and serverName need tls.enabled true',
    ]);
  if (tls && q.tls!.serverCertSha256 === undefined && q.tls!.caCertPem === undefined)
    warnings.push([
      'W_MQTT_TLS_NOT_PINNED',
      `${cp}/mqtt/tls`,
      'the broker certificate is not trusted yet (serverCertSha256 or caCertPem): the runtime will not connect',
    ]);
  if (q.auth && !tls)
    warnings.push([
      'W_MQTT_PLAIN_PASSWORD',
      `${cp}/mqtt/auth`,
      'user and password on a connection without TLS',
    ]);
  return { errors, warnings };
}

/** Tag của mọi nhóm publish phải tồn tại (E_MQTT_GROUP_TAG). */
export function mqttGroupIssues(conn: ConnectionsConfig, tagIds: Set<string>): MqttIssue[] {
  const out: MqttIssue[] = [];
  conn.channels.forEach((ch, ci) => {
    if (ch.kind !== 'mqtt' || !ch.mqtt?.publishGroups) return;
    ch.mqtt.publishGroups.forEach((g, gi) =>
      g.tags.forEach((id, k) => {
        if (!tagIds.has(id))
          out.push([
            'E_MQTT_GROUP_TAG',
            `/channels/${ci}/mqtt/publishGroups/${gi}/tags/${k}`,
            `Tag '${id}' of the publish group does not exist`,
          ]);
      }),
    );
  });
  return out;
}

/** Luật của Tag ngoài `t` (đường dẫn `p`) trên thiết bị của kênh MQTT. */
export function mqttTagIssues(t: TagV1, p: string): MqttIssue[] {
  const out: MqttIssue[] = [];
  const src = t.source!;
  if (src.byteOrder !== undefined)
    out.push(['E_SCHEMA', `${p}/source/byteOrder`, 'byteOrder does not apply to MQTT tags']);
  if (src.stringByteOrder !== undefined)
    out.push([
      'E_SCHEMA',
      `${p}/source/stringByteOrder`,
      'stringByteOrder does not apply to MQTT tags',
    ]);
  const a = parseMqttAddress(src.address);
  if (!a.ok) {
    out.push([a.error, `${p}/source/address`, `MQTT address '${src.address}': ${a.error}`]);
    return out;
  }
  const rw = (t.access ?? 'R') === 'RW';
  if (rw && a.dir === 'sub')
    out.push([
      'E_MQTT_DIRECTION',
      `${p}/source/address`,
      'a writable MQTT tag needs pub: or both: in its address',
    ]);
  if (!rw && a.dir === 'pub')
    out.push([
      'E_MQTT_DIRECTION',
      `${p}/source/address`,
      'a pub: MQTT tag only takes values by writes: it needs access RW',
    ]);
  return out;
}
