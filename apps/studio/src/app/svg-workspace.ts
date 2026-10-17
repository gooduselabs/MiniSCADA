// Trình vẽ SVG trong app (feature 011, T161, T162, T163; FR-097, FR-105, FR-109, FR-110, FR-112, FR-113): các tệp đang mở
// (phiên, bộ điều khiển, khung nhìn), trạng thái soạn thảo (.mat-editor/svg-state.json), tự lưu, theo dõi đổi trên đĩa,
// clipboard giữa các tài liệu, lưu (hỏi trước khi ghi đè), "Mới: SVG trống", khôi phục bản tự lưu, xóa phần tử có binding
// (lô lệnh kèm lệnh khôi phục binding). Mỗi tệp SVG có ngăn hoàn tác riêng (100 bước); binding của item `svg` (feature 008)
// vẫn là tài liệu của store. Lưu xong, tài liệu SVG của store nhận văn bản mới để cây phần tử của 008 dựng lại.
import type { BindingSet04 } from '@mat/project-schema';
import {
  Batch,
  ExternalCommand,
  blankSvg,
  looksLikeSvg,
  type ClipData,
  type NodeId,
  type PasteTextReport,
} from '@mat/svg-edit';
import { t } from '../i18n/index.ts';
import { svgSlug } from '../model/svg-doc.ts';
import { SvgStateStore } from '../model/svg-state.ts';
import {
  Autosaver,
  findRestorable,
  platformAutosaveIo,
  type RestoreOffer,
} from '../model/svg/autosave.ts';
import { SvgEditor } from '../model/svg/editor.ts';
import { SvgSession, type MeasureText, type OpenFailure } from '../model/svg/session.ts';
import { DiskWatcher, type DiskState } from '../model/svg/watch.ts';
import type { Fingerprint } from '../platform/types.ts';
import type { StudioApp } from './app.ts';

export type PropTab = 'common' | 'geom' | 'paint' | 'text' | 'bind';

/** Khung nhìn của một tệp (giữ khi chuyển tab). */
export interface SvgView {
  zoom: number;
  panX: number;
  panY: number;
  /** Đã vừa khung lần đầu. */
  fitted: boolean;
  ptab: PropTab;
  lockRatio: boolean;
  showGrid: boolean;
}

/** Một binding của item `svg` (feature 008) gắn vào uid trong tệp. */
export interface BoundRef {
  screen: string;
  item: string;
  file: string;
  uid: string;
  /** Mô tả ngắn: đích ← nguồn (để liệt kê trong cảnh báo). */
  rows: string[];
}

/** Đuôi `svgdraw:` của EditorId. */
export const SVGDRAW = 'svgdraw:';
export const relOfEditor = (id: string): string | null =>
  id.startsWith(SVGDRAW) ? id.slice(SVGDRAW.length) : null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function openMessage(e: OpenFailure): string {
  if ('message' in e) return `${e.code}: ${e.message}`;
  return t(
    e.code === 'missing'
      ? 'svgd.err.missing'
      : e.code === 'too-large'
        ? 'svgd.err.tooLarge'
        : e.code === 'bad-utf8'
          ? 'svgd.err.utf8'
          : 'svgd.err.path',
  );
}

export class SvgWorkspace {
  private readonly app: StudioApp;
  readonly state: SvgStateStore;
  readonly autosaver: Autosaver;
  readonly watcher: DiskWatcher;
  readonly sessions = new Map<string, SvgSession>();
  private readonly editors = new Map<string, SvgEditor>();
  private readonly views = new Map<string, SvgView>();
  private readonly opening = new Map<string, Promise<void>>();
  /** Lý do không mở được (hiện trong tab). */
  readonly errors = new Map<string, string>();
  /** Tệp `.svg` trên đĩa (cây "Đồ họa SVG"). */
  diskFiles: string[] = [];
  /** Bản tự lưu đáng khôi phục lúc mở project. */
  offers: RestoreOffer[] = [];
  /** Clipboard của trình vẽ (dùng được giữa hai tài liệu). */
  clip: ClipData | null = null;
  /** Đang chờ xác nhận xóa phần tử (hoặc lớp) có binding. */
  pendingDelete: { rel: string; batch: Batch; refs: BoundRef[]; what: string } | null = null;
  /** Báo cáo dán SVG đã lọc. */
  pasteReport: { rel: string; report: PasteTextReport; count: number } | null = null;
  /** Tệp đang đổi bên ngoài, chờ người dùng chọn. */
  external: { rel: string; disk: Fingerprint | null; missing: boolean } | null = null;
  /** Hàm đo chữ của trình duyệt (canvas 2D), do giao diện đặt. */
  measure: MeasureText | undefined;
  /** Giao diện đăng ký để vẽ lại DOM của tài liệu khi nút đổi (`null`: dựng lại cả tài liệu). */
  readonly listeners = new Set<(rel: string, targets: readonly NodeId[] | null) => void>();

  constructor(app: StudioApp) {
    this.app = app;
    const p = app.platform;
    this.state = new SvgStateStore(p);
    this.autosaver = new Autosaver(platformAutosaveIo(p));
    this.watcher = new DiskWatcher(p);
    if (typeof window !== 'undefined')
      window.addEventListener('focus', () => void this.watcher.focus());
  }

  // ---------- project ----------

  async projectOpened(): Promise<void> {
    this.projectClosed();
    const p = this.app.platform;
    await this.state.load();
    this.diskFiles = await p.listSvg();
    this.offers = await findRestorable(platformAutosaveIo(p), p);
    if (this.offers.length && !this.app.ui.dialog) this.app.openDialog({ kind: 'svgRestore' });
    this.app.requestRender();
  }

  projectClosed(): void {
    this.autosaver.untrackAll();
    this.watcher.unwatchAll();
    this.sessions.clear();
    this.editors.clear();
    this.views.clear();
    this.errors.clear();
    this.opening.clear();
    this.diskFiles = [];
    this.offers = [];
    this.pendingDelete = null;
    this.pasteReport = null;
    this.external = null;
  }

  /** Tệp SVG của project: trên đĩa, tài liệu của store (đọc vì màn hình dùng), tệp mới chưa lưu. */
  files(): string[] {
    const set = new Set(this.diskFiles);
    for (const [rel, d] of Object.entries(this.app.store.state.docs))
      if (rel.endsWith('.svg') && !d.removed) set.add(rel);
    for (const rel of this.sessions.keys()) set.add(rel);
    return [...set].filter((r) => !r.startsWith('.')).sort();
  }

  // ---------- phiên ----------

  session(rel: string): SvgSession | undefined {
    return this.sessions.get(rel);
  }

  /** Mở tệp (một lần); lỗi ghi vào `errors`. */
  ensure(rel: string): Promise<void> {
    if (this.sessions.has(rel)) return Promise.resolve();
    const pending = this.opening.get(rel);
    if (pending) return pending;
    const run = (async () => {
      const r = await SvgSession.open(this.app.platform, rel, this.sessionOpts());
      this.opening.delete(rel);
      if (!r.ok) {
        this.errors.set(rel, openMessage(r.error));
      } else {
        this.errors.delete(rel);
        this.adopt(r.session);
      }
      this.app.requestRender();
    })();
    this.opening.set(rel, run);
    return run;
  }

  private sessionOpts() {
    return this.measure ? { measure: this.measure } : {};
  }

  /** Nhận một phiên (mở, tạo mới, khôi phục): tự lưu và theo dõi đĩa. */
  private adopt(s: SvgSession): void {
    this.sessions.set(s.rel, s);
    this.editors.delete(s.rel);
    this.autosaver.track(s.rel, { version: () => s.doc.version, text: () => s.text() });
    this.watcher.watch(s.rel, s.base.hash === null ? null : s.base.disk, (st) =>
      this.onDiskChange(s.rel, st),
    );
  }

  editor(rel: string): SvgEditor | null {
    const s = this.sessions.get(rel);
    if (!s) return null;
    let ed = this.editors.get(rel);
    if (!ed || ed.session !== s) {
      ed = new SvgEditor(s, {
        layer: (name) => this.state.layer(rel, name ?? ''),
        guides: () => this.state.guides(rel),
      });
      this.editors.set(rel, ed);
    }
    return ed;
  }

  view(rel: string): SvgView {
    let v = this.views.get(rel);
    if (!v) {
      v = {
        zoom: 1,
        panX: 24,
        panY: 24,
        fitted: false,
        ptab: 'geom',
        lockRatio: false,
        showGrid: true,
      };
      this.views.set(rel, v);
    }
    return v;
  }

  dirty(rel: string): boolean {
    return this.sessions.get(rel)?.dirty ?? false;
  }

  dirtyRels(): string[] {
    return [...this.sessions.values()].filter((s) => s.dirty).map((s) => s.rel);
  }

  /** Báo giao diện vẽ lại (`targets` null: dựng lại cả tài liệu). */
  changed(rel: string, targets: readonly NodeId[] | null): void {
    for (const l of this.listeners) l(rel, targets);
    this.app.requestRender();
  }

  undo(rel: string): boolean {
    const s = this.sessions.get(rel);
    const t = s?.undoStep();
    if (!s || !t) return false;
    this.editor(rel)?.prune();
    this.changed(rel, t);
    return true;
  }

  redo(rel: string): boolean {
    const s = this.sessions.get(rel);
    const t = s?.redoStep();
    if (!s || !t) return false;
    this.editor(rel)?.prune();
    this.changed(rel, t);
    return true;
  }

  // ---------- lưu, đĩa ----------

  /** Lưu một tệp; xung đột thì hỏi Ghi đè / Tải lại / Hủy. Trả `true` khi đã lưu. */
  async save(rel: string): Promise<boolean> {
    const s = this.sessions.get(rel);
    if (!s) return true;
    let force = false;
    for (;;) {
      const r = await s.save(this.app.platform, { force });
      if (r.status === 'saved') {
        this.app.store.fileSaved(rel, s.base.text, r.hash);
        this.autosaver.settle(rel);
        void this.autosaver.discard(rel);
        this.watcher.accept(rel, s.base.disk);
        if (!this.diskFiles.includes(rel)) this.diskFiles = [...this.diskFiles, rel].sort();
        if (this.external?.rel === rel) this.external = null;
        this.app.requestRender();
        return true;
      }
      if (r.status === 'conflict') {
        const choice = await this.app.ask({ kind: 'conflict', rel });
        if (choice === 'overwrite') {
          force = true;
          continue;
        }
        if (choice === 'reload') await this.reloadFromDisk(rel);
        return false;
      }
      await this.app.ask({
        kind: 'saveError',
        rel,
        reason:
          r.error === 'too-large'
            ? t('svgd.err.tooLarge')
            : `${r.error}${r.detail ? `: ${r.detail}` : ''}`,
      });
      return false;
    }
  }

  /** Người dùng chọn Bỏ thay đổi (đóng project, đóng cửa sổ): xóa bản tự lưu của các tệp chưa lưu. */
  async discardAutosaves(): Promise<void> {
    for (const rel of this.dirtyRels()) {
      this.autosaver.untrack(rel);
      await this.autosaver.discard(rel);
    }
  }

  /** Thêm đường gióng cố định tại `pos`, hoặc bỏ đường gần đó (trong `tol` đơn vị tài liệu). */
  toggleGuide(rel: string, axis: 'x' | 'y', pos: number, tol: number): void {
    const cur = this.state.guides(rel);
    const near = cur.findIndex((g) => g.axis === axis && Math.abs(g.pos - pos) <= tol);
    const next = near >= 0 ? cur.filter((_, i) => i !== near) : [...cur, { axis, pos }];
    void this.state.setGuides(rel, next);
    this.changed(rel, []);
  }

  async saveAll(): Promise<string[] | null> {
    const done: string[] = [];
    for (const rel of this.dirtyRels()) {
      if (!(await this.save(rel))) return null;
      done.push(rel);
    }
    return done;
  }

  /** "Nạp lại từ đĩa": bỏ thay đổi và lịch sử hoàn tác của tệp. */
  async reloadFromDisk(rel: string): Promise<boolean> {
    const s = this.sessions.get(rel);
    if (!s) return false;
    const p = this.app.platform;
    const r = await p.read(rel);
    if (!('text' in r)) {
      this.app.toast(t('svgd.err.missing'));
      return false;
    }
    const fp = await p.fingerprint(rel);
    const err = s.reload(r.text, r.hash, 'hash' in fp ? fp : null);
    if (err) {
      this.app.toast(openMessage(err));
      return false;
    }
    this.editors.delete(rel);
    this.watcher.accept(rel, s.base.disk);
    this.autosaver.settle(rel);
    this.app.store.fileSaved(rel, r.text, r.hash);
    if (this.external?.rel === rel) this.external = null;
    this.changed(rel, null);
    return true;
  }

  /** "Giữ bản đang sửa": lần Lưu sau hỏi trước khi ghi đè. */
  keepMine(rel: string): void {
    const s = this.sessions.get(rel);
    if (s && this.external?.rel === rel) s.keepExternal(this.external.disk);
    if (this.external?.rel === rel) this.external = null;
    this.app.requestRender();
  }

  private onDiskChange(rel: string, st: Exclude<DiskState, { kind: 'same' }>): void {
    const s = this.sessions.get(rel);
    if (!s) return;
    if (!s.dirty && st.kind === 'changed') {
      // không có thay đổi chưa lưu: nạp lại luôn (không mất gì), báo bằng thông báo
      void this.reloadFromDisk(rel).then((ok) => {
        if (ok) this.app.toast(t('svgd.ext.reloaded', { file: rel }));
      });
      return;
    }
    this.external = {
      rel,
      disk: st.kind === 'changed' ? st.disk : null,
      missing: st.kind === 'missing',
    };
    if (!this.app.ui.dialog) this.app.openDialog({ kind: 'svgExternal', rel });
    this.app.requestRender();
  }

  // ---------- tệp mới, khôi phục ----------

  /** Đường dẫn cho tên người dùng gõ: `graphics/<slug>.svg`; trùng thì null. */
  pathFor(name: string): string | null {
    const rel = `graphics/${svgSlug(name)}.svg`;
    return this.files().some((f) => f.toLowerCase() === rel.toLowerCase()) ? null : rel;
  }

  /** "Mới: SVG trống": tài liệu mới chưa có trên đĩa (dấu chưa lưu), mở ngay trong trình vẽ. */
  createNew(
    name: string,
    width: number,
    height: number,
    opts: { layer?: string; background?: boolean; grid?: number } = {},
  ): string | null {
    const rel = this.pathFor(name);
    if (rel === null) return null;
    let text = blankSvg(width, height);
    const parts: string[] = [];
    if (opts.background)
      parts.push(
        `<g data-mat-layer="${t('svgd.new.bgLayer')}"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/></g>`,
      );
    if (opts.layer && opts.layer.trim())
      parts.push(`<g data-mat-layer="${escapeAttr(opts.layer.trim())}"/>`);
    if (parts.length) text = text.replace('>\n</svg>', `>\n${parts.join('\n')}\n</svg>`);
    const r = SvgSession.fromText(
      rel,
      text,
      { text: '', hash: null, disk: null },
      this.sessionOpts(),
    );
    if (!r.ok) return null;
    this.adopt(r.session);
    const ed = this.editor(rel)!;
    ed.snap.gridSize = opts.grid ?? 10;
    if (opts.layer && opts.layer.trim()) ed.currentLayer = opts.layer.trim();
    if (opts.background) void this.state.setLayer(rel, t('svgd.new.bgLayer'), { locked: true });
    this.app.openEditor(`${SVGDRAW}${rel}` as `svgdraw:${string}`);
    return rel;
  }

  /** Khôi phục bản tự lưu: mở tệp ở trạng thái chưa lưu (tệp trên đĩa chỉ đổi khi Lưu). */
  async restore(choices: ReadonlyArray<{ rel: string; name: string | null }>): Promise<void> {
    const p = this.app.platform;
    let first: string | null = null;
    for (const c of choices) {
      const offer = this.offers.find((o) => o.rel === c.rel);
      if (!offer) continue;
      if (c.name === null) {
        await this.autosaver.discard(c.rel);
        continue;
      }
      const v = offer.versions.find((x) => x.name === c.name) ?? offer.versions[0];
      const disk = await p.read(c.rel);
      const fp = await p.fingerprint(c.rel);
      const base =
        'text' in disk
          ? { text: disk.text, hash: disk.hash, disk: 'hash' in fp ? fp : null }
          : { text: '', hash: null, disk: null };
      const r = SvgSession.fromText(c.rel, v.text, base, this.sessionOpts());
      if (!r.ok) {
        this.app.toast(openMessage(r.error));
        continue;
      }
      this.adopt(r.session);
      first ??= c.rel;
    }
    this.offers = [];
    if (first) this.app.openEditor(`${SVGDRAW}${first}` as `svgdraw:${string}`);
    this.app.requestRender();
  }

  // ---------- binding (feature 008) ----------

  /** Binding của mọi item `svg` dùng tệp `rel` gắn vào các uid. */
  bindingRefs(rel: string, uids: readonly string[]): BoundRef[] {
    if (!uids.length) return [];
    const want = new Set(uids);
    const out: BoundRef[] = [];
    const docs = this.app.store.state.docs;
    for (const s of this.app.store.state.outline.screens)
      for (const it of s.model?.items ?? []) {
        if (it.type !== 'svg' || it.svgFile !== rel) continue;
        const set = docs[it.bindingFile]?.value;
        if (!isObject(set) || !Array.isArray(set.elements)) continue;
        for (const e of (set as unknown as BindingSet04).elements) {
          if (!want.has(e.elementUid)) continue;
          const rows = (e.bindings ?? []).map((b) => {
            const src =
              isObject(b.source) && typeof b.source.tagId === 'string'
                ? b.source.tagId
                : (b.source?.type ?? '');
            return `${b.target} ← ${src}`;
          });
          if (e.events?.click) rows.push(`click: ${e.events.click.action}`);
          out.push({ screen: s.id, item: it.id, file: it.bindingFile, uid: e.elementUid, rows });
        }
      }
    return out;
  }

  /** Lệnh ngoài SVG đi cùng lô xóa: bỏ bản ghi binding của các uid; hoàn tác ghi lại đúng bộ cũ (FR-110). */
  private bindingRemoval(refs: readonly BoundRef[]): ExternalCommand | null {
    const files = [...new Set(refs.map((r) => r.file))];
    if (!files.length) return null;
    const store = this.app.store;
    const before = new Map<string, BindingSet04>();
    for (const f of files)
      before.set(f, structuredClone(store.state.docs[f]!.value as BindingSet04));
    const gone = new Set(refs.map((r) => r.uid));
    return new ExternalCommand(
      'bindings',
      () =>
        store.edit(
          files.map((f) => {
            const set = before.get(f)!;
            return {
              kind: 'svgBindings',
              file: f,
              set: { ...set, elements: set.elements.filter((e) => !gone.has(e.elementUid)) },
            };
          }),
        ),
      () => store.edit(files.map((f) => ({ kind: 'svgBindings', file: f, set: before.get(f)! }))),
    );
  }

  /** Delete: không có binding thì xóa ngay; có thì hỏi kèm danh sách binding. */
  deleteSelection(rel: string): void {
    const ed = this.editor(rel);
    const plan = ed?.planDelete();
    if (!ed || !plan) return;
    const refs = this.bindingRefs(rel, plan.uids);
    if (!refs.length) {
      const r = ed.applyDelete(plan.batch);
      if (r.ok) this.changed(rel, r.targets);
      return;
    }
    this.pendingDelete = {
      rel,
      batch: plan.batch,
      refs,
      what:
        ed.selection.length === 1
          ? ed.label(ed.selection[0])
          : t('svgd.del.many', { n: ed.selection.length }),
    };
    this.app.openDialog({ kind: 'svgDelete', rel });
  }

  /** Xóa lớp: `content` xóa luôn nội dung (cảnh báo binding nếu có), `move` chuyển nội dung về Lớp mặc định. */
  deleteLayer(rel: string, name: string, mode: 'content' | 'move'): boolean {
    const ed = this.editor(rel);
    if (!ed) return false;
    const plan = ed.planDeleteLayer(name, mode);
    if (typeof plan === 'string') {
      this.app.toast(plan);
      return false;
    }
    const refs = this.bindingRefs(rel, plan.uids);
    const ext = this.bindingRemoval(refs);
    const batch = ext
      ? new Batch([...plan.batch.commands, ext], { label: plan.batch.label })
      : plan.batch;
    const r = ed.applyDelete(batch);
    if (r.ok) {
      void this.state.dropLayer(rel, name);
      this.changed(rel, r.targets);
    } else if (ed.message) this.app.toast(ed.message);
    return r.ok;
  }

  confirmDelete(): void {
    const p = this.pendingDelete;
    this.pendingDelete = null;
    if (!p) return;
    const ed = this.editor(p.rel);
    if (!ed) return;
    const ext = this.bindingRemoval(p.refs);
    const batch = ext ? new Batch([...p.batch.commands, ext], { label: p.batch.label }) : p.batch;
    const r = ed.applyDelete(batch);
    if (r.ok) this.changed(p.rel, r.targets);
    else if (ed.message) this.app.toast(ed.message);
  }

  cancelDelete(): void {
    this.pendingDelete = null;
  }

  // ---------- clipboard ----------

  copy(rel: string): boolean {
    const c = this.editor(rel)?.copy();
    if (!c) return false;
    this.clip = c;
    this.app.requestRender();
    return true;
  }

  cut(rel: string): void {
    if (this.copy(rel)) this.deleteSelection(rel);
  }

  /** Dán: chữ SVG từ clipboard hệ thống (qua allowlist) hoặc clipboard của trình vẽ. */
  paste(rel: string, text?: string): void {
    const ed = this.editor(rel);
    if (!ed) return;
    if (text !== undefined && looksLikeSvg(text)) {
      const r = ed.pasteText(text);
      if (!r) return this.toastMessage(ed);
      if (!r.ok) {
        this.app.toast(t('svgd.paste.failed', { reason: r.message }));
        return;
      }
      this.changed(rel, null);
      if (r.report.removedElements + r.report.removedAttributes > 0) {
        this.pasteReport = { rel, report: r.report, count: r.ids.length };
        this.app.openDialog({ kind: 'svgPasteReport', rel });
      } else this.app.toast(t('svgd.paste.done', { n: r.ids.length }));
      return;
    }
    if (!this.clip) {
      this.app.toast(t('reason.svgClipEmpty'));
      return;
    }
    const r = ed.paste(this.clip);
    if (r?.ok) this.changed(rel, r.targets);
    else this.toastMessage(ed);
  }

  private toastMessage(ed: SvgEditor): void {
    if (ed.message) this.app.toast(ed.message);
  }

  // ---------- lớp ----------

  setLayerState(
    rel: string,
    name: string | null,
    patch: { hidden?: boolean; locked?: boolean },
  ): void {
    void this.state.setLayer(rel, name ?? '', patch);
    const ed = this.editor(rel);
    if (ed && (patch.hidden || patch.locked))
      ed.select(ed.selection.filter((id) => ed.canvasSelectable(id) || !patch.hidden));
    this.changed(rel, []);
  }

  renameLayer(rel: string, from: string, to: string): boolean {
    const ed = this.editor(rel);
    if (!ed) return false;
    const r = ed.renameLayer(from, to);
    if (r.ok) {
      void this.state.renameLayer(rel, from, to.trim());
      this.changed(rel, r.targets);
    } else if (ed.message) this.app.toast(ed.message);
    return r.ok;
  }
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
