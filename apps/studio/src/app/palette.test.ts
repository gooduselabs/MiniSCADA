// Bảng lệnh (feature 004, T009, FR-009, spec US1 #5): tìm bỏ dấu, không phân biệt hoa thường; khớp
// đầu nhãn xếp trước; lệnh bị khóa vẫn có, kèm lý do.
import { describe, expect, it } from 'vitest';
import { COMMANDS, EMPTY_CONTEXT, type CommandContext } from './commands.ts';
import { matchRank, paletteEntries, searchPalette } from './palette.ts';

const project: CommandContext = { ...EMPTY_CONTEXT, hasProject: true };
const SCREENS = [{ id: 'tank-motor', name: 'Bồn nước + bơm' }];
const search = (q: string, c: CommandContext = project) =>
  searchPalette(paletteEntries(c, SCREENS), q);
const labels = (q: string, c?: CommandContext) => search(q, c).map((e) => e.label);

describe('tìm lệnh', () => {
  it('"bang tag" (không dấu) → Mở Bảng Tag mặc định', () => {
    const [first] = search('bang tag');
    expect(first.label).toBe('Mở Bảng Tag mặc định');
    expect(first.id).toBe('open.tags');
    expect(first.enabled).toBe(true);
  });

  it('"nap xuong" → Nạp xuống…, bị khóa kèm lý do', () => {
    const [first] = search('nap xuong');
    expect(first.label).toBe('Nạp xuống…');
    expect(first.enabled).toBe('reason.notOnline');
    expect(first.reason).toBe('Cần Online và đăng nhập thiết bị');
    expect(first.shortcut).toBe('Ctrl+L');
  });

  it('không phân biệt hoa thường, gõ có dấu cũng khớp', () => {
    expect(labels('LUU')[0]).toBe('Lưu');
    expect(labels('Lưu')[0]).toBe('Lưu');
    expect(labels('  luu  ')[0]).toBe('Lưu');
  });

  it('khớp đầu nhãn xếp trước khớp giữa nhãn', () => {
    expect(labels('ket noi')).toEqual(['Kết nối theo dõi', 'Mở Kết nối', 'Ngắt kết nối']);
    const luu = labels('luu');
    expect(luu[0]).toBe('Lưu');
    expect(luu).toContain('Mở Lưu trữ');
    expect(matchRank('Lưu', 'luu')).toBeLessThan(matchRank('Mở Lưu trữ', 'luu'));
  });

  it('nhiều từ không liền nhau vẫn khớp; không khớp thì rỗng', () => {
    expect(labels('mo mac dinh')).toEqual(['Mở Bảng Tag mặc định']);
    expect(labels('xyz')).toEqual([]);
    expect(matchRank('Lưu', 'xyz')).toBe(-1);
  });

  it('lệnh bị khóa vẫn có trong danh sách, kèm lý do; lệnh bật xếp trước lệnh khóa cùng mức khớp', () => {
    const r = search('luu', EMPTY_CONTEXT);
    const save = r.find((e) => e.id === 'project.save');
    expect(save?.enabled).toBe('reason.noProject');
    expect(save?.reason).toBe('Chưa mở project');
    // Cùng mức khớp (nhãn bắt đầu bằng "Mở"); "Project mới…" khớp ở đầu từ thứ hai nên xếp sau cả nhóm này.
    const mo = search('mo', EMPTY_CONTEXT).filter((e) => matchRank(e.label, 'mo') === 0);
    const firstDisabled = mo.findIndex((e) => e.enabled !== true);
    expect(firstDisabled).toBeGreaterThan(0);
    expect(mo.slice(firstDisabled).every((e) => e.enabled !== true)).toBe(true);
    expect(mo.slice(0, firstDisabled).map((e) => e.id)).toEqual([
      'project.open',
      'project.openRecent',
      'open.start',
    ]);
  });

  it('gõ trống: mọi lệnh theo thứ tự danh mục, rồi màn hình', () => {
    const all = search('');
    expect(all).toHaveLength(COMMANDS.length + SCREENS.length);
    expect(all.slice(0, COMMANDS.length).map((e) => e.id)).toEqual(COMMANDS.map((c) => c.id));
  });

  it('lệnh mở từng màn hình theo tên', () => {
    const [first] = search('bon nuoc');
    expect(first).toMatchObject({
      id: 'open.screen:tank-motor',
      label: 'Mở màn hình Bồn nước + bơm',
      enabled: true,
    });
    expect(search('bon nuoc', EMPTY_CONTEXT)[0].enabled).toBe('reason.noProject');
  });

  it('lệnh hiện phím tắt', () => {
    expect(search('lam lai')[0]).toMatchObject({ label: 'Làm lại', shortcut: 'Ctrl+Y' });
    expect(search('bang lenh')[0]).toMatchObject({ label: 'Bảng lệnh', shortcut: 'Ctrl+Shift+P' });
  });
});

describe('editor của feature 006 mở được từ bảng lệnh (FR-053)', () => {
  const entries = paletteEntries(project, SCREENS, {
    valueTables: ['TrangThaiBom'],
    watchTables: [{ id: 'van-hanh', name: 'Vận hành' }],
  });
  const byId = (id: string) => entries.find((e) => e.id === id);

  it('Kết nối, Tag tính toán, Chẩn đoán driver', () => {
    expect(byId('open.connections')?.label).toBe('Mở Kết nối');
    expect(byId('open.calc')?.label).toBe('Mở Tag tính toán');
    expect(byId('open.driverDiag')?.label).toBe('Mở Chẩn đoán driver');
  });

  it('từng Bảng giá trị và Bảng theo dõi theo tên', () => {
    expect(byId('open.vt:TrangThaiBom')?.label).toBe('Mở Bảng giá trị TrangThaiBom');
    expect(byId('open.watch:van-hanh')?.label).toBe('Mở Bảng theo dõi Vận hành');
    expect(byId('open.watch:van-hanh')?.enabled).toBe(true);
  });

  it('không có project thì khóa kèm lý do', () => {
    const e = paletteEntries(EMPTY_CONTEXT, [], { valueTables: ['A'], watchTables: [] });
    expect(e.find((x) => x.id === 'open.vt:A')?.enabled).toBe('reason.noProject');
    expect(e.find((x) => x.id === 'open.connections')?.enabled).toBe('reason.noProject');
  });
});
