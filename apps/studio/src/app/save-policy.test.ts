// Khi nào Studio cho lưu và cho đóng gói, nạp xuống (feature 004, T058, FR-023; thay quy tắc FR-024
// của specs/003-data-logging và FR-033 của Sprint 1): lưu luôn được để giữ việc làm dở, kể cả khi còn
// lỗi; đóng gói và nạp xuống bị khóa khi còn lỗi vì thiết bị sẽ từ chối project (Constitution V).
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';
import { canPackage, checkSummary, errorCount, saveNotice } from './save-policy.ts';

const issue = (code: string) => ({ code });
const E = issue('E_TAG_RANGE');
const E2 = issue('E_MAX_CLIENTS');
const W = issue('W_LOG_WRITE_BUDGET');
const WUID = issue('W_UID_NOT_IN_SVG');

describe('lưu khi còn lỗi (FR-023)', () => {
  it('Studio vẫn ghi file, báo "còn N lỗi: thiết bị sẽ từ chối project này", khóa nạp xuống', async () => {
    const platform = createMockPlatform();
    const app = new StudioApp({ platform, storage: null, windowWidth: 1400 });
    await app.start();
    await app.run('project.open');
    await app.store.idle();
    app.store.edit([{ kind: 'tagField', index: 0, field: 'max', value: -1 }]);
    await app.store.validateNow();
    expect(errorCount(app.store.state.issues)).toBe(1);
    expect(app.enabled('project.save')).toBe(true);
    await app.run('project.save');
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['tags.json']);
    expect(app.store.dirtyFiles()).toEqual([]);
    expect(app.ui.toast?.text).toBe(saveNotice(['tags.json'], app.store.state.issues));
    expect(app.ui.toast?.text).toContain('Còn 1 lỗi: thiết bị sẽ từ chối project này.');
    expect(app.enabled('online.download')).toBe('reason.projectErrors');
  });
});

describe('canPackage', () => {
  it('còn lỗi thì khóa đóng gói, nạp xuống; lý do "Project còn lỗi"', () => {
    const r = canPackage([W, E]);
    expect(r).toBe('reason.projectErrors');
    expect(t(r as 'reason.projectErrors')).toBe('Project còn lỗi');
  });

  it('không lỗi (chỉ còn cảnh báo hoặc hợp lệ) thì không chặn', () => {
    expect(canPackage([])).toBe(true);
    expect(canPackage([W, WUID])).toBe(true);
  });
});

describe('errorCount', () => {
  it('đếm mã lỗi E_, không đếm cảnh báo W_', () => {
    expect(errorCount([E, W, E2, WUID])).toBe(2);
    expect(errorCount([])).toBe(0);
  });
});

describe('checkSummary', () => {
  it('còn lỗi: "còn N lỗi: thiết bị sẽ từ chối project này"', () => {
    expect(checkSummary([E])).toBe('Còn 1 lỗi: thiết bị sẽ từ chối project này.');
    expect(checkSummary([E, E2, W])).toBe('Còn 2 lỗi: thiết bị sẽ từ chối project này.');
  });

  it('không lỗi: nói rõ thiết bị nhận project, cảnh báo (kể cả UID) không chặn', () => {
    expect(checkSummary([])).toBe('Không có lỗi: thiết bị sẽ nhận project này.');
    expect(checkSummary([W, WUID])).toBe(
      'Không có lỗi, còn 2 cảnh báo: thiết bị vẫn nhận project này.',
    );
  });
});

describe('saveNotice (thông báo sau khi lưu)', () => {
  it('liệt kê file đã ghi; còn lỗi thì kèm đúng câu tóm tắt', () => {
    expect(saveNotice(['tags.json', 'project.json'], [W])).toBe('Đã lưu tags.json, project.json.');
    const withErrors = saveNotice(['tags.json'], [E, W]);
    expect(withErrors).toBe('Đã lưu tags.json. Còn 1 lỗi: thiết bị sẽ từ chối project này.');
    expect(withErrors).toContain(checkSummary([E, W]));
  });
});
