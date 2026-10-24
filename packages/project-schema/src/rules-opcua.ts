// Luật của kênh và Tag OPC UA (feature 019, specs/019-driver-opcua/contracts/opcua.md §1). Gọi từ rules-02.ts
// (kênh trong vòng kết nối, Tag trong externalChecks). Bản C++ cài giống hệt: core/project-manager/rules_02.cpp;
// vector chung tests/project-vectors/v11-opcua-* (README-019.md).
import { parseOpcUaNodeId } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode, type WarningCode } from './codes.ts';
import type { Channel, TagV1 } from './types-02.ts';

/** Một lỗi hoặc cảnh báo: mã, đường dẫn JSON trong tệp, thông điệp. */
export type OpcUaIssue = [ErrorCode, string, string];
export type OpcUaWarning = [WarningCode, string, string];

/** Thời hạn một yêu cầu mặc định của thiết bị (server) OPC UA. */
export const OPCUA_DEFAULT_TIMEOUT_MS = 2000;

/** Luật của kênh `ch` (chỉ số `ci`) loại `opcua`, trong tệp connections. */
export function opcuaChannelIssues(
  ch: Channel,
  ci: number,
  schemaVersion: string,
): { errors: OpcUaIssue[]; warnings: OpcUaWarning[] } {
  const errors: OpcUaIssue[] = [];
  const warnings: OpcUaWarning[] = [];
  const cp = `/channels/${ci}`;
  if (!SUPPORTED_SCHEMA_11.test(schemaVersion))
    errors.push([
      'E_DRIVER_VERSION',
      `${cp}/kind`,
      `channel kind 'opcua' needs project format 1.1`,
    ]);
  const o = ch.opcua;
  if (!o) return { errors, warnings };
  const mode = o.securityMode ?? 'None';
  const policy = o.securityPolicy ?? 'None';
  if ((mode === 'None') !== (policy === 'None'))
    errors.push([
      'E_OPCUA_SECURITY',
      `${cp}/opcua/securityPolicy`,
      `security mode ${mode} does not go with policy ${policy}`,
    ]);
  const auth = o.auth ?? { mode: 'anonymous' };
  if (auth.mode === 'username' && (auth.username === undefined || auth.secretId === undefined))
    errors.push([
      'E_OPCUA_AUTH',
      `${cp}/opcua/auth`,
      'username authentication needs username and secretId',
    ]);
  if (auth.mode === 'anonymous' && (auth.username !== undefined || auth.secretId !== undefined))
    errors.push([
      'E_OPCUA_AUTH',
      `${cp}/opcua/auth`,
      'anonymous authentication takes no username or secretId',
    ]);
  if (auth.mode === 'username' && mode === 'None')
    warnings.push([
      'W_OPCUA_PLAIN_PASSWORD',
      `${cp}/opcua/auth`,
      'username and password on a channel without encryption (securityMode None)',
    ]);
  if (mode !== 'None' && o.serverCertSha256 === undefined)
    warnings.push([
      'W_OPCUA_CERT_NOT_PINNED',
      `${cp}/opcua`,
      'the server certificate is not trusted yet (serverCertSha256): the runtime will not connect',
    ]);
  return { errors, warnings };
}

/** Luật của Tag ngoài `t` (đường dẫn `p`) trên thiết bị của kênh OPC UA. */
export function opcuaTagIssues(t: TagV1, p: string): OpcUaIssue[] {
  const out: OpcUaIssue[] = [];
  const src = t.source!;
  if (src.byteOrder !== undefined)
    out.push(['E_SCHEMA', `${p}/source/byteOrder`, 'byteOrder does not apply to OPC UA tags']);
  if (src.stringByteOrder !== undefined)
    out.push([
      'E_SCHEMA',
      `${p}/source/stringByteOrder`,
      'stringByteOrder does not apply to OPC UA tags',
    ]);
  const r = parseOpcUaNodeId(src.address);
  if (!r.ok)
    out.push([r.error, `${p}/source/address`, `OPC UA NodeId '${src.address}': ${r.error}`]);
  return out;
}
