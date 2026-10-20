// Danh mục lệnh (feature 004, T009, contracts/commands.md, FR-009, FR-010, FR-031): đúng id, nhãn,
// phím tắt, menu của contract; điều kiện bật và lý do khi bị khóa.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SVG_COMMANDS } from '../model/svg/keys.ts';
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
    // 33 lệnh của 004, cộng Đăng nhập…, Đăng xuất (T083) Khôi phục bản trước… (T124) và Audit của thiết bị (T149) của feature 005, cộng 10 lệnh của feature 006 (T084, T152, T189), cộng Hướng dẫn sử dụng (feature 011, T178), cộng Project mới… (2026-10-20).
    expect(rows.length).toBe(50);
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

  it('id không trùng; lệnh ngoài contract chỉ là lệnh của bảng lệnh (mở editor, màn hình 0.3), không có menu', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const extra = COMMANDS.filter((c) => !rows.some((r) => r.id === c.id));
    expect(extra.map((c) => c.id)).toEqual([
      // feature 009: alarm (lưới, lớp, khu vực, Tạo alarm cho Tag, Thử alarm, nâng cấp 0.5)
      'alarm.open',
      'alarm.classes.open',
      'alarm.areas.focus',
      'alarm.new',
      'alarm.quickCreate',
      'alarm.fillDown',
      'alarm.import',
      'alarm.export',
      'alarm.filter.errors',
      'alarm.deleteRows',
      'alarm.test.open',
      // feature 011 (T144): F8 / Shift+F8 tới lỗi kế / trước của editor Logic
      'logic.nextIssue',
      'logic.prevIssue',
      'alarm.test.run',
      'alarm.test.step',
      'alarm.test.reset',
      'alarm.test.speed1',
      'alarm.test.speed5',
      'alarm.test.speed20',
      'alarm.upgrade',
      'alarm.classes.add',
      'alarm.areas.add',
      'open.start',
      'open.tags',
      'open.logging',
      'open.connections',
      'open.calc',
      'open.driverDiag',
      // feature 007: màn hình 0.3 (không có menu)
      'screen.add',
      // feature 015: thư viện mẫu báo cáo (bảng lệnh và menu chuột phải của cây)
      'report.add',
      'screen.addFree',
      'screen.addPopup',
      'screen.setEntry',
      'screen.props',
      'open.navigation',
      'screen.selectAll',
      'screen.copy',
      'screen.paste',
      'screen.duplicate',
      'screen.delete',
      'screen.alignLeft',
      'screen.alignCenter',
      'screen.alignRight',
      'screen.alignTop',
      'screen.alignMiddle',
      'screen.alignBottom',
      'screen.distributeH',
      'screen.distributeV',
      'screen.sameWidth',
      'screen.sameHeight',
      'screen.toFront',
      'screen.toBack',
      'screen.forward',
      'screen.backward',
      'screen.lock',
      'screen.hide',
      'screen.toggleGrid',
      'screen.toggleSnap',
      'screen.zoomIn',
      'screen.zoomOut',
      'screen.zoomFit',
      'screen.zoom100',
      'screen.previewOff',
      'screen.previewSim',
      'screen.previewDevice',
      'screen.toolSelect',
      'screen.toolHand',
      // feature 008, T102: nhập lại SVG (không phím tắt, menu chuột phải của item)
      'import.reimport',
      // feature 011: template và faceplate (menu ngữ cảnh của vùng chọn, thanh công cụ editor Màn hình)
      'screen.createTemplate',
      'screen.explodeInstance',
      'screen.updateInstances',
      'screen.faceplate',
      // feature 012 (FR-040): chuyển màn hình tự do sang lưới
      'screen.convertToGrid',
      // feature 011: trình vẽ SVG (bảng lệnh, thanh công cụ và phím của trình vẽ, menu ngữ cảnh item svg)
      'svg.new',
      'svg.editInDrawing',
      ...SVG_COMMANDS,
    ]);
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

  it('Đọc lên (engineer trở lên) và So sánh (US3 của feature 005): điều kiện bật và lý do; Mô phỏng cần project', () => {
    const all = ctx({ dirty: true, canUndo: true, monitoring: true, deviceAddressSet: true });
    expect(enabled('online.upload', all)).toBe('reason.notOnline');
    expect(enabled('online.upload', ctx({ onlineAuth: true }))).toBe('reason.needEngineer');
    expect(enabled('online.upload', ctx({ onlineAuth: true, onlineEngineer: true }))).toBe(true);
    // Đọc lên thành project mới không cần mở project.
    expect(
      enabled('online.upload', { ...EMPTY_CONTEXT, onlineAuth: true, onlineEngineer: true }),
    ).toBe(true);
    expect(enabled('online.compare', { ...EMPTY_CONTEXT, onlineAuth: true })).toBe(
      'reason.noProject',
    );
    expect(enabled('online.compare', all)).toBe('reason.notOnline');
    expect(enabled('online.compare', ctx({ onlineAuth: true }))).toBe(true);
    // Audit (US4): cần Online và đăng nhập; không cần project, không cần role (tài khoản khác thấy "không đủ quyền").
    expect(enabled('online.audit', all)).toBe('reason.notOnline');
    expect(enabled('online.audit', { ...EMPTY_CONTEXT, onlineAuth: true })).toBe(true);
    // Mô phỏng (feature 006, FR-052): cần project; không còn khóa GĐ 2.
    expect(enabled('tools.simulate', all)).toBe(true);
    expect(enabled('tools.simulate', EMPTY_CONTEXT)).toBe('reason.noProject');
    expect(t('reason.needEngineer')).toBe('Cần tài khoản engineer trở lên');
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

  it('feature 006 (T084): lệnh trên cây cần project 0.2 không chỉ đọc và nút có đối tượng', () => {
    const base = ctx({ version02: true, treeKind: 'channel' });
    for (const id of ['tree.rename', 'tree.duplicate', 'tree.remove']) {
      expect(enabled(id, base), id).toBe(true);
      expect(enabled(id, { ...base, treeKind: 'connections' }), id).toBe('reason.noTreeTarget');
      expect(enabled(id, { ...base, readOnly: true }), id).toBe('reason.readOnly');
    }
    expect(enabled('tree.add', { ...base, treeKind: 'connections' })).toBe(true);
    expect(enabled('tree.add', { ...base, treeKind: null })).toBe('reason.noTreeTarget');
    expect(enabled('tree.add', { ...base, version02: false })).toBe('reason.needVersion02');
    expect(enabled('tree.add', EMPTY_CONTEXT)).toBe('reason.noProject');
    expect(commandById('tree.add')!.shortcut).toBe('Insert');
    expect(commandById('tree.rename')!.shortcut).toBe('F2');
    expect(commandById('tree.duplicate')!.shortcut).toBe('Ctrl+Shift+D');
    expect(commandById('tree.remove')!.shortcut).toBe('Delete');
  });

  it('feature 006 (T126): Thêm hàng loạt, Nhập CSV, Xuất CSV cần Bảng Tag 0.2 đang mở', () => {
    const open = ctx({ version02: true, activeEditor: 'tags' });
    for (const id of ['tags.bulkAdd', 'tags.importCsv', 'tags.exportCsv']) {
      expect(enabled(id, open), id).toBe(true);
      expect(enabled(id, { ...open, activeEditor: 'start' }), id).toBe('reason.tagsNotActive');
      expect(enabled(id, { ...open, version02: false }), id).toBe('reason.needVersion02');
    }
    expect(enabled('tags.bulkAdd', { ...open, readOnly: true })).toBe('reason.readOnly');
    expect(enabled('tags.importCsv', { ...open, readOnly: true })).toBe('reason.readOnly');
    expect(enabled('tags.exportCsv', { ...open, readOnly: true })).toBe(true);
  });

  it('feature 006 (T152): lệnh Ghi cần Bảng theo dõi mở, Online có đăng nhập, tài khoản từ operator', () => {
    const ok = ctx({ activeEditor: 'watch:van-hanh', onlineAuth: true, onlineOperator: true });
    for (const id of ['watch.write', 'watch.writeAll']) {
      expect(enabled(id, ok), id).toBe(true);
      expect(enabled(id, { ...ok, activeEditor: 'tags' }), id).toBe('reason.watchNotActive');
      expect(enabled(id, { ...ok, onlineAuth: false, onlineOperator: false }), id).toBe(
        'reason.notOnline',
      );
      expect(enabled(id, { ...ok, onlineOperator: false }), id).toBe('reason.needOperator');
    }
    expect(commandById('watch.write')!.shortcut).toBe('Ctrl+Shift+Enter');
    expect(t('reason.needOperator')).toContain('operator');
  });

  it('feature 012 (FR-040): Chuyển sang bố cục lưới cần editor Màn hình, project 1.1, màn hình tự do', () => {
    const open = ctx({ version03: true, screenEditor: true, format11: true });
    expect(enabled('screen.convertToGrid', open)).toBe(true);
    expect(enabled('screen.convertToGrid', { ...open, screenIsGrid: true })).toBe(
      'reason.alreadyGrid',
    );
    expect(enabled('screen.convertToGrid', { ...open, format11: false })).toBe(
      'reason.needFormat11',
    );
    expect(enabled('screen.convertToGrid', { ...open, screenEditor: false })).toBe(
      'reason.screenNotActive',
    );
    expect(enabled('screen.convertToGrid', { ...open, readOnly: true })).toBe('reason.readOnly');
    expect(enabled('screen.convertToGrid', { ...open, screenPreview: 'sim' })).toBe(
      'reason.screenPreviewLocked',
    );
    expect(commandById('screen.convertToGrid')!.menu).toBeNull();
  });
});
