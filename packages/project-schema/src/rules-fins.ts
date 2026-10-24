// Luật Omron FINS của định dạng 1.1 (feature 018, spec FR-011): địa chỉ Tag trên thiết bị FINS, `source.bcd`, giới hạn
// đọc/ghi theo word; kênh `fins` và `bcd` chỉ có từ 1.1 (E_CHANNEL_VERSION). Bản C++ cài giống hệt:
// core/project-manager/rules_fins.cpp; vector chung tests/project-vectors/v11-fins-* (README-018.md).
import { parseFinsAddress } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode, type Issue } from './codes.ts';
import type { ConnectionsConfig, FieldDevice, TagListV1, TagV1 } from './types-02.ts';

/** Số word lớn nhất một lệnh ghi 0102 mang (khung 2012 byte, chừa đầu lệnh). */
export const FINS_MAX_WRITE_WORDS = 990;
/** Số word lớn nhất một lệnh đọc 0101 trả về. */
export const FINS_MAX_READ_WORDS = 999;
const BCD_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32']);

type Add = (code: ErrorCode, file: string, path: string, message: string) => void;

/**
 * Tag ngoài trên thiết bị của kênh `fins` (gọi từ rules-02 thay cho luật địa chỉ Modbus). `p`: `/tags/<i>`.
 * true khi địa chỉ hợp lệ (luật chung sau đó, W_DETECT_SLOW, vẫn chạy).
 */
export function finsSourceRules(
  t: TagV1,
  p: string,
  dev: FieldDevice,
  tagFile: string,
  add: Add,
): boolean {
  const src = t.source!;
  const rawType = src.rawType ?? t.type;
  if (src.bcd === true && !BCD_TYPES.has(rawType))
    add('E_SCHEMA', tagFile, `${p}/source/bcd`, 'bcd applies to INT16, UINT16, INT32, UINT32');
  const r = parseFinsAddress(src.address, {
    rawType,
    stringLength: src.stringLength,
    access: t.access ?? 'R',
  });
  if (!r.ok) {
    add(r.error, tagFile, `${p}/source/address`, `address '${src.address}': ${r.error}`);
    return false;
  }
  const maxRead = Math.min(FINS_MAX_READ_WORDS, dev.maxReadWords ?? FINS_MAX_READ_WORDS);
  if (r.words > maxRead)
    add(
      'E_ADDR_READ_LIMIT',
      tagFile,
      `${p}/source`,
      `the tag needs ${r.words} words, more than one read allows (${maxRead})`,
    );
  if (t.access === 'RW' && r.words > FINS_MAX_WRITE_WORDS)
    add(
      'E_ADDR_WRITE_LIMIT',
      tagFile,
      `${p}/source`,
      `the tag needs ${r.words} words, more than one write allows (${FINS_MAX_WRITE_WORDS})`,
    );
  return true;
}

/** `source.bcd` trên thiết bị không phải FINS. */
export function bcdOutsideFins(t: TagV1, p: string, tagFile: string, add: Add): void {
  if (t.source?.bcd !== undefined)
    add('E_SCHEMA', tagFile, `${p}/source/bcd`, 'bcd only applies to Omron FINS devices');
}

/** Kênh `fins` và `source.bcd` cần định dạng 1.1 (họ 1.x dùng chung schema ở thư mục gốc). */
export function finsVersionRules(input: {
  project: { schemaVersion: string; tagFile?: string; connectionFile?: string };
  connections?: ConnectionsConfig;
  tags?: TagListV1;
}): { errors: Issue[] } {
  const errors: Issue[] = [];
  if (SUPPORTED_SCHEMA_11.test(input.project.schemaVersion)) return { errors };
  const connFile = input.project.connectionFile ?? 'connections.json';
  input.connections?.channels.forEach((ch, i) => {
    if (ch.kind === 'fins')
      errors.push({
        code: 'E_CHANNEL_VERSION',
        file: connFile,
        path: `/channels/${i}/kind`,
        message: 'an Omron FINS channel needs project format 1.1',
      });
  });
  input.tags?.tags.forEach((t, i) => {
    if (t.source?.bcd !== undefined)
      errors.push({
        code: 'E_CHANNEL_VERSION',
        file: input.project.tagFile ?? 'tags.json',
        path: `/tags/${i}/source/bcd`,
        message: 'source.bcd needs project format 1.1',
      });
  });
  return { errors };
}
