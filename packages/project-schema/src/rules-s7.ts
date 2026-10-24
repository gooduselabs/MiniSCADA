// Luật của kênh và Tag Siemens S7 (feature 016, specs/016-driver-s7/contracts/s7-driver.md §1, §2). Gọi từ
// rules-02.ts (kênh trong vòng kết nối, Tag trong externalChecks). Bản C++ cài giống hệt:
// core/project-manager/rules_02.cpp; vector chung tests/project-vectors/v11-s7-* (README-016.md).
import { parseS7Address, s7WriteSize } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode } from './codes.ts';
import type { Channel, TagV1 } from './types-02.ts';

/** Một lỗi: mã, đường dẫn JSON trong tệp, thông điệp. */
export type S7Issue = [ErrorCode, string, string];

/** PDU xin mặc định của kênh S7. */
export const S7_DEFAULT_PDU = 480;
/** Phần đầu của trả lời Read Var một item và của Write Var một item (contracts §3). */
export const S7_READ_OVERHEAD = 18;
export const S7_WRITE_OVERHEAD = 28;

/** Luật của kênh `ch` (chỉ số `ci`) loại `s7`, trong tệp connections. */
export function s7ChannelIssues(ch: Channel, ci: number, schemaVersion: string): S7Issue[] {
  const out: S7Issue[] = [];
  const cp = `/channels/${ci}`;
  if (!SUPPORTED_SCHEMA_11.test(schemaVersion))
    out.push(['E_DRIVER_VERSION', `${cp}/kind`, `channel kind 's7' needs project format 1.1`]);
  const s = ch.s7;
  if (s?.remoteTsap !== undefined && (s.rack !== undefined || s.slot !== undefined))
    out.push([
      'E_S7_TSAP',
      `${cp}/s7/remoteTsap`,
      'remoteTsap replaces rack and slot: give one or the other',
    ]);
  return out;
}

/** Luật của Tag ngoài `t` (đường dẫn `p`) trên thiết bị của kênh S7 `ch`, trong tệp Tag. */
export function s7TagIssues(t: TagV1, p: string, ch: Channel): S7Issue[] {
  const out: S7Issue[] = [];
  const src = t.source!;
  if (src.byteOrder !== undefined)
    out.push([
      'E_SCHEMA',
      `${p}/source/byteOrder`,
      'byteOrder does not apply to S7 tags (always big-endian)',
    ]);
  if (src.stringByteOrder !== undefined)
    out.push([
      'E_SCHEMA',
      `${p}/source/stringByteOrder`,
      'stringByteOrder does not apply to S7 tags',
    ]);
  const r = parseS7Address(src.address, {
    rawType: src.rawType ?? t.type,
    stringLength: src.stringLength,
    access: t.access ?? 'R',
  });
  if (!r.ok) {
    out.push([r.error, `${p}/source/address`, `S7 address '${src.address}': ${r.error}`]);
    return out;
  }
  const pdu = ch.s7?.pduSize ?? S7_DEFAULT_PDU;
  if (r.size > pdu - S7_READ_OVERHEAD)
    out.push([
      'E_ADDR_READ_LIMIT',
      `${p}/source`,
      `the tag takes ${r.size} bytes, more than one read of PDU ${pdu} allows (${pdu - S7_READ_OVERHEAD})`,
    ]);
  const w = s7WriteSize(r.s7Type, r.size);
  if (t.access === 'RW' && w > pdu - S7_WRITE_OVERHEAD)
    out.push([
      'E_ADDR_WRITE_LIMIT',
      `${p}/source`,
      `a write of the tag takes ${w} bytes, more than PDU ${pdu} allows (${pdu - S7_WRITE_OVERHEAD})`,
    ]);
  return out;
}
