// Luật widget alarm của danh mục 0.4.0 trên project 0.5 (feature 009; contracts/ui-alarm.md §13.3): W_WIDGET_ALARM_REF khi
// `areas`/`classes` tham chiếu id không có trong project (cảnh báo, không lỗi), E_ACTION_TARGET khi `target.screen` sai loại.
// Bản C++ (`core/project-manager`, rules_03/rules_04) phải cho cùng kết luận.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const BASE = resolve(__dirname, '../../../tests/project-vectors/v05-ok-base-full');

function readTree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, readTree(dir, r));
    else if (r !== 'expected.json') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

async function run(items: unknown[]) {
  const files = readTree(BASE);
  const screen = JSON.parse(files['screens/main.screen.json']!) as { items: unknown[] };
  const alarms = JSON.parse(files['alarms.json']!) as { areas: Array<{ id: string }> };
  const area = alarms.areas[0]!.id;
  files['screens/main.screen.json'] = JSON.stringify({
    ...screen,
    items: [...screen.items, ...items],
  });
  const r = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: '0.8.0',
  });
  const n = screen.items.length;
  return { r, n, area };
}

const widget = (id: string, kind: string, props: Record<string, unknown>) => ({
  id,
  type: 'widget',
  widget: kind,
  x: 0,
  y: 0,
  width: kind === 'alarm-list' ? 640 : 120,
  height: kind === 'alarm-list' ? 260 : 48,
  props,
});
const refs = (r: Awaited<ReturnType<typeof run>>['r']) =>
  r.warnings.filter((w) => w.code === 'W_WIDGET_ALARM_REF').map((w) => `${w.file} ${w.path}`);

describe('widget alarm trên project 0.5', () => {
  it('khu vực và lớp có thật: không cảnh báo, project hợp lệ', async () => {
    const { r, area } = await run([
      widget('al1', 'alarm-list', { areas: [area0()], classes: ['critical', 'major'] }),
    ]);
    void area;
    expect(refs(r)).toEqual([]);
    expect(r.errors.filter((e) => e.file.startsWith('screens/'))).toEqual([]);
  });

  it('id khu vực và lớp không có trong project: W_WIDGET_ALARM_REF theo từng phần tử, không phải lỗi', async () => {
    const { r, n } = await run([
      widget('al1', 'alarm-list', {
        areas: [area0(), 'khong-co', '-'],
        classes: ['critical', 'zz'],
      }),
      widget('ac1', 'alarm-count', { areas: ['ma'] }),
    ]);
    expect(refs(r).sort()).toEqual(
      [
        `screens/main.screen.json /items/${n}/props/areas/1`,
        `screens/main.screen.json /items/${n}/props/classes/1`,
        `screens/main.screen.json /items/${n + 1}/props/areas/0`,
      ].sort(),
    );
    expect(r.errors.filter((e) => e.file === 'screens/main.screen.json')).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('"-" (khu vực Chung) luôn hợp lệ', async () => {
    const { r } = await run([widget('al1', 'alarm-list', { areas: ['-'] })]);
    expect(refs(r)).toEqual([]);
  });

  it('alarm-count: target.screen phải là màn hình thường (E_ACTION_TARGET)', async () => {
    const { r, n } = await run([
      widget('ac1', 'alarm-count', { target: { kind: 'screen', screen: 'pump' } }),
      widget('ac2', 'alarm-count', { target: { kind: 'screen', screen: 'khong-co' } }),
      widget('ac3', 'alarm-count', { target: { kind: 'screen', screen: 'main' } }),
    ]);
    const got = r.errors
      .filter((e) => e.code === 'E_ACTION_TARGET')
      .map((e) => e.path)
      .sort();
    expect(got).toEqual(
      [`/items/${n}/props/target/screen`, `/items/${n + 1}/props/target/screen`].sort(),
    );
  });
});

function area0(): string {
  const a = JSON.parse(readFileSync(join(BASE, 'alarms.json'), 'utf8')) as {
    areas: Array<{ id: string }>;
  };
  return a.areas[0]!.id;
}
