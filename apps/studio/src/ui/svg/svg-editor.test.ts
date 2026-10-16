// Giao diện trình vẽ SVG (feature 011, T157 phần giao diện; FR-097, FR-099, FR-101, FR-105 đến FR-108, FR-110, FR-112, FR-113,
// FR-115): cây "Đồ họa SVG", mở tab, DOM thật trong Shadow DOM, vẽ bằng chuột, phím của canvas, panel Lớp (khóa/ẩn vào
// .mat-editor/svg-state.json, không đổi SVG), inspector nhập số, ô chữ textarea, xóa phần tử có binding (cảnh báo, hoàn tác khôi
// phục binding), lưu (tệp SVG và tài liệu store), "Mới: SVG trống", tệp đổi bên ngoài, khôi phục bản tự lưu, "Sửa trong trình vẽ".
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findByUid } from '@mat/svg-edit';
import type { StudioApp } from '../../app/app.ts';
import { findNode } from '../../model/tree.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, newApp02, settled } from '../test-helpers.ts';
import '../editors/index.ts';
import './svg-dialogs.ts';
import type { MatSvgEditor } from './svg-editor.ts';
import type { MatSvgCanvas } from './canvas.ts';

afterEach(cleanup);

const REL = 'graphics/tram-bom.svg';

function svgDemo(extra: Record<string, string> = {}) {
  const f = readProjectDir(resolve(REPO, 'projects/svg-demo'));
  return { ...f, ...extra };
}

async function open(extra: Record<string, string> = {}) {
  const env = await newApp02({ files: svgDemo(extra) });
  await env.app.svg.projectOpened();
  return env;
}

/** Mở tab trình vẽ của tệp và chờ canvas dựng xong. */
async function editorFor(
  app: StudioApp,
  rel = REL,
): Promise<{ el: MatSvgEditor; cv: MatSvgCanvas }> {
  app.openEditor(`svgdraw:${rel}` as `svgdraw:${string}`);
  const el = document.createElement('mat-svg-editor');
  el.app = app;
  el.rel = rel;
  document.body.append(el);
  await app.svg.ensure(rel);
  await settled();
  el.requestUpdate();
  await settled();
  const cv = el.querySelector('mat-svg-canvas')!;
  return { el, cv };
}

const docEl = (cv: MatSvgCanvas) => cv.shadowRoot!.querySelector('svg.doc')!;
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: k,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    }),
  );
const ptr = (target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) =>
  target.dispatchEvent(
    new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    }),
  );

describe('cây và tab (FR-097)', () => {
  it('mục "Đồ họa SVG" liệt kê tệp SVG của project và "Mới: SVG trống…"; nhấp tệp mở tab trình vẽ', async () => {
    const { app } = await open();
    const node = findNode(app.tree(), 'graphics');
    expect(node?.label).toBe('Đồ họa SVG');
    const ids = node!.children!.map((c) => c.id);
    expect(ids).toContain(`svgfile:${REL}`);
    expect(ids).toContain('svgfile:graphics/symbols/pump-centrifugal.svg');
    expect(ids.at(-1)).toBe('svgnew');
    app.selectNode(`svgfile:${REL}`);
    expect(app.store.state.active).toBe(`svgdraw:${REL}`);
    expect(app.editorTitle(`svgdraw:${REL}`)).toBe('tram-bom.svg');
  });

  it('DOM thật của tài liệu nằm trong Shadow DOM của canvas, không innerHTML; Toolbox dọc có 8 công cụ; 5 tab thuộc tính', async () => {
    const { app } = await open();
    const { el, cv } = await editorFor(app);
    const s = app.svg.session(REL)!;
    const svg = docEl(cv);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('*').length + 1).toBe(s.doc.elementCount);
    expect(svg.querySelector('#pumpBody')?.getAttribute('data-mat-uid')).toBe('el_zoha6du7vr');
    expect(document.querySelector('#pumpBody')).toBeNull(); // không lọt ra document của Studio
    const tools = el.querySelectorAll('.sv-toolbox [data-tool]');
    expect(tools.length).toBe(8);
    expect(el.querySelector('.sv-toolbox [data-tool="select"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      [...el.querySelectorAll('.sv-insp [role="tab"]')].map((x) => x.textContent?.trim()),
    ).toEqual(['Chung', 'Hình học', 'Hiển thị', 'Văn bản', 'Gắn Tag']);
    expect(cv.getAttribute('role')).toBe('application');
  });
});

describe('vẽ, chọn, phím (FR-099, FR-101, FR-115)', () => {
  it('phím R chọn công cụ; kéo trên canvas tạo rect (một bước hoàn tác), DOM cập nhật cục bộ; Ctrl+Z (Hoàn tác) bỏ', async () => {
    const { app } = await open();
    const { el, cv } = await editorFor(app);
    const s = app.svg.session(REL)!;
    const before = s.doc.elementCount;
    key(cv, 'r');
    await settled();
    expect(el.querySelector('[data-tool="rect"]')?.getAttribute('aria-pressed')).toBe('true');
    const target = docEl(cv);
    ptr(target, 'pointerdown', 100, 100);
    ptr(target, 'pointermove', 150, 120);
    ptr(target, 'pointermove', 200, 150);
    ptr(target, 'pointerup', 200, 150);
    await settled();
    expect(s.doc.elementCount).toBe(before + 1);
    expect(docEl(cv).querySelectorAll('rect').length).toBe(
      [...s.doc.nodes.values()].filter((n) => n.tag === 'rect').length,
    );
    expect(app.editorDirty(`svgdraw:${REL}`)).toBe(true);
    expect(app.dirtyFiles()).toContain(REL);
    await app.run('edit.undo');
    await settled();
    expect(s.doc.elementCount).toBe(before);
  });

  it('Tab chọn phần tử kế, mũi tên dịch 1 (Shift 10) và DOM đổi theo, Esc bỏ chọn; trạng thái đọc được (aria-live)', async () => {
    const { app } = await open();
    const { el, cv } = await editorFor(app);
    const ed = app.svg.editor(REL)!;
    key(cv, 'Tab');
    await settled();
    expect(ed.selection.length).toBe(1);
    expect(el.querySelector('#sv-sel-live')?.textContent).toMatch(/Chọn:/);
    ed.select([findByUid(ed.doc, 'el_zoha6du7vr')!]);
    key(cv, 'ArrowRight', { shiftKey: true });
    cv.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    await settled();
    expect(docEl(cv).querySelector('#pumpBody')?.getAttribute('x')).toBe('610');
    key(cv, 'Escape');
    await settled();
    expect(ed.selection).toEqual([]);
  });

  it('lệnh trình vẽ có trong bảng lệnh với lý do khóa; Ctrl+G từ canvas nhóm', async () => {
    const { app } = await open();
    const { cv } = await editorFor(app);
    const ed = app.svg.editor(REL)!;
    expect(app.enabled('svg.group')).toBe('reason.svgNoSelection');
    ed.selectAll();
    expect(app.enabled('svg.group')).toBe(true);
    const n = ed.doc.elementCount;
    key(cv, 'g', { ctrlKey: true });
    await settled();
    expect(ed.doc.elementCount).toBe(n + 1);
  });
});

describe('panel Lớp (FR-105)', () => {
  it('thêm lớp; khóa và ẩn lưu vào .mat-editor/svg-state.json, không đổi tệp SVG; lớp ẩn không vẽ trong editor', async () => {
    const { app, platform } = await open();
    const { el, cv } = await editorFor(app);
    const ed = app.svg.editor(REL)!;
    (el.querySelector('[data-act="layer-add"]') as HTMLButtonElement).click();
    await settled();
    expect(ed.currentLayer).toBe('Lớp 1');
    (el.querySelector('[data-lock="Lớp 1"]') as HTMLButtonElement).click();
    (el.querySelector('[data-eye="Lớp 1"]') as HTMLButtonElement).click();
    await app.svg.state.idle();
    await settled();
    expect(el.querySelector('[data-lock="Lớp 1"]')?.getAttribute('aria-pressed')).toBe('true');
    const state = JSON.parse(platform.control.fileText('.mat-editor/svg-state.json')!);
    expect(state.files[REL].layers['Lớp 1']).toEqual({ hidden: true, locked: true });
    expect(platform.control.writes.map((w) => w.rel)).not.toContain(REL);
    const layerEl = docEl(cv).querySelector('g[data-mat-layer="Lớp 1"]') as SVGElement;
    expect(layerEl.style.display).toBe('none');
    expect(Object.keys(app.store.state.docs).some((k) => k.startsWith('.mat-editor'))).toBe(false);
  });
});

describe('inspector và chữ (FR-106, FR-108)', () => {
  it('ô X: nhập số dời phần tử (một bước); chữ sai báo aria-invalid và không đổi tài liệu', async () => {
    const { app } = await open();
    const { el } = await editorFor(app);
    const ed = app.svg.editor(REL)!;
    const s = app.svg.session(REL)!;
    ed.select([findByUid(ed.doc, 'el_zoha6du7vr')!]);
    app.svg.view(REL).ptab = 'geom';
    el.requestUpdate();
    await settled();
    const x = el.querySelector<HTMLInputElement>('#svp-x')!;
    const x0 = Number(x.value);
    x.value = String(x0 + 15);
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    expect(Number(el.querySelector<HTMLInputElement>('#svp-x')!.value)).toBeCloseTo(x0 + 15, 3);
    const n = s.undo.undoSize;
    const w = el.querySelector<HTMLInputElement>('#svp-w')!;
    w.value = 'abc';
    w.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    expect(el.querySelector('#svp-w')?.getAttribute('aria-invalid')).toBe('true');
    expect(s.undo.undoSize).toBe(n);
  });

  it('công cụ Văn bản: nhấp mở textarea có nhãn và focus; Enter tạo text một dòng', async () => {
    const { app } = await open();
    const { el, cv } = await editorFor(app);
    const s = app.svg.session(REL)!;
    key(cv, 't');
    await settled();
    ptr(docEl(cv), 'pointerdown', 300, 300);
    ptr(docEl(cv), 'pointerup', 300, 300);
    await settled();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea.sv-text')!;
    expect(ta).not.toBeNull();
    expect(ta.getAttribute('aria-label')).toMatch(/Chữ mới/);
    expect(document.activeElement).toBe(ta);
    ta.value = 'Trạm bơm số 1';
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settled();
    const texts = [...s.doc.nodes.values()].filter(
      (n) => n.tag === '#text' && n.text === 'Trạm bơm số 1',
    );
    expect(texts.length).toBe(1);
    expect(el.querySelector('textarea.sv-text')).toBeNull();
  });

  it('đang ghép chữ (bộ gõ): Enter thuộc về bộ gõ, không chốt', async () => {
    const { app } = await open();
    const { el, cv } = await editorFor(app);
    key(cv, 't');
    await settled();
    ptr(docEl(cv), 'pointerdown', 300, 300);
    await settled();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea.sv-text')!;
    ta.value = 'Bơ';
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settled();
    expect(el.querySelector('textarea.sv-text')).not.toBeNull();
  });
});

describe('xóa phần tử có binding (FR-110)', () => {
  it('Delete hỏi kèm danh sách binding; đồng ý xóa cả bản ghi binding; Hoàn tác khôi phục phần tử và binding', async () => {
    const { app } = await open();
    const { cv } = await editorFor(app);
    const ed = app.svg.editor(REL)!;
    const file = 'screens/bon-nuoc.tram_bom.bindings.json';
    const uids = () =>
      (
        (app.store.state.docs[file]!.value as { elements: Array<{ elementUid: string }> })
          .elements ?? []
      ).map((e) => e.elementUid);
    expect(uids()).toContain('el_zoha6du7vr');
    ed.select([findByUid(ed.doc, 'el_zoha6du7vr')!]);
    key(cv, 'Delete');
    await settled();
    expect(app.ui.dialog?.kind).toBe('svgDelete');
    expect(app.svg.pendingDelete?.refs.map((r) => r.uid)).toEqual(['el_zoha6du7vr']);
    const dlg = document.createElement('mat-svg-delete-dialog');
    dlg.app = app;
    document.body.append(dlg);
    await settled();
    expect(dlg.querySelector('[role="dialog"]')?.textContent).toMatch(/el_zoha6du7vr/);
    (dlg.querySelector('[data-role="ok"]') as HTMLButtonElement).click();
    await settled();
    expect(findByUid(ed.doc, 'el_zoha6du7vr')).toBeNull();
    expect(uids()).not.toContain('el_zoha6du7vr');
    await app.run('edit.undo');
    await settled();
    expect(findByUid(ed.doc, 'el_zoha6du7vr')).not.toBeNull();
    expect(uids()).toContain('el_zoha6du7vr');
  });
});

describe('lưu, tệp mới, đổi trên đĩa, tự lưu (FR-097, FR-112, FR-113)', () => {
  it('Lưu ghi tệp SVG (chuẩn tắc), tài liệu của store nhận văn bản mới, hết dấu chưa lưu', async () => {
    const { app, platform } = await open();
    await editorFor(app);
    const ed = app.svg.editor(REL)!;
    ed.select([findByUid(ed.doc, 'el_zoha6du7vr')!]);
    ed.nudge(5, 0);
    await app.run('project.save');
    const w = platform.control.writes.find((x) => x.rel === REL);
    expect(w?.content).toContain('x="605"');
    expect(app.store.textOf(REL)).toContain('x="605"');
    expect(app.svg.dirty(REL)).toBe(false);
  });

  it('"Mới: SVG trống": tạo graphics/<tên>.svg chưa lưu, mở tab; trùng tên bị khóa; Lưu ghi tệp mới', async () => {
    const { app, platform } = await open();
    app.openEditor('svgnew');
    const el = document.createElement('mat-svg-new');
    el.app = app;
    document.body.append(el);
    await settled();
    const name = el.querySelector<HTMLInputElement>('#svn-name')!;
    name.value = 'tram-bom';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    expect(el.querySelector('[data-act="create"]')?.hasAttribute('disabled')).toBe(true);
    name.value = 'Van bi';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    (el.querySelector('[data-act="create"]') as HTMLButtonElement).click();
    await settled();
    expect(app.store.state.active).toBe('svgdraw:graphics/van-bi.svg');
    expect(app.svg.dirty('graphics/van-bi.svg')).toBe(true);
    expect(findNode(app.tree(), 'svgfile:graphics/van-bi.svg')).toBeTruthy();
    await app.run('project.save');
    expect(platform.control.fileText('graphics/van-bi.svg')).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 200 160"/,
    );
  });

  it('tệp đổi bên ngoài khi đang sửa: hỏi; Giữ bản đang sửa thì lần Lưu sau hỏi trước khi ghi đè; không sửa gì thì nạp lại luôn', async () => {
    const { app, platform } = await open();
    await editorFor(app);
    const ed = app.svg.editor(REL)!;
    ed.select([findByUid(ed.doc, 'el_zoha6du7vr')!]);
    ed.nudge(1, 0);
    platform.control.editOutside(
      REL,
      platform.control.fileText(REL)!.replace('Thân bơm', 'Thân bơm 2'),
    );
    await app.svg.watcher.focus();
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'svgExternal', rel: REL });
    app.svg.keepMine(REL);
    app.closeOnlineDialog();
    const saving = app.run('project.save');
    await settled();
    expect(app.ui.dialog?.kind).toBe('conflict');
    app.answer('cancel');
    await saving;
    expect(platform.control.fileText(REL)).toContain('Thân bơm 2');
    // không có thay đổi chưa lưu: nạp lại tự động
    await app.svg.reloadFromDisk(REL);
    platform.control.editOutside(
      REL,
      platform.control.fileText(REL)!.replace('Thân bơm 2', 'Thân bơm 3'),
    );
    await app.svg.watcher.focus();
    await new Promise((r) => setTimeout(r, 0));
    await settled();
    expect(app.svg.session(REL)!.text()).toContain('Thân bơm 3');
    expect(app.svg.session(REL)!.undo.undoSize).toBe(0);
  });

  it('mở project có bản tự lưu mới hơn tệp thật: hộp "Khôi phục bản tự lưu"; Khôi phục mở tệp ở trạng thái chưa lưu', async () => {
    const env = await newApp02({ files: svgDemo() });
    const text = env.platform.control.fileText(REL)!.replace('Thân bơm', 'Thân bơm (tự lưu)');
    env.platform.control.editOutside(
      '.mat-editor/autosave/graphics%2Ftram-bom.svg.20261017T095231045Z.svg',
      text,
    );
    await env.app.svg.projectOpened();
    expect(env.app.ui.dialog?.kind).toBe('svgRestore');
    const dlg = document.createElement('mat-svg-restore-dialog');
    dlg.app = env.app;
    document.body.append(dlg);
    await settled();
    expect(dlg.querySelector('tbody tr')?.getAttribute('data-rel')).toBe(REL);
    (dlg.querySelector('[data-role="ok"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await settled();
    expect(env.app.store.state.active).toBe(`svgdraw:${REL}`);
    expect(env.app.svg.dirty(REL)).toBe(true);
    expect(env.app.svg.session(REL)!.text()).toContain('Thân bơm (tự lưu)');
    expect(env.platform.control.fileText(REL)).not.toContain('(tự lưu)');
  });
});

describe('"Sửa trong trình vẽ" từ editor Màn hình (FR-097)', () => {
  it('item svg đang chọn: lệnh (Ctrl+Alt+Enter) mở đúng tệp trong trình vẽ', async () => {
    const { app } = await open();
    app.openEditor('screen:bon-nuoc');
    app.selectItems('bon-nuoc', ['tram_bom']);
    expect(app.enabled('svg.editInDrawing')).toBe(true);
    await app.run('svg.editInDrawing');
    expect(app.store.state.active).toBe(`svgdraw:${REL}`);
    app.openEditor('screen:bon-nuoc');
    app.selectItems('bon-nuoc', []);
    expect(app.enabled('svg.editInDrawing')).toBe('reason.noSvgItem');
  });
});
