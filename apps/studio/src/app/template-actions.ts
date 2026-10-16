// Hành động template và faceplate của Studio (feature 011, T173; FR-126): nối mô hình thuần `model/template-doc.ts` với
// app (vùng chọn, hộp thoại, store). Mỗi thao tác là MỘT `store.edit` (một bước hoàn tác).
import type { Item10, ScreenModel, TemplateDoc } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import {
  explodeInstance,
  instancesOf,
  planDeleteTemplate,
  planFaceplate,
  planUpdateAll,
  type InstanceInfo,
} from '../model/template-doc.ts';
import type { ProjectEdit } from '../model/project-doc.ts';
import type { StudioApp } from './app.ts';
import { currentScreenId } from './tree-commands.ts';

/** Template đọc được của project theo id. */
export function templatesOf(app: StudioApp): Record<string, TemplateDoc> {
  const out: Record<string, TemplateDoc> = {};
  for (const tp of app.store.state.outline.templates) if (tp.doc) out[tp.id] = tp.doc;
  return out;
}

/** Màn hình 0.3+ đọc được, theo thứ tự project.json. */
export function screensOf(app: StudioApp): ScreenModel[] {
  return app.store.state.outline.screens.flatMap((s) => (s.model ? [s.model] : []));
}

/** Bản sao của template `tid` trên mọi màn hình. */
export function instancesOfTemplate(app: StudioApp, tid: string): InstanceInfo[] {
  return instancesOf(screensOf(app), templatesOf(app), tid);
}

/** Bản sao (khác nhau, theo thứ tự lớp) có item trong vùng chọn của màn hình `sid`. */
export function selectedInstances(
  app: StudioApp,
  sid: string,
): Array<{ inst: string; tid: string }> {
  const doc = app.screenModel(sid);
  const sel = new Set(app.selectedItems(sid));
  const out: Array<{ inst: string; tid: string }> = [];
  for (const it of doc?.items ?? []) {
    const tpl = (it as Item10).tpl;
    if (!sel.has(it.id) || !tpl || out.some((x) => x.inst === tpl.inst)) continue;
    out.push({ inst: tpl.inst, tid: tpl.tid });
  }
  return out;
}

/** "Tạo template…": hộp thoại với vùng chọn hiện tại. */
export function openCreateTemplate(app: StudioApp): void {
  const sid = currentScreenId(app);
  if (sid === null) return;
  const ids = app.selectedItems(sid);
  if (ids.length === 0) return;
  app.openDialog({ kind: 'templateCreate', screen: sid, ids: [...ids] });
}

/** "Bung thành item thường" cho mọi bản sao có item trong vùng chọn. */
export function explodeSelection(app: StudioApp): void {
  const sid = currentScreenId(app);
  if (sid === null) return;
  const list = selectedInstances(app, sid);
  if (list.length === 0) return;
  app.editScreen(sid, (d) => {
    let doc = d;
    for (const x of list) doc = explodeInstance(doc, x.inst);
    return { doc };
  });
  app.toast(t('tpl.exploded', { list: list.map((x) => x.inst).join(', ') }));
}

/** "Cập nhật mọi bản sao": template của bản sao đang chọn, hoặc `tid`. */
export function openUpdateAll(app: StudioApp, tid?: string): void {
  const sid = currentScreenId(app);
  const id = tid ?? (sid === null ? undefined : selectedInstances(app, sid)[0]?.tid);
  if (id === undefined || !templatesOf(app)[id]) {
    app.toast(t('tpl.err.noTemplate', { id: id ?? '' }));
    return;
  }
  app.openDialog({ kind: 'templateUpdate', tid: id });
}

/** Bung lại mọi bản sao của `tid` từ template hiện tại (một bước hoàn tác); trả số bản sao đã cập nhật. */
export function applyUpdateAll(app: StudioApp, tid: string): number {
  const tpl = templatesOf(app)[tid];
  if (!tpl) return 0;
  const plan = planUpdateAll(screensOf(app), tpl);
  if (plan.edits.length) app.store.edit(plan.edits);
  app.toast(
    t('tpl.updated', { n: plan.instances, screens: plan.screens, removed: plan.removed.length }),
  );
  return plan.instances;
}

/** Xóa template: bung mọi bản sao rồi xóa (một bước hoàn tác). */
export function applyDeleteTemplate(app: StudioApp, tid: string): void {
  const plan = planDeleteTemplate(screensOf(app), tid);
  app.store.edit(plan.edits);
  app.closeTab(`template:${tid}`);
  app.toast(t('tpl.deleted', { id: tid, n: plan.instances }));
}

/** "Tạo faceplate": màn hình popup đang mở thành popup có tham số. */
export function makeFaceplate(app: StudioApp): void {
  const sid = currentScreenId(app);
  const doc = sid === null ? null : app.screenModel(sid);
  if (!doc) return;
  const r = planFaceplate(doc);
  if (!r.ok) {
    app.toast(t(r.reason === 'not-popup' ? 'tpl.fp.notPopup' : 'tpl.fp.noPrefix'));
    return;
  }
  const edits: ProjectEdit[] = [{ kind: 'screenUpsert', screen: r.screen as ScreenModel }];
  app.store.edit(edits);
  app.toast(t('tpl.fp.done', { list: r.params.map((p) => p.name).join(', ') }));
}
