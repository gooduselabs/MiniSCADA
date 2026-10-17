// Trợ giúp theo ngữ cảnh (feature 011, T178; FR-133): Trợ giúp › Hướng dẫn sử dụng (F1) mở tài liệu HTML đi kèm bộ cài
// (docs-html/, dựng bởi tools/build-docs.mjs) đúng mục của editor đang mở. Bảng mục ở help-topics.json (Rust và
// tools/build-docs.test.mjs đọc cùng tệp); neo là `<a id="help-…">` cố định trong docs/user/engineer-guide.md.
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';
import { HELP_TOPICS, helpTarget } from './help.ts';
import { resolveShortcut } from './shortcuts.ts';

describe('helpTarget', () => {
  it.each([
    ['start', 'help-studio'],
    ['settings', 'help-project'],
    ['connections', 'help-modbus'],
    ['tags', 'help-tags'],
    ['calc', 'help-tags'],
    ['vt:Trạng thái', 'help-tags'],
    ['screen:tong-quan', 'help-screens'],
    ['navigation', 'help-screens'],
    ['templates', 'help-templates'],
    ['template:bom', 'help-templates'],
    ['logic', 'help-logic'],
    ['svgdraw:graphics/a.svg', 'help-svg-editor'],
    ['svgnew', 'help-svg-editor'],
    ['device', 'help-online'],
    ['compare', 'help-online'],
    ['watch:Bảng 1', 'help-diagnostics'],
    ['driverDiag', 'help-diagnostics'],
    ['alarms', 'help-alarm'],
    ['report:ca', 'help-alarm'],
  ] as const)('%s → engineer-guide#%s', (editor, anchor) => {
    expect(helpTarget(editor)).toEqual({ page: 'user/engineer-guide.html', anchor });
  });

  it('editor lạ: về mục Giao diện Studio', () => {
    expect(helpTarget('phase:p7' as never)).toEqual({
      page: 'user/engineer-guide.html',
      anchor: 'help-studio',
    });
  });

  it('mọi trang và neo chỉ gồm chữ thường, số, gạch (Rust kiểm lại cùng quy tắc)', () => {
    for (const x of HELP_TOPICS) {
      expect(x.page).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+\.html$/);
      expect(x.anchor).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('lệnh help.docs', () => {
  it('F1 là Hướng dẫn sử dụng', () => {
    const e = { key: 'F1', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(resolveShortcut(e, { inTextField: false, modal: false })).toEqual({
      command: 'help.docs',
    });
  });

  it('mở mục của editor đang mở qua platform.openHelp; lỗi thì báo', async () => {
    const platform = createMockPlatform();
    const app = new StudioApp({ platform, storage: null, windowWidth: 1400 });
    await app.start();
    const open = vi.spyOn(platform, 'openHelp');
    await app.run('help.docs');
    expect(open).toHaveBeenCalledWith('user/engineer-guide.html', 'help-studio');
    open.mockRejectedValueOnce(new Error('not-found'));
    await app.run('help.docs');
    expect(app.ui.toast?.text).toContain('not-found');
  });
});
