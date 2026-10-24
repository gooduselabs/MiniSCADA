// Luật của kênh Mitsubishi MC (feature 017; specs/017-driver-mc/plan.md "Luật"), gọi từ rules-02.ts. Bản C++ cài
// giống hệt: core/project-manager/rules_mc.cpp; vector chung tests/project-vectors/v11-mc-* (README-017.md).
import { parseMcAddress } from '@mat/tag-codec';
import { SUPPORTED_SCHEMA_11, type ErrorCode, type WarningCode } from './codes.ts';
import type { Channel, FieldDevice, ScanGroupName, TagV1 } from './types-02.ts';

type Add = (code: ErrorCode, file: string, path: string, message: string) => void;
type Warn = (code: WarningCode, file: string, path: string, message: string) => void;

/** Kênh `mc` chỉ có từ định dạng 1.1 (dòng 1.x dùng chung schema gốc, nên 1.0 phải chặn bằng luật). */
export function mcChannelChecks(
  ch: Channel,
  cp: string,
  schemaVersion: string,
  connFile: string,
  add: Add,
): void {
  if (ch.kind === 'mc' && !SUPPORTED_SCHEMA_11.test(schemaVersion))
    add('E_CHANNEL_VERSION', connFile, `${cp}/kind`, `channel kind 'mc' needs project format 1.1`);
}

export interface McTagCtx {
  tagFile: string;
  connFile: string;
  found: { device: FieldDevice; channel: Channel; ci: number; di: number };
  scanGroups: Readonly<Record<ScanGroupName, number>>;
  /** Thiết bị đã báo W_BIT_RMW, W_DETECT_SLOW (dùng chung với Modbus: một lần mỗi thiết bị). */
  bitRmwSeen: Set<string>;
  slowSeen: Set<string>;
  add: Add;
  warn: Warn;
}

/** Tag ngoài của thiết bị thuộc kênh `mc`, sau luật `stringLength` chung. */
export function mcTagChecks(t: TagV1, p: string, ctx: McTagCtx): void {
  const src = t.source!;
  const dev = ctx.found.device;
  const { tagFile, connFile, add, warn } = ctx;
  const devPath = `/channels/${ctx.found.ci}/devices/${ctx.found.di}`;
  const r = parseMcAddress(src.address, {
    rawType: src.rawType ?? t.type,
    stringLength: src.stringLength,
    access: t.access ?? 'R',
    xyNotation: dev.xyNotation ?? 'hex',
  });
  if (!r.ok) {
    add(r.error, tagFile, `${p}/source/address`, `address '${src.address}': ${r.error}`);
    return;
  }
  if (r.words > (dev.maxBatchWords ?? 960))
    add(
      'E_ADDR_READ_LIMIT',
      tagFile,
      `${p}/source`,
      `the tag needs ${r.words} words, more than one read allows`,
    );
  if (r.bit !== null && t.access === 'RW') {
    const mode = dev.write?.registerBit ?? 'none';
    if (mode === 'none')
      add(
        'E_BIT_WRITE',
        tagFile,
        `${p}/source/address`,
        `device '${dev.id}' does not allow bit writes (write.registerBit is none)`,
      );
    else if (!ctx.bitRmwSeen.has(dev.id)) {
      ctx.bitRmwSeen.add(dev.id);
      warn('W_BIT_RMW', connFile, devPath, `device '${dev.id}' writes bits by read-modify-write`);
    }
  }
  const group = src.scanGroup ?? 'normal';
  const period = ctx.scanGroups[group];
  const retries = dev.retries ?? 0;
  const timeout = dev.timeoutMs ?? 1000;
  if (!ctx.slowSeen.has(dev.id) && timeout * (retries + 1) > period) {
    ctx.slowSeen.add(dev.id);
    warn(
      'W_DETECT_SLOW',
      connFile,
      devPath,
      `timeoutMs x (retries + 1) = ${timeout * (retries + 1)} ms exceeds the ${group} scan period (${period} ms)`,
    );
  }
}
