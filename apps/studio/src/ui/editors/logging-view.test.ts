// Editor Lưu trữ chỉ đọc (feature 004, US4, T076, FR-026, FR-006, FR-018): từng nhóm (chế độ, khoảng
// ghi, Tag và deadband, thời hạn, đích gửi), từng kết nối DB ngoài (loại, máy chủ, bảng, TLS, không có
// mật khẩu), ước tính ghi eMMC bằng đúng hàm của @mat/project-schema, lỗi và cảnh báo cạnh mục, chọn
// nhóm cho inspector, nhận vị trí lỗi từ tab Thông tin. Project dựng trên lớp platform giả, ghi đè từng
// file khi cần.
import { estimateLogging, type TagDataType } from '@mat/project-schema';
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import { createMockPlatform, sha256Hex, type MockPlatform } from '../../platform/mock.ts';
import '../mat-details.ts';
import '../mat-inspector.ts';
import type { MatDetails } from '../mat-details.ts';
import type { MatInspector } from '../mat-inspector.ts';
import { renderEditor, renderProps } from '../registry.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './logging-view.ts';
import { maskAddress } from './logging-view.ts';

/** Nội dung thay cho file trên đĩa: chuỗi, `null` (không có file) hoặc hàm sửa nội dung gốc. */
type Override = string | null | ((disk: string) => string);

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

async function openProject(files: Record<string, Override> = {}) {
  const platform: MockPlatform = createMockPlatform();
  const read = platform.read;
  platform.read = async (rel) => {
    if (!Object.prototype.hasOwnProperty.call(files, rel)) return read(rel);
    const o = files[rel];
    if (o === null) return { error: 'missing' };
    let text: string;
    if (typeof o === 'function') {
      const disk = await read(rel);
      if (!('text' in disk)) return disk;
      text = o(disk.text);
    } else text = o;
    return { text, hash: await sha256Hex(text) };
  };
  const app = new StudioApp({ platform, storage: null, windowWidth: 1400 });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  return { app, platform };
}

/** Vẽ editor `logging` qua bảng đăng ký (như vùng editor của khung). */
async function mountView(app: StudioApp): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  render(renderEditor(app, 'logging'), host);
  await settled(host);
  const el = host.querySelector<HTMLElement>('mat-logging-view');
  expect(el, 'editor logging đã đăng ký').not.toBeNull();
  return el!;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => norm(td.textContent));
const headers = (el: Element, table: string) =>
  [...el.querySelectorAll(`table[data-table="${table}"] thead th`)].map((th) =>
    norm(th.textContent),
  );
const groupRows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-group]')];
const tagRows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-tag]')];
const connRows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-conn]')];
const codesOf = (app: StudioApp, file: string) =>
  app.store.state.issues
    .filter((i) => i.file === file)
    .map((i) => i.code)
    .sort();
const propRows = (insp: Element) =>
  [...insp.querySelectorAll('.prow')].map((r) => [
    norm(r.querySelector('.pl')?.textContent),
    norm(r.querySelector('.pv')?.textContent),
  ]);

// Fixture có kết nối DB ngoài: PostgreSQL `tls: require` (W_LOG_TLS_UNVERIFIED) và InfluxDB https.
const WITH_DB = {
  schemaVersion: '0.1.0',
  timeZone: '+07:00',
  groups: [
    {
      id: 'van-hanh',
      name: 'Vận hành',
      mode: 'onChange',
      minIntervalMs: 1000,
      maxIntervalMs: 60000,
      retentionDays: 30,
      destinations: ['kho-du-lieu'],
      tags: [{ tagId: 'TANK01.LEVEL', deadband: 0.5 }, { tagId: 'MOTOR01.RUN' }],
    },
    {
      id: 'bao-cao-ca',
      name: 'Báo cáo ca',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 365,
      destinations: ['kho-du-lieu', 'influx'],
      tags: [{ tagId: 'TANK01.LEVEL', column: 'MUC_BON' }, { tagId: 'TANK01.INFLOW' }],
    },
  ],
  connections: [
    {
      id: 'kho-du-lieu',
      type: 'postgresql',
      host: '10.0.0.5',
      port: 5432,
      database: 'scada',
      user: 'scada_writer',
      tls: 'require',
    },
    {
      id: 'influx',
      type: 'influxdb',
      url: 'https://influx.local:8086',
      org: 'atpro',
      bucket: 'scada',
    },
  ],
};

// Lỡ để bí mật trong project: khóa password và URL có tài khoản/mật khẩu (E_LOG_SECRET).
const WITH_SECRET = {
  ...WITH_DB,
  connections: [
    { ...WITH_DB.connections[0], password: 'hunter2' },
    { ...WITH_DB.connections[1], url: 'https://admin:S3cret@influx.local:8086' },
  ],
};

/** logging.json mẫu với Tag thứ 2 của nhóm "Báo cáo ca" sai tên (E_LOG_REF_TAG). */
const badTag = (disk: string) => {
  const cfg = JSON.parse(disk);
  cfg.groups[1].tags[1].tagId = 'TANK99.FLOW';
  return json(cfg);
};

describe('editor Lưu trữ (logging-view)', () => {
  afterEach(cleanup);

  it('project mẫu: đủ 2 nhóm với chế độ, khoảng ghi, số Tag, thời hạn, đích gửi', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    expect(norm(el.querySelector('.ed-head h2')?.textContent)).toBe('Lưu trữ');
    expect(norm(el.querySelector('.ed-head .path')?.textContent)).toBe('logging.json');
    expect(headers(el, 'groups')).toEqual([
      'Nhóm',
      'Chế độ',
      'Khoảng ghi',
      'Tag',
      'Thời hạn',
      'Gửi tới',
    ]);
    const rows = groupRows(el);
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toEqual([
      'Vận hành van-hanh',
      'Theo thay đổi',
      '1 s – 60 s',
      '4',
      '30 ngày',
      'chỉ SQLite trên thiết bị',
    ]);
    expect(cells(rows[1])).toEqual([
      'Báo cáo ca bao-cao-ca',
      'Theo chu kỳ',
      '60 s',
      '3',
      '365 ngày',
      'chỉ SQLite trên thiết bị',
    ]);
    expect(norm(el.textContent)).toContain('UTC+07:00');
  });

  it('Tag và deadband của nhóm; nhóm đầu chọn sẵn; nhấp nhóm khác → app.select và bảng Tag đổi theo', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 0 });
    expect(groupRows(el).map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(norm(el.querySelector('[data-heading="tags"]')?.textContent)).toBe(
      'Tag của nhóm Vận hành',
    );
    expect(headers(el, 'tags')).toEqual(['Tag', 'Kiểu', 'Cột', 'Deadband', 'Ghi khi']);
    expect(tagRows(el).map(cells)).toEqual([
      ['TANK01.LEVEL', 'FLOAT32', 'TANK01_LEVEL', '0,5', 'ghi khi đổi quá deadband'],
      ['MOTOR01.RUN', 'BOOL', 'MOTOR01_RUN', '—', 'ghi khi đổi'],
      ['MOTOR01.SPEED', 'FLOAT32', 'MOTOR01_SPEED', '10', 'ghi khi đổi quá deadband'],
      ['TANK01.TEMP', 'FLOAT32', 'TANK01_TEMP', '—', 'ghi khi đổi'],
    ]);

    groupRows(el)[1].click();
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    expect(groupRows(el).map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(norm(el.querySelector('[data-heading="tags"]')?.textContent)).toBe(
      'Tag của nhóm Báo cáo ca',
    );
    expect(tagRows(el).map(cells)).toEqual([
      ['TANK01.LEVEL', 'FLOAT32', 'TANK01_LEVEL', '—', 'ghi mỗi chu kỳ'],
      ['TANK01.INFLOW', 'FLOAT32', 'TANK01_INFLOW', '—', 'ghi mỗi chu kỳ'],
      ['MOTOR01.RUN', 'BOOL', 'MOTOR01_RUN', '—', 'ghi mỗi chu kỳ'],
    ]);
  });

  it('chọn nhóm ở vùng Details cũng đổi bảng Tag của editor', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    const details = await mount<MatDetails>('mat-details', app);
    details.querySelectorAll<HTMLElement>('.dl-row')[1].click();
    await settled();
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    expect(norm(el.querySelector('[data-heading="tags"]')?.textContent)).toBe(
      'Tag của nhóm Báo cáo ca',
    );
  });

  it('chỉ đọc: không có ô nhập, có ghi chú editor sửa ở GĐ 5; không có DB ngoài thì nói chỉ ghi SQLite', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    expect(el.querySelectorAll('input, select, textarea, [contenteditable]')).toHaveLength(0);
    expect(norm(el.querySelector('.lv-note')?.textContent)).toContain(
      'Editor sửa lưu trữ có ở GĐ 5',
    );
    expect(el.querySelector('table[data-table="connections"]')).toBeNull();
    expect(norm(el.textContent)).toContain(
      'Không có kết nối DB ngoài: dữ liệu chỉ nằm trong SQLite trên thiết bị.',
    );
  });

  it('ước tính ghi eMMC bằng đúng estimateLogging của @mat/project-schema', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    const outline = app.store.state.outline;
    const types = new Map<string, TagDataType>(outline.tags!.tags.map((t) => [t.id, t.type]));
    const e = estimateLogging(outline.logging!, types);
    // Tính tay theo contracts/logging-config.md: nhóm theo thay đổi 1 s (4 Tag) + chu kỳ 60 s (3 Tag).
    expect(e).toEqual({ writeBytesPerDay: 239_316_480, storageBytes: 160_502_400, warnings: [] });

    const write = el.querySelector('data[data-est="write"]');
    const storage = el.querySelector('data[data-est="storage"]');
    expect(Number(write?.getAttribute('value'))).toBe(e.writeBytesPerDay);
    expect(Number(storage?.getAttribute('value'))).toBe(e.storageBytes);
    expect(norm(write?.textContent)).toBe('≈ 239 MB/ngày · 11,1 % ngân sách 2 GiB/ngày');
    expect(norm(storage?.textContent)).toBe('≈ 161 MB · 7,5 % trần 2 GiB');
    expect(el.querySelector('.lv-est [data-code]')).toBeNull();
    expect(el.querySelector('.lv-est .bar.over')).toBeNull();
  });

  it('W_LOG_SIZE_CAP hiện ngay cạnh ước tính, kèm icon và chữ', async () => {
    const { app } = await openProject({
      'logging.json': (disk) => {
        const cfg = JSON.parse(disk);
        cfg.groups[0].retentionDays = 3650;
        return json(cfg);
      },
    });
    expect(codesOf(app, 'logging.json')).toEqual(['W_LOG_SIZE_CAP']);
    app.openEditor('logging');
    const el = await mountView(app);
    const warn = el.querySelector('.lv-est [data-code="W_LOG_SIZE_CAP"]');
    expect(warn).not.toBeNull();
    expect(warn?.querySelector('svg.ic.warn')).not.toBeNull();
    expect(norm(warn?.textContent)).toContain('Cảnh báo');
    expect(norm(warn?.textContent)).toContain('W_LOG_SIZE_CAP');
    expect(norm(warn?.textContent)).toContain('vẫn lưu được');
    expect(el.querySelector('[data-est-bar="storage"]')?.classList.contains('over')).toBe(true);
    expect(el.querySelector('[data-est-bar="write"]')?.classList.contains('over')).toBe(false);
  });

  it('kết nối DB ngoài: loại, máy chủ, bảng, TLS, không có cột mật khẩu; W_LOG_TLS_UNVERIFIED cạnh kết nối', async () => {
    const { app } = await openProject({ 'logging.json': json(WITH_DB) });
    expect(codesOf(app, 'logging.json')).toEqual(['W_LOG_TLS_UNVERIFIED']);
    app.openEditor('logging');
    const el = await mountView(app);
    expect(headers(el, 'connections')).toEqual(['Kết nối', 'Loại', 'Máy chủ', 'Bảng', 'TLS']);
    const rows = connRows(el);
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toEqual([
      'kho-du-lieu 1 cảnh báo',
      'PostgreSQL',
      '10.0.0.5:5432/scada',
      'van_hanh, bao_cao_ca',
      'require · mã hóa, không xác thực máy chủ',
    ]);
    expect(cells(rows[1])).toEqual([
      'influx',
      'InfluxDB',
      'https://influx.local:8086 · org atpro · bucket scada',
      'bao_cao_ca',
      'theo URL (https) · xác thực máy chủ',
    ]);
    const sub = el.querySelector('tr.lv-issue[data-issues="conn:0"]');
    expect(norm(sub?.textContent)).toContain('W_LOG_TLS_UNVERIFIED');
    expect(sub?.querySelector('svg.ic.warn')).not.toBeNull();
    expect(el.querySelector('tr.lv-issue[data-issues="conn:1"]')).toBeNull();
    expect(cells(groupRows(el)[0])[5]).toBe('kho-du-lieu');
    expect(cells(groupRows(el)[1])[5]).toBe('kho-du-lieu, influx');
    expect(norm(el.textContent)).toContain(
      'Mật khẩu và token của DB ngoài lưu trên thiết bị (secrets.json)',
    );
  });

  it('không hiện mật khẩu kể cả khi lỡ nằm trong project: khóa password, URL có tài khoản', async () => {
    const { app } = await openProject({ 'logging.json': json(WITH_SECRET) });
    expect(codesOf(app, 'logging.json')).toEqual(['E_LOG_SECRET']);
    app.openEditor('logging');
    const el = await mountView(app);
    const html = el.outerHTML;
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('S3cret');
    expect(html).not.toContain('admin');
    expect(cells(connRows(el)[1])[2]).toBe(
      'https://•••@influx.local:8086 · org atpro · bucket scada',
    );
    const sub = el.querySelector('tr.lv-issue[data-issues="conn:0"]');
    expect(norm(sub?.textContent)).toContain('E_LOG_SECRET');
    expect(sub?.querySelector('svg.ic.err')).not.toBeNull();
    expect(cells(connRows(el)[0])[0]).toBe('kho-du-lieu 1 lỗi');
  });

  it('maskAddress che tài khoản, mật khẩu và chuỗi truy vấn của địa chỉ', () => {
    expect(maskAddress('https://admin:S3cret@influx.local:8086')).toBe(
      'https://•••@influx.local:8086',
    );
    expect(maskAddress('http://u@10.0.0.7:8086/x')).toBe('http://•••@10.0.0.7:8086/x');
    expect(maskAddress('https://a:p/w@h')).toBe('https://•••@h');
    expect(maskAddress('http://10.0.0.7:8086?token=abc')).toBe('http://10.0.0.7:8086?•••');
    expect(maskAddress('http://h#tok')).toBe('http://h#•••');
    expect(maskAddress('db:pw@10.0.0.5')).toBe('•••@10.0.0.5');
    expect(maskAddress('u:a://b@h')).toBe('•••@h');
    expect(maskAddress('https://u:p?x@h')).toBe('https://•••');
    expect(maskAddress('https://influx.local:8086')).toBe('https://influx.local:8086');
    expect(maskAddress('10.0.0.5')).toBe('10.0.0.5');
  });

  it('sửa tay logging.json cho sai một Tag rồi F7: lỗi cạnh nhóm, ở dòng Tag, trong tab Thông tin; chưa ước tính', async () => {
    const { app, platform } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    const insp = await mount<MatInspector>('mat-inspector', app);
    const disk = await platform.read('logging.json');
    expect('text' in disk).toBe(true);
    platform.control.editOutside('logging.json', badTag((disk as { text: string }).text));
    await app.run('tools.validate');
    await settled();

    expect(codesOf(app, 'logging.json')).toEqual(['E_LOG_REF_TAG']);
    expect(app.ui.inspectorTab).toBe('info');
    expect(norm(insp.querySelector('.issues')?.textContent)).toContain('E_LOG_REF_TAG');

    const row = groupRows(el)[1];
    expect(norm(row.querySelector('td')?.textContent)).toContain('1 lỗi');
    expect(row.querySelector('td .chip.err svg.ic.err')).not.toBeNull();
    const sub = el.querySelector('tr.lv-issue[data-issues="group:1"]');
    expect(norm(sub?.textContent)).toContain('E_LOG_REF_TAG');
    expect(norm(sub?.textContent)).toContain('Lỗi');
    expect(el.querySelector('tr.lv-issue[data-issues="group:0"]')).toBeNull();

    row.click();
    await settled(el);
    const tag = tagRows(el)[1];
    expect(norm(tag.querySelector('td')?.textContent)).toContain('TANK99.FLOW');
    expect(norm(tag.querySelector('td')?.textContent)).toContain('E_LOG_REF_TAG');
    expect(cells(tag)[1]).toBe('không có trong file Tag');

    expect(el.querySelector('data[data-est]')).toBeNull();
    expect(norm(el.querySelector('.lv-est')?.textContent)).toContain(
      'Chưa ước tính được: sửa lỗi của logging.json trước',
    );
  });

  it('nhận vị trí lỗi của nhóm (nhấp đúp ở Thông tin): mở Lưu trữ, chọn, tô và focus đúng nhóm', async () => {
    const { app } = await openProject({ 'logging.json': badTag });
    const el = await mountView(app);
    const issue = app.store.state.issues.find((i) => i.code === 'E_LOG_REF_TAG');
    expect(issue).toBeDefined();
    expect(app.gotoIssue(issue!)).toBe(true);
    await settled(el);
    expect(app.store.state.active).toBe('logging');
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    const row = groupRows(el)[1];
    expect(row.classList.contains('lv-revealed')).toBe(true);
    expect(groupRows(el)[0].classList.contains('lv-revealed')).toBe(false);
    expect(document.activeElement).toBe(row);
  });

  it('nhận vị trí lỗi của kết nối: tô và focus đúng dòng kết nối', async () => {
    const { app } = await openProject({ 'logging.json': json(WITH_DB) });
    const el = await mountView(app);
    const issue = app.store.state.issues.find((i) => i.code === 'W_LOG_TLS_UNVERIFIED');
    expect(app.gotoIssue(issue!)).toBe(true);
    await settled(el);
    const row = connRows(el)[0];
    expect(row.classList.contains('lv-revealed')).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it('bàn phím: ↑ ↓ Home End chọn nhóm và chuyển focus; chỉ dòng đang chọn nhận Tab', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    const el = await mountView(app);
    expect(el.querySelector('table[data-table="groups"]')?.getAttribute('role')).toBe('grid');
    expect(groupRows(el).map((r) => r.tabIndex)).toEqual([0, -1]);
    groupRows(el)[0].focus();
    press(groupRows(el)[0], 'ArrowDown');
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    expect(document.activeElement).toBe(groupRows(el)[1]);
    expect(groupRows(el).map((r) => r.tabIndex)).toEqual([-1, 0]);
    press(groupRows(el)[1], 'ArrowDown');
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    press(groupRows(el)[1], 'Home');
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 0 });
    expect(document.activeElement).toBe(groupRows(el)[0]);
    press(groupRows(el)[0], 'End');
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
  });

  it('inspector › Thuộc tính của nhóm: mã nhóm, chế độ, khoảng ghi, thời hạn, gửi tới, bảng ở DB ngoài', async () => {
    const { app } = await openProject({ 'logging.json': json(WITH_DB) });
    app.openEditor('logging');
    const el = await mountView(app);
    const insp = await mount<MatInspector>('mat-inspector', app);
    await settled();
    expect(norm(insp.querySelector('.insp-ctx')?.textContent)).toBe('Nhóm lưu trữ Vận hành');
    expect(propRows(insp)).toEqual([
      ['Mã nhóm', 'van-hanh'],
      ['Chế độ', 'Theo thay đổi'],
      ['Khoảng ghi', 'cách nhau ít nhất 1 s; không đổi thì vẫn ghi sau 60 s'],
      ['Số Tag', '2'],
      ['Thời hạn', '30 ngày, tự xóa bản ghi cũ hơn'],
      ['Gửi tới', 'kho-du-lieu'],
      ['Bảng ở DB ngoài', 'van_hanh (bảng rộng, mỗi Tag một cột)'],
    ]);

    groupRows(el)[1].click();
    await settled();
    expect(norm(insp.querySelector('.insp-ctx')?.textContent)).toBe('Nhóm lưu trữ Báo cáo ca');
    expect(propRows(insp)).toEqual([
      ['Mã nhóm', 'bao-cao-ca'],
      ['Chế độ', 'Theo chu kỳ'],
      ['Khoảng ghi', 'mỗi 60 s một dòng'],
      ['Số Tag', '2'],
      ['Thời hạn', '365 ngày, tự xóa bản ghi cũ hơn'],
      ['Gửi tới', 'kho-du-lieu, influx'],
      ['Bảng ở DB ngoài', 'bao_cao_ca (bảng rộng, mỗi Tag một cột)'],
    ]);
  });

  it('inspector: nhóm chỉ ghi trên thiết bị không có bảng ở DB ngoài; chỉ số nhóm không còn thì để bộ vẽ khác', async () => {
    const { app } = await openProject();
    app.openEditor('logging');
    await mountView(app);
    app.select({ kind: 'group', index: 1 });
    const view = renderProps(app);
    expect(view?.ctx).toBe('Nhóm lưu trữ Báo cáo ca');
    const host = document.createElement('div');
    document.body.append(host);
    render(view?.body, host);
    expect(propRows(host)).toContainEqual(['Gửi tới', 'chỉ SQLite trên thiết bị']);
    expect(propRows(host)).toContainEqual(['Bảng ở DB ngoài', '—']);
    app.select({ kind: 'group', index: 9 });
    expect(renderProps(app)).toBeNull();
    app.select({ kind: 'project' });
    expect(renderProps(app)).toBeNull();
  });

  it('project không có loggingFile: nói project chưa lưu dữ liệu và chỉ tới tài liệu cấu hình', async () => {
    const { app } = await openProject({
      'project.json': (disk) => {
        const p = JSON.parse(disk);
        delete p.loggingFile;
        return json(p);
      },
    });
    app.openEditor('logging');
    const el = await mountView(app);
    const empty = norm(el.querySelector('.lv-empty')?.textContent);
    expect(empty).toContain('Project chưa lưu dữ liệu');
    expect(empty).toContain('specs/003-data-logging/contracts/logging-config.md');
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelector('.lv-est')).toBeNull();
    expect(app.store.state.selection).toBeNull();
  });

  it('có loggingFile nhưng không đọc được file: báo lỗi của file, không vỡ', async () => {
    const { app } = await openProject({ 'logging.json': null });
    expect(codesOf(app, 'logging.json')).toEqual(['E_FILE_MISSING']);
    app.openEditor('logging');
    const el = await mountView(app);
    const empty = norm(el.querySelector('.lv-empty')?.textContent);
    expect(empty).toContain('Không đọc được logging.json');
    expect(empty).toContain('E_FILE_MISSING');
    expect(el.querySelector('table')).toBeNull();
  });
});
