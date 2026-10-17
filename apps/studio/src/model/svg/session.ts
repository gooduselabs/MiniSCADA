// Một tệp SVG đang mở trong trình vẽ (feature 011, T161, T162; FR-097, FR-098, FR-112, FR-113; contracts/svg-editor.md §3,
// §6): `DrawDoc` của @mat/svg-edit, ngăn hoàn tác 100 bước, đệm hộp bao, bản nền trên đĩa (văn bản, băm, dấu vân tay), cờ
// "Giữ bản đang sửa" sau khi tệp đổi bên ngoài (lần Lưu sau phải hỏi trước khi ghi đè). Không DOM. Lưu: tuần tự hóa chuẩn tắc
// rồi `project_write` so băm lúc nạp (ghi tạm rồi đổi tên ở Rust); khác thì "conflict", không bao giờ ghi đè im lặng.
import {
  CommandError,
  SVG_MAX_BYTES,
  UndoStack,
  parseDrawDoc,
  serialize,
  utf8Length,
  type Command,
  type DrawDoc,
  type NodeId,
  type ParseReport,
  type TextMetrics,
} from '@mat/svg-edit';
import type { Fingerprint, Platform, WriteFailure } from '../../platform/types.ts';
import { BoxCache } from './boxes.ts';

export type SessionIo = Pick<Platform, 'read' | 'write' | 'fingerprint'>;

export type OpenFailure =
  | { code: 'missing' | 'bad-path' | 'too-large' | 'bad-utf8' }
  | { code: 'SVG_LIMIT' | 'SVG_PARSE' | 'SVG_UNSAFE'; message: string };

export type SaveOutcome =
  | { status: 'saved'; hash: string }
  /** Tệp trên đĩa khác bản đã nạp (hoặc người dùng đã chọn Giữ): hỏi trước khi ghi đè. */
  | { status: 'conflict'; disk: Fingerprint | null }
  | { status: 'error'; error: WriteFailure | 'too-large'; detail?: string };

export interface ApplyResult {
  ok: boolean;
  targets: NodeId[];
  /** Lý do từ chối (lệnh vượt giới hạn, ngoài allowlist, trong khối giữ nguyên…). */
  error?: CommandError;
}

/** Đo chữ (trình duyệt: canvas 2D); vắng thì ước tính của @mat/svg-edit. */
export type MeasureText = (
  text: string,
  font: { size: number; family: string; weight: string; style: string },
) => TextMetrics;

export interface SessionOptions {
  uid?: () => string;
  measure?: MeasureText;
  now?: () => number;
}

export class SvgSession {
  doc: DrawDoc;
  undo: UndoStack;
  readonly boxes: BoxCache;
  report: ParseReport | null;
  /** Bản trên đĩa lúc nạp hoặc lưu gần nhất (null: tệp mới chưa có trên đĩa). */
  base: { text: string; hash: string | null; disk: Fingerprint | null };
  /** Người dùng chọn "Giữ bản đang sửa" khi tệp đổi bên ngoài: lần Lưu sau hỏi trước khi ghi đè. */
  externalKept: Fingerprint | null = null;
  /** Có thay đổi chưa lưu. */
  dirty: boolean;
  private textCache: { version: number; text: string } | null = null;
  private readonly now: () => number;
  /** Lần áp lệnh gần nhất (ms), cho gộp gõ chữ 1,5 s. */
  lastApply = 0;

  readonly rel: string;
  private readonly opts: SessionOptions;

  private constructor(
    rel: string,
    doc: DrawDoc,
    report: ParseReport | null,
    base: { text: string; hash: string | null; disk: Fingerprint | null },
    opts: SessionOptions,
  ) {
    this.rel = rel;
    this.opts = opts;
    this.doc = doc;
    this.undo = new UndoStack(doc);
    this.report = report;
    this.base = base;
    this.dirty = base.hash === null;
    this.now = opts.now ?? (() => Date.now());
    this.boxes = new BoxCache(doc, opts.measure ? { measure: opts.measure } : {});
  }

  /** Mở tệp trên đĩa. */
  static async open(
    io: SessionIo,
    rel: string,
    opts: SessionOptions = {},
  ): Promise<{ ok: true; session: SvgSession } | { ok: false; error: OpenFailure }> {
    const r = await io.read(rel);
    if (!('text' in r)) return { ok: false, error: { code: r.error } };
    const fp = await io.fingerprint(rel);
    return SvgSession.fromText(
      rel,
      r.text,
      { text: r.text, hash: r.hash, disk: 'hash' in fp ? fp : null },
      opts,
    );
  }

  /** Tài liệu từ văn bản (tệp mới: `base.hash` null; khôi phục bản tự lưu: `base` là bản trên đĩa). */
  static fromText(
    rel: string,
    text: string,
    base: { text: string; hash: string | null; disk: Fingerprint | null },
    opts: SessionOptions = {},
  ): { ok: true; session: SvgSession } | { ok: false; error: OpenFailure } {
    const p = parseDrawDoc(text, opts.uid ? { uid: opts.uid } : {});
    if (!p.ok) return { ok: false, error: { code: p.code, message: p.message } };
    const s = new SvgSession(rel, p.doc, p.report, base, opts);
    if (text !== base.text) s.dirty = true;
    return { ok: true, session: s };
  }

  /** Văn bản tuần tự hóa chuẩn tắc (đệm theo `doc.version`). */
  text(): string {
    if (this.textCache?.version !== this.doc.version)
      this.textCache = { version: this.doc.version, text: serialize(this.doc) };
    return this.textCache.text;
  }

  /** Áp một thao tác người dùng (lệnh hoặc lô) thành một bước hoàn tác; lệnh bị từ chối không đổi gì. */
  apply(cmd: Command, opts: { time?: number } = {}): ApplyResult {
    try {
      const targets = this.undo.push(cmd, opts);
      this.boxes.invalidateFor(cmd);
      this.dirty = true;
      this.lastApply = this.now();
      return { ok: true, targets };
    } catch (e) {
      if (e instanceof CommandError) return { ok: false, targets: [], error: e };
      throw e;
    }
  }

  /** Thả chuột, nhả phím: lệnh sau không gộp vào bước hiện tại. */
  endGesture(): void {
    this.undo.endGesture();
  }

  undoStep(): NodeId[] | null {
    const t = this.undo.undo();
    if (t) this.afterHistory();
    return t;
  }

  redoStep(): NodeId[] | null {
    const t = this.undo.redo();
    if (t) this.afterHistory();
    return t;
  }

  private afterHistory(): void {
    this.boxes.clear();
    // hoàn tác về đúng bản trên đĩa thì hết dấu chưa lưu
    this.dirty = this.base.hash === null || this.text() !== this.base.text;
  }

  /** Lưu: tuần tự hóa, ghi khi tệp trên đĩa vẫn như lúc nạp (hoặc `force` sau khi người dùng đồng ý ghi đè). */
  async save(io: SessionIo, opts: { force?: boolean } = {}): Promise<SaveOutcome> {
    const text = this.text();
    if (utf8Length(text) > SVG_MAX_BYTES) return { status: 'error', error: 'too-large' };
    if (this.externalKept && !opts.force) return { status: 'conflict', disk: this.externalKept };
    const r = await io.write(this.rel, text, this.base.hash, opts.force === true);
    if ('error' in r) {
      if (r.error === 'changed') {
        const fp = await io.fingerprint(this.rel);
        return { status: 'conflict', disk: 'hash' in fp ? fp : null };
      }
      return r.detail === undefined
        ? { status: 'error', error: r.error }
        : { status: 'error', error: r.error, detail: r.detail };
    }
    const fp = await io.fingerprint(this.rel);
    this.base = { text, hash: r.hash, disk: 'hash' in fp ? fp : null };
    this.externalKept = null;
    this.dirty = this.text() !== text;
    this.undo.endGesture();
    return { status: 'saved', hash: r.hash };
  }

  /** "Nạp lại từ đĩa": tài liệu mới từ bản trên đĩa, lịch sử hoàn tác bị xóa (T007 quyết định 8). */
  reload(text: string, hash: string, disk: Fingerprint | null): OpenFailure | null {
    const p = parseDrawDoc(text, this.opts.uid ? { uid: this.opts.uid } : {});
    if (!p.ok) return { code: p.code, message: p.message };
    this.doc = p.doc;
    this.report = p.report;
    this.undo = new UndoStack(p.doc);
    this.boxes.reset(p.doc);
    this.textCache = null;
    this.base = { text, hash, disk };
    this.externalKept = null;
    this.dirty = false;
    return null;
  }

  /** "Giữ bản đang sửa": nhớ bản trên đĩa để lần Lưu sau hỏi trước khi ghi đè. */
  keepExternal(disk: Fingerprint | null): void {
    this.externalKept = disk ?? { mtimeMs: 0, size: 0, hash: '' };
  }

  /** Số phần tử, độ sâu, cỡ (thanh thông tin). */
  stats(): { nodes: number; bytes: number } {
    return { nodes: this.doc.elementCount, bytes: utf8Length(this.text()) };
  }
}
