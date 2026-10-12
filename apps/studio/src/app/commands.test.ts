// Danh mục lệnh (feature 004, T009, contracts/commands.md, FR-009, FR-010, FR-031): đúng id, nhãn,
// phím tắt, menu của contract; điều kiện bật và lý do khi bị khóa.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import {
  COMMANDS,
  EMPTY_CONTEXT,
  MENUS,
  MENU_LABEL,
  MENU_ORDER,
  commandById,
  reasonOf,
  type CommandContext,
  type MenuId,
} from './commands.ts';

const CONTRACT = resolve(__dirname, '../../../../specs/004-studio-shell/contracts/commands.md');

/** Các dòng lệnh của contract: id, nhãn, phím, menu (theo mục ## và tiền tố id). */
function contractRows() {
  const rows: Array<{ id: string; label: string; shortcut: string; menu: MenuId }> = [];
  let section = '';
  for (const line of readFileSync(CONTRACT, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const m = /^\|\s*`([a-zA-Z]+\.[a-zA-Z]+)`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!m) continue;
    const id = m[1];
    const menu: MenuId =
      section === 'Project'
        ? 'project'
        : section === 'Sửa'
          ? 'edit'
          : section === 'Xem'
            ? 'view'
            : section === 'Online'
              ? 'online'
              : id.startsWith('tools.')
                ? 'tools'
                : 'help';
    // "Mở gần đây › (danh sách)", "Thiết bị… (địa chỉ, kiểm kết nối)": phần sau là mô tả
    const label = m[2]
      .trim()
      .replace(/\s*›.*$/, '')
      .replace(/…\s*\(.*\)$/, '…');
    rows.push({ id, label, shortcut: m[3].trim(), menu });
  }
  return rows;
}

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  ...EMPTY_CONTEXT,
  hasProject: true,
  ...over,
});
const enabled = (id: string, c: CommandContext) => commandById(id)!.enabled(c);

describe('danh mục lệnh theo contracts/commands.md', () => {
  const rows = contractRows();

  it('contract có đủ các mục (kiểm bộ đọc contract)', () => {
    // 33 lệnh của 004, cộng Đăng nhập…, Đăng xuất (T083) và Khôi phục bản trước… (T124) của feature 005.
    expect(rows.length).toBe(36);
    expect(rows.find((r) => r.id === 'online.download')).toEqual({
      id: 'online.download',
      label: 'Nạp xuống…',
      shortcut: 'Ctrl+L',
      menu: 'online',
    });
  });

  it('mọi lệnh trong contract có mặt, đúng nhãn, phím tắt và menu', () => {
    for (const r of rows) {
      const c = commandById(r.id);
      expect(c, r.id).toBeDefined();
      expect(t(c!.label), r.id).toBe(r.label);
      expect(c!.shortcut ?? '', r.id).toBe(r.shortcut);
      expect(c!.menu, r.id).toBe(r.menu);
    }
  });

  it('id không trùng; lệnh ngoài contract chỉ là lệnh mở editor của bảng lệnh (không có menu)', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const extra = COMMANDS.filter((c) => !rows.some((r) => r.id === c.id));
    expect(extra.map((c) => c.id)).toEqual(['open.start', 'open.tags', 'open.logging']);
    expect(extra.every((c) => c.menu === null)).toBe(true);
    expect(t(commandById('open.tags')!.label)).toBe('Mở Bảng Tag mặc định');
  });

  it('phím tắt FR-010: Ctrl+K/Ctrl+M như TIA Portal, Ctrl+L để dành cho Nạp xuống', () => {
    const byKey = Object.fromEntries(
      COMMANDS.filter((c) => c.shortcut).map((c) => [c.shortcut, c.id]),
    );
    expect(byKey).toMatchObject({
      'Ctrl+S': 'project.save',
      'Ctrl+Z': 'edit.undo',
      'Ctrl+Y': 'edit.redo',
      'Ctrl+F': 'edit.find',
      'Ctrl+Shift+P': 'view.palette',
      'Ctrl+D': 'edit.fillDown',
      F7: 'tools.validate',
      'Ctrl+K': 'online.connect',
      'Ctrl+M': 'online.disconnect',
      'Ctrl+L': 'online.download',
    });
  });

  it('menu: thứ tự, nhãn; mỗi menu đúng các lệnh của nó theo thứ tự contract', () => {
    expect(MENU_ORDER.map((m) => t(MENU_LABEL[m]))).toEqual([
      'Project',
      'Sửa',
      'Xem',
      'Online',
      'Công cụ',
      'Trợ giúp',
    ]);
    for (const m of MENU_ORDER) {
      const items = MENUS[m];
      expect(
        items.filter((x) => x !== '-'),
        m,
      ).toEqual(rows.filter((r) => r.menu === m).map((r) => r.id));
      // vạch ngăn không đứng đầu, cuối hay liền nhau
      expect(items[0], m).not.toBe('-');
      expect(items[items.length - 1], m).not.toBe('-');
      expect(
        items.some((x, i) => x === '-' && items[i + 1] === '-'),
        m,
      ).toBe(false);
    }
  });
});

describe('điều kiện bật và lý do', () => {
  it('chưa mở project: lệnh cần project bị khóa và nói lý do', () => {
    const c = EMPTY_CONTEXT;
    for (const id of [
      'project.open',
      'project.openRecent',
      'online.device',
      'help.about',
      'help.roadmap',
      'help.shortcuts',
      'view.palette',
      'view.themeDark',
      'view.resetLayout',
      'view.nextRegion',
      'open.start',
    ])
      expect(enabled(id, c), id).toBe(true);
    for (const id of [
      'project.save',
      'project.settings',
      'project.close',
      'edit.find',
      'tools.validate',
      'online.connect',
      'open.tags',
      'open.logging',
    ])
      expect(enabled(id, c), id).toBe('reason.noProject');
    expect(reasonOf(commandById('project.save')!, c)).toBe('Chưa mở project');
    expect(reasonOf(commandById('project.open')!, c)).toBeNull();
  });

  it('Lưu: cần thay đổi chưa lưu (lưu được cả khi còn lỗi, FR-023)', () => {
    expect(enabled('project.save', ctx())).toBe('reason.noChanges');
    expect(enabled('project.save', ctx({ dirty: true, errorCount: 3 }))).toBe(true);
  });

  it('Hoàn tác, Làm lại theo lịch sử', () => {
    expect(enabled('edit.undo', ctx())).toBe('reason.noUndo');
    expect(enabled('edit.redo', ctx())).toBe('reason.noRedo');
    expect(enabled('edit.undo', ctx({ canUndo: true }))).toBe(true);
    expect(enabled('edit.redo', ctx({ canRedo: true }))).toBe(true);
  });

  it('Điền xuống: lưới Tag đang focus và ô không ở dòng đầu', () => {
    expect(enabled('edit.fillDown', ctx({ activeEditor: 'tags' }))).toBe('reason.gridNotFocused');
    expect(enabled('edit.fillDown', ctx({ activeEditor: 'tags', tagGridFocused: true }))).toBe(
      'reason.gridNotFocused',
    );
    expect(enabled('edit.fillDown', ctx({ tagGridFocused: true, cellRow: 0 }))).toBe(
      'reason.firstRow',
    );
    expect(enabled('edit.fillDown', ctx({ tagGridFocused: true, cellRow: 2 }))).toBe(true);
  });

  it('Thêm Tag, Xóa dòng: Bảng Tag đang mở; xóa cần dòng chọn', () => {
    expect(enabled('tags.add', ctx())).toBe('reason.tagsNotActive');
    expect(enabled('tags.add', ctx({ activeEditor: 'tags' }))).toBe(true);
    expect(enabled('tags.delete', ctx({ activeEditor: 'settings', cellRow: 1 }))).toBe(
      'reason.tagsNotActive',
    );
    expect(enabled('tags.delete', ctx({ activeEditor: 'tags' }))).toBe('reason.noRow');
    expect(enabled('tags.delete', ctx({ activeEditor: 'tags', cellRow: 1 }))).toBe(true);
  });

  it('Kết nối theo dõi: project, chưa theo dõi (chưa nhập địa chỉ thì lệnh mở trang Thiết bị)', () => {
    expect(enabled('online.connect', ctx())).toBe(true);
    expect(enabled('online.connect', ctx({ deviceAddressSet: true }))).toBe(true);
    expect(enabled('online.connect', ctx({ monitoring: true }))).toBe('reason.monitoring');
    expect(enabled('online.disconnect', ctx())).toBe('reason.notMonitoring');
    expect(enabled('online.disconnect', ctx({ monitoring: true }))).toBe(true);
  });

  it('Mở web thiết bị: đã nhập địa chỉ (không cần project)', () => {
    expect(enabled('online.openWeb', EMPTY_CONTEXT)).toBe('reason.noAddress');
    expect(enabled('online.openWeb', { ...EMPTY_CONTEXT, deviceAddressSet: true })).toBe(true);
  });

  it('Đọc lên, So sánh (US3 của feature 005) và GĐ 2 luôn khóa với lý do', () => {
    const all = ctx({ dirty: true, canUndo: true, monitoring: true, deviceAddressSet: true });
    for (const id of ['online.upload', 'online.compare'])
      expect(enabled(id, all), id).toBe('reason.f005');
    expect(enabled('tools.simulate', all)).toBe('reason.p2');
    expect(t('reason.f005')).toBe('Có ở feature 005');
    expect(t('reason.p2')).toBe('Có ở GĐ 2');
    expect(t('reason.projectErrors')).toBe('Project còn lỗi');
  });

  it('Nạp xuống (US2): cần project, không còn lỗi, đang Online và đã đăng nhập; Khôi phục: chỉ cần Online và đăng nhập', () => {
    const online = ctx({ onlineAuth: true });
    expect(enabled('online.download', EMPTY_CONTEXT)).toBe('reason.noProject');
    expect(enabled('online.download', ctx())).toBe('reason.notOnline');
    expect(enabled('online.download', { ...online, errorCount: 2 })).toBe('reason.projectErrors');
    expect(enabled('online.download', online)).toBe(true);
    // Ctrl+L không còn khóa vì "feature 005", nhưng chưa có thiết bị thì vẫn có lý do.
    expect(enabled('online.restore', ctx())).toBe('reason.notOnline');
    expect(enabled('online.restore', { ...EMPTY_CONTEXT, onlineAuth: true })).toBe(true);
    expect(t('reason.notOnline')).toBe('Cần Online và đăng nhập thiết bị');
  });

  it('feature 005 (US1): Thiết bị trong mạng luôn bật; Đăng nhập khi chưa đăng nhập hoặc phiên hết hạn; Đăng xuất khi đã đăng nhập', () => {
    expect(enabled('online.devices', EMPTY_CONTEXT)).toBe(true);
    expect(enabled('online.login', EMPTY_CONTEXT)).toBe(true);
    expect(enabled('online.logout', EMPTY_CONTEXT)).toBe('reason.notLoggedIn');
    const online = ctx({ monitoring: true, onlineAuth: true });
    expect(enabled('online.login', online)).toBe('reason.loggedIn');
    expect(enabled('online.logout', online)).toBe(true);
    const expired = ctx({ monitoring: true, relogin: true });
    expect(enabled('online.login', expired)).toBe(true);
    expect(enabled('online.logout', expired)).toBe(true);
    expect(t('reason.loggedIn')).toBe('Đã đăng nhập thiết bị');
    expect(t('reason.notLoggedIn')).toBe('Chưa đăng nhập thiết bị');
  });
});
