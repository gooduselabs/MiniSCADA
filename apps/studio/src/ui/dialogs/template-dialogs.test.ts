// Giao diện template và faceplate (feature 011, T171; FR-126): mục "Template" trên cây (thư viện, số bản sao), "Tạo
// template…" từ vùng chọn (tham số phát hiện sẵn, thay vùng chọn bằng bản sao), trang template (danh sách bản sao, "Cập
// nhật mọi bản sao" một bước hoàn tác), xóa template còn bản sao (chỉ bung rồi xóa), thêm bản sao bằng hộp tham số, menu
// ngữ cảnh của vùng chọn, tạo faceplate từ màn hình popup.
import { resolve } from 'node:path';
import type { Item10, ScreenModel, ScreenModel10, TemplateDoc } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { findNode } from '../../model/tree.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import '../editors/template-editor.ts';
import './args-dialog.ts';
import './template-confirm.ts';
import './template-create.ts';
import './template-instance.ts';
import type { MatTemplateConfirmDialog } from './template-confirm.ts';
import type { MatTemplateCreateDialog } from './template-create.ts';
import type { MatTemplateInstanceDialog } from './template-instance.ts';

afterEach(cleanup);

const vector = () => {
  const f = readProjectDir(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  delete f['expected.json'];
  return f;
};

async function open() {
  const env = await newApp02({ files: vector() });
  await env.app.store.validateNow();
  return env;
}

const screen = (app: Awaited<ReturnType<typeof open>>['app'], id: string) =>
  app.screenModel(id) as ScreenModel;
const ok = (el: Element) => el.querySelector<HTMLButtonElement>('[data-role="ok"]')!;
const typeIn = async (input: HTMLInputElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settled();
};

describe('cây project: mục Template', () => {
  it('project 1.0 có mục Template, mỗi template một nút với số bản sao; mở thư viện và trang template', async () => {
    const { app } = await open();
    const node = findNode(app.tree(), 'templates');
    expect(node?.label).toBe('Template');
    expect(node?.editor).toBe('templates');
    expect(node?.children?.map((c) => [c.id, c.label, c.sub])).toEqual([
      ['template:bom', 'Bơm có đèn và lưu lượng', '2 bản sao'],
    ]);
    expect(app.editorTitle('template:bom')).toBe('Bơm có đèn và lưu lượng');
    const lib = await mount('mat-template-library', app);
    expect(lib.querySelector('[data-tid="bom"]')?.textContent).toContain('prefix (tagPrefix)');
    const ed = document.createElement('mat-template-editor');
    ed.app = app;
    ed.tid = 'bom';
    document.body.append(ed);
    await settled();
    const rows = [...ed.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-inst'));
    expect(rows).toEqual(['pump7', 'pump8']);
    expect(ed.querySelector('[data-inst="pump7"] .chip.tpl')?.textContent).toContain('pump7');
  });

  it('project 0.6 không có mục Template', async () => {
    const files = readProjectDir(resolve(REPO, 'projects/history-demo'));
    const { app } = await newApp02({ files });
    expect(findNode(app.tree(), 'templates')).toBeUndefined();
  });
});

describe('Tạo template từ vùng chọn', () => {
  it('menu ngữ cảnh có "Tạo template…"; hộp thoại phát hiện prefix, tạo template và thay vùng chọn bằng bản sao', async () => {
    const { app } = await open();
    app.openEditor('screen:main');
    app.selectItems('main', ['btn_pump']);
    app.setUiContext({ screenSel: 1, screenTplSel: false });
    expect(app.enabled('screen.createTemplate')).toBe(true);
    expect(app.enabled('screen.explodeInstance')).toBe('reason.noInstanceSel');
    const el = await mount<MatTemplateCreateDialog>('mat-template-create-dialog', app);
    // chọn hai item có Tag cùng tiền tố PUMP01 (đèn và nhãn của "bơm 1")
    const ids = ['lamp_fault', 'btn_run'];
    app.selectItems('main', ids);
    await app.run('screen.createTemplate');
    await settled();
    expect(app.ui.dialog).toMatchObject({ kind: 'templateCreate', screen: 'main' });
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('[data-param="prefix"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-rep]').length).toBeGreaterThan(0);
    await typeIn(el.querySelector<HTMLInputElement>('input[name="tid"]')!, 'bom-1');
    await typeIn(el.querySelector<HTMLInputElement>('input[name="tname"]')!, 'Bơm một');
    ok(el).click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    const tpl = app.store.state.docs['templates/bom-1.template.json']?.value as TemplateDoc;
    expect(tpl.name).toBe('Bơm một');
    expect(JSON.stringify(tpl.items)).toContain('{prefix}.');
    const inst = screen(app, 'main').items.filter((i) => (i as Item10).tpl?.tid === 'bom-1');
    expect(inst.map((i) => i.id)).toEqual(ids.map((id) => `bom-11.${id}`));
    expect(app.store.state.outline.templateFiles).toContain('templates/bom-1.template.json');
    await app.run('edit.undo');
    expect(app.store.state.docs['templates/bom-1.template.json']).toBeUndefined();
    expect(screen(app, 'main').items.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
  });

  it('id sai: lỗi tại ô, hộp thoại giữ nguyên', async () => {
    const { app } = await open();
    const el = await mount<MatTemplateCreateDialog>('mat-template-create-dialog', app);
    app.openDialog({ kind: 'templateCreate', screen: 'main', ids: ['btn_pump'] });
    await settled();
    await typeIn(el.querySelector<HTMLInputElement>('input[name="tid"]')!, 'bom');
    ok(el).click();
    await settled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Đã có template cùng id');
    expect(el.querySelector('input[name="tid"]')?.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('trang template: cập nhật, thêm bản sao, xóa', () => {
  it('Cập nhật mọi bản sao: hộp xác nhận nêu số bản sao, áp một bước hoàn tác', async () => {
    const { app } = await open();
    const t0 = app.store.state.docs['templates/bom.template.json']!.value as TemplateDoc;
    app.store.edit([
      {
        kind: 'templateUpsert',
        template: {
          ...t0,
          items: t0.items.map((i) =>
            i.id === 'flow' ? { ...i, props: { label: '{title}: lưu lượng' } } : i,
          ),
        } as TemplateDoc,
      },
    ]);
    const el = await mount<MatTemplateConfirmDialog>('mat-template-confirm-dialog', app);
    app.openDialog({ kind: 'templateUpdate', tid: 'bom' });
    await settled();
    expect(el.querySelector('[data-k="count"]')?.textContent).toContain(
      '2 bản sao trên 1 màn hình',
    );
    expect(ok(el).textContent).toContain('Cập nhật 2 bản sao');
    ok(el).click();
    await settled();
    const label = (
      screen(app, 'main').items.find((i) => i.id === 'pump8.flow') as {
        props?: { label?: string };
      }
    ).props?.label;
    expect(label).toMatch(/: lưu lượng$/);
    await app.run('edit.undo');
    expect(
      (
        screen(app, 'main').items.find((i) => i.id === 'pump8.flow') as {
          props?: { label?: string };
        }
      ).props?.label,
    ).toMatch(/\(lưu lượng\)$/);
  });

  it('Thêm bản sao: giá trị sai kiểu bị báo ngay; giá trị đúng thêm item `<inst>.<rid>` với Tag đã thay', async () => {
    const { app } = await open();
    const el = await mount<MatTemplateInstanceDialog>('mat-template-instance-dialog', app);
    app.openDialog({ kind: 'templateInstance', tid: 'bom', screen: 'main' });
    await settled();
    expect(el.querySelector<HTMLInputElement>('input[name="inst"]')!.value).toBe('bom1');
    const prefix = el.querySelector<HTMLInputElement>('input[name="v-prefix"]')!;
    await typeIn(prefix, '9X');
    expect(prefix.getAttribute('aria-invalid')).toBe('true');
    ok(el).click();
    await settled();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    await typeIn(prefix, 'PUMP01');
    ok(el).click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    const lamp = screen(app, 'main').items.find((i) => i.id === 'bom1.lamp') as Item10 & {
      tags?: Record<string, string>;
    };
    expect(lamp.tags).toEqual({ state: 'PUMP01.RUN' });
    expect(lamp.tpl).toMatchObject({ inst: 'bom1', tid: 'bom', rid: 'lamp' });
  });

  it('Xóa template còn bản sao: chỉ "Bung N bản sao và xóa template" hoặc Hủy', async () => {
    const { app } = await open();
    const el = await mount<MatTemplateConfirmDialog>('mat-template-confirm-dialog', app);
    app.openDialog({ kind: 'templateDelete', tid: 'bom' });
    await settled();
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('Template còn 2 bản sao');
    expect(el.querySelectorAll('.dlg-f button').length).toBe(2);
    expect(ok(el).textContent).toContain('Bung 2 bản sao và xóa template');
    ok(el).click();
    await settled();
    expect(app.store.state.outline.templateFiles).toEqual([]);
    expect(screen(app, 'main').items.some((i) => (i as Item10).tpl)).toBe(false);
    expect(screen(app, 'main').items.some((i) => i.id === 'pump7.lamp')).toBe(true);
    await app.store.validateNow();
    expect(app.store.state.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
  });
});

describe('faceplate từ màn hình popup', () => {
  it('lệnh "Tạo faceplate" trên popup pump: Tag thành {prefix}.X, params có default', async () => {
    const { app } = await open();
    app.openEditor('screen:pump');
    app.setUiContext({ screenIsPopup: true });
    expect(app.enabled('screen.faceplate')).toBe(true);
    await app.run('screen.faceplate');
    const s = screen(app, 'pump') as ScreenModel10;
    expect(s.params).toEqual([{ name: 'prefix', kind: 'tagPrefix', default: 'PUMP01' }]);
    expect(JSON.stringify(s.items)).toContain('{prefix}.RUN_CMD');
    await app.store.validateNow();
    expect(app.store.state.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
  });
});
