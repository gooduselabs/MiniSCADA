// Bộ vector kiểm tra dùng chung TS ↔ C++ (feature 004, T060, SC-006, US2-8): mở từng thư mục của
// tests/project-vectors trong Studio (qua StudioStore, như khi người dùng mở thư mục project) và so kết
// luận hợp lệ/không hợp lệ cùng TẬP mã lỗi với expected.json (cũng là kết quả của công cụ dòng lệnh).
//
// Lớp platform viết trong file này đọc thư mục thật bằng node:fs, qua NodeDirSource của
// @mat/project-schema (cùng cách đọc với test vector của bộ kiểm tra): đúng chữ hoa/thường như ext4,
// byte UTF-8 hỏng là lỗi, giữ BOM. Studio chạy kiểm SVG (có DOMParser), nên cảnh báo riêng của Studio
// W_UID_NOT_IN_SVG không đem so.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeDirSource } from '@mat/project-schema/node';
import { describe, expect, it } from 'vitest';
import { StudioStore } from '../app/store.ts';
import type { Platform, ReadOutcome } from '../platform/types.ts';
import { severityOf } from './issue-map.ts';

const DIR = resolve(__dirname, '../../../../tests/project-vectors');
// Ca 0.1: Studio mở project 0.2 ở task sau của feature 006 (ca `v02-*` và `out/` chưa thuộc test này).
const cases = readdirSync(DIR).filter(
  (d) => statSync(join(DIR, d)).isDirectory() && !d.startsWith('v02-') && d !== 'out',
);

interface Expected {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/** Platform chỉ đọc một thư mục trên đĩa; không ghi (test không lưu). */
function dirPlatform(root: string): Platform {
  const source = new NodeDirSource(root);
  return {
    kind: 'mock',
    appInfo: async () => ({ name: 'vectors', version: 'test', tauri: 'none' }),
    pickProject: async () => ({ display: root }),
    recentProjects: async () => [],
    openRecent: async () => ({ error: 'missing' }),
    forgetRecent: async () => undefined,
    read: async (rel): Promise<ReadOutcome> => {
      const r = await source.read(rel);
      if (!('text' in r)) return { error: r.error };
      return { text: r.text, hash: createHash('sha256').update(r.text, 'utf8').digest('hex') };
    },
    write: async () => ({ error: 'bad-path' }),
    openDeviceWeb: async () => undefined,
    onCloseRequested: () => undefined,
    setTitle: async () => undefined,
  };
}

const STUDIO_ONLY_WARNINGS = new Set(['W_UID_NOT_IN_SVG']);
const sortedSet = (codes: Iterable<string>) => [...new Set(codes)].sort();

describe('tests/project-vectors mở trong Studio (SC-006)', () => {
  it('có đủ vector hợp lệ và không hợp lệ', () => {
    expect(cases.length).toBeGreaterThan(40);
    expect(cases.some((c) => c.startsWith('valid-'))).toBe(true);
    expect(cases.some((c) => c.startsWith('invalid-'))).toBe(true);
  });

  for (const c of cases) {
    it(c, async () => {
      const exp = JSON.parse(readFileSync(join(DIR, c, 'expected.json'), 'utf8')) as Expected;
      const store = new StudioStore({ platform: dirPlatform(join(DIR, c)) });
      expect(await store.openProject()).toBe(true);
      await store.idle();
      const issues = store.state.issues;
      const errors = issues.filter((i) => severityOf(i) === 'error');
      expect(sortedSet(errors.map((i) => i.code)), JSON.stringify(errors, null, 1)).toEqual(
        sortedSet(exp.errors),
      );
      // Hợp lệ khi không còn lỗi; chỉ khi đó bộ kiểm tra trả project đã nạp (cây, xem trước dùng).
      expect(errors.length === 0).toBe(exp.valid);
      expect(store.state.loaded !== null).toBe(exp.valid);
      if (exp.warnings) {
        const warnings = issues
          .filter((i) => severityOf(i) === 'warning' && !STUDIO_ONLY_WARNINGS.has(i.code))
          .map((i) => i.code);
        expect(sortedSet(warnings)).toEqual(sortedSet(exp.warnings));
      }
      // Mở project không làm tài liệu nào thành chưa lưu (không ghi lại file không đổi, FR-022).
      expect(store.dirtyFiles()).toEqual([]);
    });
  }
});
