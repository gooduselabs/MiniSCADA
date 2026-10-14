// So sánh theo đối tượng của alarm (feature 009, FR-083; contract studio-alarm-editor §10): alarm theo id định nghĩa, lớp theo id,
// khu vực theo id; thứ tự dòng trong tệp không tạo khác biệt; chi tiết trường khác nhau (ngưỡng H, lớp theo ngưỡng, trễ).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MemorySource,
  compareProjects,
  packageDigest,
  packageFile,
  type DeviceSide,
  type LocalSide,
  type PackageFile,
} from './index.ts';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const text = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

const project = {
  format: 'matscada-project',
  schemaVersion: '0.5.0',
  projectId: 'p',
  projectName: 'P',
  projectVersion: '1',
  minRuntimeVersion: '0.8.0',
  tagFile: 'tags.json',
  alarmFile: 'alarms.json',
  alarmClassFile: 'alarm-classes.json',
  screens: [],
};
const tags = { schemaVersion: '0.5.0', tags: [] };
const classes = (extra: object[] = []) => ({
  schemaVersion: '0.5.0',
  classes: [
    { id: 'critical', name: 'Khẩn cấp', priority: 'critical', color: 'red' },
    { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber' },
    ...extra,
  ],
});
const lvl = (h: number, cls = 'minor', delay = 3000) => ({
  id: 'TL',
  type: 'limit',
  name: 'Mức',
  tag: 'T.L',
  limits: { H: { value: h, class: cls } },
  onDelayMs: delay,
});
const dig = {
  id: 'PF',
  type: 'digital',
  name: 'Lỗi',
  tag: 'P.F',
  trigger: true,
  class: 'critical',
};
const alarms = (list: object[], areas: object[] = [{ id: 'bon', name: 'Bồn' }]) => ({
  schemaVersion: '0.5.0',
  areas,
  alarms: list,
});

async function side(files: Record<string, unknown>) {
  const texts = Object.fromEntries(Object.entries(files).map(([p, v]) => [p, text(v)]));
  const list: PackageFile[] = await Promise.all(
    Object.entries(texts).map(([p, t]) => packageFile(p, t, sha256)),
  );
  const digest = await packageDigest(list, sha256);
  const source = new MemorySource(texts);
  const local: LocalSide = { digest, files: list, source };
  const dev: DeviceSide = { digest, files: async () => list, source: async () => source };
  return { local, dev, digest, list, source };
}

async function compare(l: Record<string, unknown>, d: Record<string, unknown>) {
  const a = await side(l);
  const b = await side(d);
  return compareProjects(a.local, b.dev);
}

const base = (alarmList: object[], cls = classes(), areas?: object[]) => ({
  'project.json': project,
  'tags.json': tags,
  'alarms.json': alarms(alarmList, areas),
  'alarm-classes.json': cls,
});
const find = (r: Awaited<ReturnType<typeof compare>>, kind: string, key: string) =>
  r.objects.find((o) => o.kind === kind && o.key === key);

describe('compareProjects: alarm (FR-083)', () => {
  it('giống nhau: mọi đối tượng alarm, lớp, khu vực đều =', async () => {
    const r = await compare(base([lvl(80), dig]), base([lvl(80), dig]));
    expect(r.same).toBe(true);
    expect(find(r, 'alarm', 'TL')?.status).toBe('=');
    expect(find(r, 'alarm-class', 'critical')?.status).toBe('=');
    expect(find(r, 'alarm-area', 'bon')?.status).toBe('=');
  });

  it('thứ tự dòng trong tệp không tạo khác biệt ở đối tượng (file ≠ nhưng alarm =)', async () => {
    const r = await compare(base([lvl(80), dig]), base([dig, lvl(80)]));
    expect(r.same).toBe(false);
    expect(r.files.find((f) => f.path === 'alarms.json')?.status).toBe('≠');
    expect(find(r, 'alarm', 'TL')?.status).toBe('=');
    expect(find(r, 'alarm', 'PF')?.status).toBe('=');
  });

  it('khác một trường: ≠ kèm đúng trường (ngưỡng H, lớp theo ngưỡng, trễ bật); chỉ một bên có là + hoặc -', async () => {
    const r = await compare(
      base([lvl(85, 'critical', 5000), dig]),
      base([lvl(80), dig, { ...dig, id: 'ONLY_DEV' }]),
    );
    const tl = find(r, 'alarm', 'TL')!;
    expect(tl.status).toBe('≠');
    expect(tl.fields.map((f) => f.path).sort()).toEqual([
      '/limits/H/class',
      '/limits/H/value',
      '/onDelayMs',
    ]);
    expect(tl.fields.find((f) => f.path === '/limits/H/value')).toMatchObject({
      local: 85,
      device: 80,
    });
    expect(find(r, 'alarm', 'ONLY_DEV')?.status).toBe('-');
    const r2 = await compare(
      base([lvl(80), dig, { ...dig, id: 'ONLY_LOCAL' }]),
      base([lvl(80), dig]),
    );
    expect(find(r2, 'alarm', 'ONLY_LOCAL')?.status).toBe('+');
  });

  it('lớp và khu vực so theo id', async () => {
    const l = base(
      [lvl(80)],
      classes([{ id: 'extra', name: 'Thêm', priority: 'major', color: 'blue' }]),
      [{ id: 'bon', name: 'Bồn nước' }],
    );
    const d = base([lvl(80)], classes(), [{ id: 'bon', name: 'Bồn' }]);
    const r = await compare(l, d);
    expect(find(r, 'alarm-class', 'extra')?.status).toBe('+');
    expect(find(r, 'alarm-area', 'bon')).toMatchObject({
      status: '≠',
      fields: [{ path: '/name' }],
    });
    expect(r.objects.filter((o) => o.kind.startsWith('alarm')).map((o) => o.kind)).toEqual([
      'alarm-class',
      'alarm-class',
      'alarm-class',
      'alarm-area',
      'alarm',
    ]);
  });

  it('project không có alarm ở một bên: alarm của bên kia là + hoặc -', async () => {
    const noAlarm = {
      'project.json': { ...project, alarmFile: undefined, alarmClassFile: undefined },
      'tags.json': tags,
    };
    const r = await compare(base([lvl(80)]), noAlarm);
    expect(find(r, 'alarm', 'TL')?.status).toBe('+');
  });
});
