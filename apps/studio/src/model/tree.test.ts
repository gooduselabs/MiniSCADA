// Cây project (feature 004, T007, data-model §7, FR-004, studio-ux.md §4): dựng từ projects/tank-demo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompareResult, ObjectDiff } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import { outlineOf, type ProjectFiles } from './project-doc.ts';
import {
  DEFAULT_EXPANDED,
  PHASE_PAGES,
  ancestorsOf,
  buildTree,
  deviceNodeState,
  deviceStateLabel,
  findByEditor,
  findNode,
  flattenTree,
  phaseLabel,
  refOfNode,
  type TreeInput,
  type TreeNode,
} from './tree.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const read = (f: string) => JSON.parse(readFileSync(resolve(DEMO, f), 'utf8')) as unknown;
const demoFiles = (): Record<string, unknown> => ({
  'project.json': read('project.json'),
  'tags.json': read('tags.json'),
  'logging.json': read('logging.json'),
  'screens/tank-motor.screen.json': read('screens/tank-motor.screen.json'),
  'screens/tank-motor.bindings.json': read('screens/tank-motor.bindings.json'),
});
const input = (files: ProjectFiles = demoFiles(), over: Partial<TreeInput> = {}): TreeInput => ({
  folderName: 'tank-demo',
  outline: outlineOf(files),
  device: { address: '192.168.1.110', state: 'idle' },
  ...over,
});
const ids = (n: TreeNode | undefined) => (n?.children ?? []).map((c) => c.id);
const node = (root: TreeNode, id: string) => {
  const n = findNode(root, id);
  if (!n) throw new Error(`không có nút ${id}`);
  return n;
};

describe('buildTree: project mẫu', () => {
  const root = buildTree(input());

  it('thứ tự mục theo studio-ux.md §4', () => {
    expect(root.id).toBe('root');
    expect(root.label).toBe('Trạm bơm nước (demo Sprint 1)');
    expect(root.editor).toBeNull();
    expect(ids(root)).toEqual(['start', 'settings', 'device', 'library']);
    expect(ids(node(root, 'device'))).toEqual([
      'connections',
      'tagsFolder',
      'valueTables',
      'alarm',
      'logging',
      'screens',
      'reports',
      'users',
    ]);
    expect(ids(node(root, 'tagsFolder'))).toEqual(['tags', 'calc']);
    expect(ids(node(root, 'alarm'))).toEqual(['alarmList', 'alarmClasses']);
    expect(ids(node(root, 'screens'))).toEqual(['screen:tank-motor']);
  });

  it('nhãn lấy từ chuỗi giao diện', () => {
    const label = (id: string) => node(root, id).label;
    expect(label('start')).toBe('Bắt đầu');
    expect(label('settings')).toBe('Thiết lập project');
    expect(label('tags')).toBe('Bảng Tag mặc định');
    expect(label('logging')).toBe('Lưu trữ');
    expect(label('screens')).toBe('Màn hình');
    expect(label('users')).toBe('Người dùng và quyền');
    expect(label('library')).toBe('Thư viện project');
  });

  it('số Tag của Bảng Tag và số nhóm của Lưu trữ', () => {
    expect(node(root, 'tags').count).toBe(5);
    expect(node(root, 'logging').count).toBe(2);
    expect(node(root, 'settings').count).toBeUndefined();
  });

  it('màn hình: tên từ screen.json, màn hình đầu có sub "màn hình đầu"', () => {
    const s = node(root, 'screen:tank-motor');
    expect(s.label).toBe('Bồn nước + bơm');
    expect(s.sub).toBe('màn hình đầu');
    expect(s.editor).toBe('screen:tank-motor');
  });

  it('mục giai đoạn sau có nhãn giai đoạn và mở trang giai đoạn', () => {
    const phases = Object.fromEntries(
      flattenTree(root, new Set(['root', 'device', 'tagsFolder', 'alarm']))
        .filter((r) => r.node.phase)
        .map((r) => [r.node.id, phaseLabel(r.node.phase!)]),
    );
    expect(phases).toEqual({
      connections: 'GĐ 2',
      calc: 'GĐ 2',
      valueTables: 'GĐ 2',
      alarm: 'GĐ 4',
      alarmList: 'GĐ 4',
      alarmClasses: 'GĐ 4',
      reports: 'GĐ 5',
      users: 'feature 005',
      library: 'GĐ 3b',
    });
    expect(node(root, 'calc').editor).toBe('phase:calc');
    expect(node(root, 'alarmClasses').editor).toBe('phase:alarm');
    expect(node(root, 'library').editor).toBe('phase:library');
    // mục đã làm không có nhãn giai đoạn
    for (const id of ['start', 'settings', 'device', 'tags', 'logging', 'screen:tank-motor'])
      expect(node(root, id).phase).toBeUndefined();
  });

  it('trang giai đoạn: tiêu đề, nội dung, giai đoạn cho mọi mục', () => {
    expect(Object.keys(PHASE_PAGES).sort()).toEqual(
      [
        'alarm',
        'calc',
        'connections',
        'driverDiag',
        'library',
        'reports',
        'users',
        'valueTables',
      ].sort(),
    );
    const calc = PHASE_PAGES.calc;
    expect(t(calc.title)).toBe('Tag tính toán');
    expect(t(calc.text)).toMatch(/^Tag tính bằng biểu thức/);
    expect(t('phasePage.heading', { title: t(calc.title), phase: phaseLabel(calc.phase) })).toBe(
      'Tag tính toán có ở GĐ 2',
    );
  });

  it('editor của từng mục', () => {
    expect(node(root, 'start').editor).toBe('start');
    expect(node(root, 'settings').editor).toBe('settings');
    expect(node(root, 'device').editor).toBe('device');
    expect(node(root, 'tags').editor).toBe('tags');
    expect(node(root, 'logging').editor).toBe('logging');
    expect(node(root, 'tagsFolder').editor).toBeNull();
    expect(node(root, 'screens').editor).toBeNull();
  });

  it('id ổn định giữa hai lần dựng', () => {
    const all = (r: TreeNode): string[] => [r.id, ...(r.children ?? []).flatMap(all)];
    const again = buildTree(input(demoFiles(), { device: { address: null, state: 'monitoring' } }));
    expect(all(again)).toEqual(all(root));
    expect(new Set(all(root)).size).toBe(all(root).length);
  });
});

describe('buildTree: project đọc được một phần', () => {
  it('thiếu project.json: vẫn dựng phần đọc được, nhãn gốc là tên thư mục', () => {
    const files = demoFiles();
    delete files['project.json'];
    const root = buildTree(input(files));
    expect(root.label).toBe('tank-demo');
    expect(ids(root)).toEqual(['start', 'settings', 'device', 'library']);
    expect(findNode(root, 'tags')?.count).toBe(5); // tags.json mặc định vẫn đọc được
    expect(findNode(root, 'logging')?.count).toBeUndefined();
    expect(ids(findNode(root, 'screens'))).toEqual([]);
  });

  it('file Tag hỏng: Bảng Tag không có số', () => {
    const files = demoFiles();
    delete files['tags.json'];
    expect(findNode(buildTree(input(files)), 'tags')?.count).toBeUndefined();
  });

  it('project không có logging.json: Lưu trữ không có số', () => {
    const files = demoFiles();
    const p = { ...(files['project.json'] as object) } as Record<string, unknown>;
    delete p.loggingFile;
    files['project.json'] = p;
    expect(findNode(buildTree(input(files)), 'logging')?.count).toBeUndefined();
  });

  it('screen.json thiếu: màn hình vẫn hiện theo id', () => {
    const files = demoFiles();
    delete files['screens/tank-motor.screen.json'];
    const s = findNode(buildTree(input(files)), 'screen:tank-motor');
    expect(s?.label).toBe('tank-motor');
    expect(s?.sub).toBe('màn hình đầu');
  });

  it('không có tên thư mục và project.json: nhãn chung "Project"', () => {
    expect(buildTree(input({}, { folderName: '' })).label).toBe('Project');
  });
});

describe('nút thiết bị', () => {
  it('nhãn BL335, địa chỉ đã nhập ở sub; chưa nhập thì nói rõ', () => {
    const dev = findNode(buildTree(input()), 'device')!;
    expect(dev.label).toBe('BL335');
    expect(dev.sub).toBe('192.168.1.110');
    const none = findNode(
      buildTree(input(demoFiles(), { device: { address: null, state: 'idle' } })),
      'device',
    );
    expect(none?.sub).toBe('chưa nhập địa chỉ');
    const named = findNode(
      buildTree(input(demoFiles(), { device: { name: 'BL335-01', address: 'x', state: 'idle' } })),
      'device',
    );
    expect(named?.label).toBe('BL335-01');
  });

  it('deviceState theo phiên', () => {
    const state = (s: TreeInput['device']['state']) =>
      findNode(buildTree(input(demoFiles(), { device: { address: 'x', state: s } })), 'device')
        ?.deviceState;
    expect(state('idle')).toBe('offline');
    expect(state('connecting')).toBe('offline');
    expect(state('error')).toBe('offline');
    expect(state('full')).toBe('offline');
    expect(state('incompatible')).toBe('offline');
    expect(state('monitoring')).toBe('monitoring');
    expect(state('lost')).toBe('lost');
    expect(deviceNodeState('lost')).toBe('lost');
    // chữ đi kèm chấm màu
    expect(deviceStateLabel('monitoring')).toBe('Đang theo dõi');
    expect(deviceStateLabel('offline')).toBe('Không kết nối');
    // chỉ nút thiết bị có deviceState
    expect(findNode(buildTree(input()), 'tags')?.deviceState).toBeUndefined();
  });
});

describe('duyệt cây', () => {
  const root = buildTree(input());

  it('flattenTree: chỉ nút đang mở, kèm mức (aria-level) và cha', () => {
    const rows = flattenTree(root, new Set(['root']));
    expect(rows.map((r) => [r.node.id, r.level])).toEqual([
      ['root', 1],
      ['start', 2],
      ['settings', 2],
      ['device', 2],
      ['library', 2],
    ]);
    expect(rows[1].parentId).toBe('root');
    const open = flattenTree(root, DEFAULT_EXPANDED);
    expect(open.map((r) => r.node.id)).toContain('screen:tank-motor');
    expect(open.find((r) => r.node.id === 'tags')?.level).toBe(4);
    expect(open.map((r) => r.node.id)).not.toContain('alarmList'); // Alarm đang đóng
  });

  it('findByEditor và ancestorsOf (mở đường tới mục khi chuyển tab)', () => {
    expect(findByEditor(root, 'tags')?.id).toBe('tags');
    expect(findByEditor(root, 'phase:alarm')?.id).toBe('alarm');
    expect(findByEditor(root, 'screen:khong-co')).toBeUndefined();
    expect(ancestorsOf(root, 'tags')).toEqual(['root', 'device', 'tagsFolder']);
    expect(ancestorsOf(root, 'root')).toEqual([]);
    expect(ancestorsOf(root, 'khong-co')).toBeNull();
  });
});

describe('ký hiệu so sánh trên cây (feature 005, T134, FR-029)', () => {
  const same = { localDigest: 'a', deviceDigest: 'a', same: true, files: [] };
  const obj = (
    kind: ObjectDiff['kind'],
    key: string,
    status: ObjectDiff['status'],
  ): ObjectDiff => ({ kind, key, file: 'x.json', status, fields: [] });
  const result: CompareResult = {
    ...same,
    same: false,
    objects: [
      obj('project', 'project', '='),
      obj('tag', 'TANK01.LEVEL', '≠'),
      obj('tag', 'MOTOR01.RUN', '='),
      obj('logging-group', 'van-hanh', '='),
      obj('logging-group', 'bao-cao-ca', '='),
      obj('screen', 'tank-motor', '='),
      obj('binding', 'tank-motor/el_tank_level/level', '+'),
    ],
  };
  const online = (): Partial<TreeInput> => ({
    device: { address: '192.168.1.110', state: 'monitoring' },
    compare: result,
  });

  it('Online có kết quả so: nút Tag, lưu trữ, màn hình, thiết lập mang ký hiệu gộp', () => {
    const root = buildTree(input(demoFiles(), online()));
    expect(node(root, 'tags').diff).toBe('≠');
    expect(node(root, 'logging').diff).toBe('=');
    expect(node(root, 'settings').diff).toBe('=');
    // Binding chỉ có trên máy ('+') cùng màn hình giống ('='): màn hình khác.
    expect(node(root, 'screen:tank-motor').diff).toBe('≠');
  });

  it('chờ đăng nhập lại vẫn hiện (dữ liệu sống vẫn chạy); nút không có đối tượng thì không có ký hiệu', () => {
    const root = buildTree(
      input(demoFiles(), { ...online(), device: { address: null, state: 'relogin' } }),
    );
    expect(node(root, 'tags').diff).toBe('≠');
    expect(node(root, 'alarm').diff).toBeUndefined();
    expect(node(root, 'start').diff).toBeUndefined();
  });

  it('không Online (idle, lost, error) hoặc chưa so thì không có ký hiệu', () => {
    for (const state of ['idle', 'lost', 'error', 'connecting'] as const) {
      const root = buildTree(input(demoFiles(), { ...online(), device: { address: null, state } }));
      expect(findNode(root, 'tags')?.diff).toBeUndefined();
    }
    const none = buildTree(
      input(demoFiles(), { device: { address: null, state: 'monitoring' }, compare: null }),
    );
    expect(findNode(none, 'tags')?.diff).toBeUndefined();
  });
});

// ---------- Project 0.2 (feature 006, T083, FR-043, R22) ----------

import { full02 } from './test-fixtures.ts';

const files02 = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(full02())
      .filter(([p]) => p.endsWith('.json'))
      .map(([p, v]) => [p, JSON.parse(v)]),
  );

describe('buildTree: project 0.2', () => {
  const root = buildTree(input(files02()));
  const dev = node(root, 'device');

  it('thứ tự mục: Kết nối, Tag, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver, rồi phần còn lại', () => {
    expect(ids(dev)).toEqual([
      'connections',
      'tagsFolder',
      'valueTables',
      'watchTables',
      'driverDiag',
      'alarm',
      'logging',
      'screens',
      'reports',
      'users',
    ]);
  });

  it('Kết nối: kênh › thiết bị trường, kèm số thiết bị và số Tag', () => {
    const c = node(root, 'connections');
    expect(c.label).toBe('Kết nối');
    expect(c.editor).toBe('connections');
    expect(c.count).toBe(2);
    expect(c.phase).toBeUndefined();
    expect(ids(c)).toEqual(['channel:plc1', 'channel:rs485-1']);
    const rtu = node(root, 'channel:rs485-1');
    expect(rtu.editor).toBe('connections');
    expect(rtu.count).toBe(2);
    expect(rtu.label).toBe('RS485 đồng hồ điện');
    expect(ids(rtu)).toEqual(['fdev:meter1', 'fdev:meter2']);
    const m1 = node(root, 'fdev:meter1');
    expect(m1.count).toBe(1);
    expect(m1.sub).toBe('slave 1');
    expect(node(root, 'fdev:plc1').sub).toBe('unit 1');
    expect(node(root, 'fdev:plc1').count).toBe(6);
  });

  it('Tag: Bảng Tag có số Tag; Tag tính toán có số Tag tính toán', () => {
    expect(ids(node(root, 'tagsFolder'))).toEqual(['tags', 'calc']);
    expect(node(root, 'tags').count).toBe(13);
    expect(node(root, 'tags').phase).toBeUndefined();
    expect(node(root, 'calc').count).toBe(3);
  });

  it('Bảng giá trị và Bảng theo dõi: từng bảng một nút; bảng theo dõi mở editor riêng', () => {
    const vt = node(root, 'valueTables');
    expect(vt.count).toBe(1);
    expect(ids(vt)).toEqual(['valuetable:TrangThaiBom']);
    const wt = node(root, 'watchTables');
    expect(wt.count).toBe(1);
    expect(wt.editor).toBeNull();
    expect(ids(wt)).toEqual(['watch:van-hanh']);
    expect(node(root, 'watch:van-hanh').editor).toBe('watch:van-hanh');
    expect(node(root, 'watch:van-hanh').label).toBe('Vận hành');
    expect(node(root, 'watch:van-hanh').phase).toBeUndefined();
  });

  it('Bảng giá trị, Tag tính toán, Chẩn đoán driver bỏ nhãn giai đoạn và có editor riêng (FR-043)', () => {
    for (const id of ['valueTables', 'calc', 'driverDiag'])
      expect(node(root, id).phase, id).toBeUndefined();
    expect(node(root, 'calc').editor).toBe('calc');
    expect(node(root, 'driverDiag').editor).toBe('driverDiag');
    expect(node(root, 'valueTables').editor).toBeNull();
    expect(node(root, 'valuetable:TrangThaiBom').editor).toBe('vt:TrangThaiBom');
    expect(node(root, 'alarm').phase).toBe('p4');
  });

  it('project 0.1 giữ cây cũ (Kết nối là trang giai đoạn)', () => {
    const old = buildTree(input());
    expect(node(old, 'connections').editor).toBe('phase:connections');
    expect(findNode(old, 'watchTables')).toBeUndefined();
  });

  it('chấm trạng thái của kênh khi Online', () => {
    const live = buildTree(
      input(files02(), {
        device: { address: '1.2.3.4', state: 'monitoring' },
        channelStates: { plc1: 'connected', 'rs485-1': 'error' },
      }),
    );
    expect(node(live, 'channel:plc1').status).toBe('connected');
    expect(node(live, 'channel:rs485-1').status).toBe('error');
    expect(node(root, 'channel:plc1').status).toBeUndefined();
  });

  it('ký hiệu So sánh: kênh, thiết bị trường, bảng; nút nhóm gộp từ nút con', () => {
    const cmp: CompareResult = {
      localDigest: 'a',
      deviceDigest: 'b',
      same: false,
      files: [],
      objects: [
        { kind: 'channel', key: 'plc1', file: 'connections.json', status: '≠', fields: [] },
        { kind: 'field-device', key: 'meter1', file: 'connections.json', status: '+', fields: [] },
        {
          kind: 'value-table',
          key: 'TrangThaiBom',
          file: 'value-tables/TrangThaiBom.json',
          status: '=',
          fields: [],
        },
        {
          kind: 'watch-table',
          key: 'van-hanh',
          file: 'watch-tables/van-hanh.json',
          status: '≠',
          fields: [],
        },
      ],
    };
    const t2 = buildTree(
      input(files02(), { device: { address: 'x', state: 'monitoring' }, compare: cmp }),
    );
    expect(node(t2, 'channel:plc1').diff).toBe('≠');
    expect(node(t2, 'fdev:meter1').diff).toBe('+');
    expect(node(t2, 'valuetable:TrangThaiBom').diff).toBe('=');
    expect(node(t2, 'watch:van-hanh').diff).toBe('≠');
    expect(node(t2, 'connections').diff).toBe('≠');
    expect(node(t2, 'watchTables').diff).toBe('≠');
    expect(node(t2, 'valueTables').diff).toBe('=');
  });

  it('nút theo id: refOfNode và nhãn dùng cho lệnh thêm, đổi tên, nhân bản, xóa', () => {
    expect(refOfNode('channel:plc1')).toEqual({ type: 'channel', id: 'plc1' });
    expect(refOfNode('fdev:meter1')).toEqual({ type: 'device', id: 'meter1' });
    expect(refOfNode('valuetable:TrangThaiBom')).toEqual({
      type: 'valueTable',
      name: 'TrangThaiBom',
    });
    expect(refOfNode('watch:van-hanh')).toEqual({ type: 'watch', id: 'van-hanh' });
    expect(refOfNode('connections')).toEqual({ type: 'connections' });
    expect(refOfNode('valueTables')).toEqual({ type: 'valueTables' });
    expect(refOfNode('watchTables')).toEqual({ type: 'watchTables' });
    expect(refOfNode('tags')).toBeNull();
    // Feature 007: màn hình của project 0.3 có thao tác cây (thêm, đổi tên, nhân bản, xóa).
    expect(refOfNode('screens')).toEqual({ type: 'screens' });
    expect(refOfNode('screen:main')).toEqual({ type: 'screen', id: 'main' });
  });
});
