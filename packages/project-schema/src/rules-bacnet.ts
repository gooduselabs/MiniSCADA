// Luật BACnet/IP của định dạng 1.1 (feature 020, spec FR-005..FR-007, FR-011): địa chỉ Tag trên thiết bị BACnet
// (loại, thuộc tính, priority, quyền ghi); kênh `bacnet` chỉ có từ 1.1 (E_CHANNEL_VERSION). Bản C++ cài giống hệt:
// core/project-manager/rules_bacnet.cpp; vector chung tests/project-vectors/v11-bacnet-* (README-020.md).
import { parseBacnetAddress } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode, type Issue } from './codes.ts';
import type { ConnectionsConfig, TagV1 } from './types-02.ts';

/** Mặc định của thiết bị BACnet (driver, mô hình và W_DETECT_SLOW dùng chung). */
export const BACNET_TIMEOUT_MS = 500;
export const BACNET_RETRIES = 1;

type Add = (code: ErrorCode, file: string, path: string, message: string) => void;

/**
 * Tag ngoài trên thiết bị của kênh `bacnet` (gọi từ rules-02 thay cho luật địa chỉ Modbus). `p`: `/tags/<i>`.
 * true khi địa chỉ hợp lệ (W_DETECT_SLOW sau đó vẫn chạy).
 */
export function bacnetSourceRules(t: TagV1, p: string, tagFile: string, add: Add): boolean {
  const src = t.source!;
  const r = parseBacnetAddress(src.address, {
    rawType: src.rawType ?? t.type,
    access: t.access ?? 'R',
  });
  if (!r.ok) {
    add(r.error, tagFile, `${p}/source/address`, `address '${src.address}': ${r.error}`);
    return false;
  }
  return true;
}

/** Kênh `bacnet` cần định dạng 1.1 (họ 1.x dùng chung schema ở thư mục gốc). */
export function bacnetVersionRules(input: {
  project: { schemaVersion: string; connectionFile?: string };
  connections?: ConnectionsConfig;
}): { errors: Issue[] } {
  const errors: Issue[] = [];
  if (SUPPORTED_SCHEMA_11.test(input.project.schemaVersion)) return { errors };
  const connFile = input.project.connectionFile ?? 'connections.json';
  input.connections?.channels.forEach((ch, i) => {
    if (ch.kind === 'bacnet')
      errors.push({
        code: 'E_CHANNEL_VERSION',
        file: connFile,
        path: `/channels/${i}/kind`,
        message: 'a BACnet/IP channel needs project format 1.1',
      });
  });
  return { errors };
}
