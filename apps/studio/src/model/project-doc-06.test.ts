// Tài liệu project 0.6 (feature 010): logging.json và reports.json sửa được; sửa đổi `logging`, `reports` tạo file khi chưa
// có và thêm `loggingFile`/`reportsFile` vào project.json; hoàn tác; lưu khi còn lỗi; outline có cờ format06.
import { type LoggingConfig, type ReportsConfig } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  filesOf,
  isVersion03,
  isVersion06,
  loadDoc,
  outlineOf,
  restoreSnapshot,
  snapshotOf,
  withEditable,
  writeOrder,
  writtenText,
  type ProjectDoc,
  type ProjectDocs,
} from './project-doc.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';
import { resolve } from 'node:path';

const demo = () => readProjectDir(resolve(REPO, 'projects/history-demo'));

function open(files: Record<string, string> = demo()): ProjectDocs {
  const docs: Record<string, ProjectDoc> = {};
  for (const [rel, text] of Object.entries(files))
    docs[rel] = loadDoc(
      rel,
      text,
      `hash:${rel}`,
      false,
      rel === 'tags.json' ? 'tags02' : undefined,
    );
  return withEditable(docs);
}

describe('định dạng 0.6 trong Studio', () => {
  it('isVersion06 và isVersion03 (cùng họ)', () => {
    expect(isVersion06({ schemaVersion: '0.6.0' })).toBe(true);
    expect(isVersion03({ schemaVersion: '0.6.0' })).toBe(true);
    expect(isVersion06({ schemaVersion: '0.3.0' })).toBe(false);
    expect(isVersion06(null)).toBe(false);
  });

  it('outline: format06, họ 0.3, mẫu báo cáo và lưu trữ đọc được', () => {
    const o = outlineOf(filesOf(open()));
    expect(o.format06).toBe(true);
    expect(o.schema).toBe('0.3');
    expect(o.reportsFile).toBe('reports.json');
    expect(o.reports?.reports.map((r) => r.id)).toEqual(['dien-ngay', 'dien-ca', 'dien-thang']);
    expect(o.logging?.groups.map((g) => g.id)).toContain('ap-suat');
  });

  it('logging.json và reports.json là tài liệu sửa được', () => {
    const docs = open();
    expect(docs['logging.json']!.editable).toBe(true);
    expect(docs['reports.json']!.editable).toBe(true);
  });

  it('project 0.3 không sửa được logging.json (cần nâng cấp lên 0.6)', () => {
    const files = demo();
    const p = JSON.parse(files['project.json']!);
    p.schemaVersion = '0.3.0';
    files['project.json'] = JSON.stringify(p);
    expect(open(files)['logging.json']!.editable).toBeFalsy();
  });

  it('edit logging thay cả file, chỉ logging.json bị sửa, schemaVersion giữ', () => {
    const docs = open();
    const cur = docs['logging.json']!.value as LoggingConfig;
    const next: LoggingConfig = {
      ...cur,
      groups: cur.groups.map((g) => (g.id === 'ap-suat' ? { ...g, retentionDays: 45 } : g)),
    };
    const out = applyDocEdits(docs, [{ kind: 'logging', value: next }]);
    expect((out['logging.json']!.value as LoggingConfig).groups[0]!.retentionDays).toBe(45);
    expect(writeOrder(out).map((d) => d.rel)).toEqual(['logging.json']);
    expect(JSON.parse(writtenText(out['logging.json']!)).schemaVersion).toBe('0.6.0');
  });

  it('edit reports khi chưa có file: tạo reports.json và thêm reportsFile vào project.json', () => {
    const files = demo();
    delete files['reports.json'];
    const p = JSON.parse(files['project.json']!);
    delete p.reportsFile;
    p.navigation.items = p.navigation.items.filter((i: { report?: string }) => !i.report);
    files['project.json'] = JSON.stringify(p, null, 2);
    const docs = open(files);
    const cfg: ReportsConfig = { schemaVersion: '0.6.0', reports: [] };
    const out = applyDocEdits(docs, [{ kind: 'reports', value: cfg }]);
    expect(out['reports.json']).toBeDefined();
    expect((out['project.json']!.value as { reportsFile?: string }).reportsFile).toBe(
      'reports.json',
    );
    expect(writeOrder(out).map((d) => d.rel)).toEqual(['reports.json', 'project.json']);
  });

  it('hoàn tác khôi phục logging.json', () => {
    const docs = open();
    const before = snapshotOf(docs);
    const cur = docs['logging.json']!.value as LoggingConfig;
    const out = applyDocEdits(docs, [
      { kind: 'logging', value: { ...cur, groups: cur.groups.slice(1) } },
    ]);
    expect((out['logging.json']!.value as LoggingConfig).groups.length).toBe(cur.groups.length - 1);
    const back = restoreSnapshot(out, before);
    expect((back['logging.json']!.value as LoggingConfig).groups.length).toBe(cur.groups.length);
  });

  it('lưu được khi còn lỗi: giá trị sai vẫn ghi (không chặn)', () => {
    const docs = open();
    const cur = docs['logging.json']!.value as LoggingConfig;
    const bad = { ...cur, groups: [{ ...cur.groups[0]!, retentionDays: -5 }] };
    const out = applyDocEdits(docs, [{ kind: 'logging', value: bad }]);
    expect(JSON.parse(writtenText(out['logging.json']!)).groups[0].retentionDays).toBe(-5);
  });
});
