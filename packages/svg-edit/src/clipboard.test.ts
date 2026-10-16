// T155 (SC-034; FR-109): sao chép/dán trong và giữa tài liệu (uid mới, id trùng đổi `-copy`, `url(#id)` cập nhật, defs
// cần thiết đi kèm), dán văn bản SVG qua bộ nhập của feature 008 (allowlist trên DOM đã parse), giới hạn 5 MB kiểm
// TRƯỚC khi phân tích, 10 SVG độc dán ⇒ 100 % loại đúng và báo.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAllowlisted } from '@mat/svg-import';
import { bbox } from './bbox.ts';
import { copyNodes, duplicateNodes, pasteClip, pasteSvgText } from './clipboard.ts';
import { applyCommand } from './command.ts';
import { documentOrder, findById, type DrawDoc } from './node.ts';
import { serialize } from './serialize.ts';
import { body, byId, expectBox, NS } from './test-helpers.ts';

const uidsOf = (doc: DrawDoc) =>
  documentOrder(doc)
    .map((id) => doc.nodes.get(id)!.attrs.get('data-mat-uid'))
    .filter((u): u is string => u !== undefined);

describe('sao chép trong tài liệu', () => {
  const SRC =
    '<defs><linearGradient id="lg"><stop offset="0" stop-color="#fff"/></linearGradient>' +
    '<clipPath id="cp"><rect width="5" height="5"/></clipPath></defs>' +
    '<g id="g" data-mat-uid="el_gggggggggg" transform="translate(10 0)">' +
    '<rect id="r" data-mat-uid="el_rrrrrrrrrr" width="10" height="10" fill="url(#lg)" clip-path="url(#cp)"/>' +
    '<use id="u" data-mat-uid="el_uuuuuuuuuu" href="#r"/></g>';

  it('dán lại: uid mới, id đổi -copy, tham chiếu trong cây con cập nhật, defs dùng lại (không nhân đôi)', () => {
    const doc = body(SRC);
    const clip = copyNodes(doc, [byId(doc, 'g')]);
    const r = pasteClip(doc, clip);
    applyCommand(doc, r.batch);
    const uids = uidsOf(doc);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.length).toBe(6);
    expect(findById(doc, 'g-copy')).not.toBeNull();
    expect(doc.nodes.get(byId(doc, 'u-copy'))!.attrs.get('href')).toBe('#r-copy');
    expect(doc.nodes.get(byId(doc, 'r-copy'))!.attrs.get('fill')).toBe('url(#lg)');
    expect(serialize(doc).split('<linearGradient').length).toBe(2);
    expect(r.uidMap.get('el_rrrrrrrrrr')).toMatch(/^el_/);
    expect(r.uidMap.get('el_rrrrrrrrrr')).not.toBe('el_rrrrrrrrrr');
    // vị trí giữ (cha khác: gốc)
    const a = bbox(doc, byId(doc, 'r'))!;
    expectBox(expect, bbox(doc, byId(doc, 'r-copy')), a.x, a.y, a.width, a.height);
  });

  it('dán hai lần: -copy, -copy-2', () => {
    const doc = body(SRC);
    const clip = copyNodes(doc, [byId(doc, 'r')]);
    applyCommand(doc, pasteClip(doc, clip).batch);
    applyCommand(doc, pasteClip(doc, clip).batch);
    expect(findById(doc, 'r-copy')).not.toBeNull();
    expect(findById(doc, 'r-copy-2')).not.toBeNull();
  });

  it('giữa hai tài liệu: defs cần thiết đi kèm; id trùng với tài liệu đích được đổi và url(#id) cập nhật', () => {
    const src = body(SRC);
    const dst = body(
      '<defs><linearGradient id="lg"><stop offset="1" stop-color="#000"/></linearGradient></defs><rect id="other"/>',
      9,
    );
    const r = pasteClip(dst, copyNodes(src, [byId(src, 'r')]));
    applyCommand(dst, r.batch);
    const pasted = dst.nodes.get(r.ids[0])!;
    // lg khác nội dung: đổi tên; cp chưa có: chép nguyên
    expect(pasted.attrs.get('fill')).toBe('url(#lg-copy)');
    expect(pasted.attrs.get('clip-path')).toBe('url(#cp)');
    expect(findById(dst, 'lg-copy')).not.toBeNull();
    expect(findById(dst, 'cp')).not.toBeNull();
    expect(serialize(dst)).toContain('stop-color="#fff"');
  });

  it('tài liệu đích chưa có defs: tạo defs', () => {
    const src = body(SRC);
    const dst = body('<rect id="x"/>', 9);
    applyCommand(dst, pasteClip(dst, copyNodes(src, [byId(src, 'r')])).batch);
    expect(serialize(dst)).toMatch(/<defs>.*<linearGradient id="lg"/);
  });

  it('nhân bản (Ctrl+D): lệch 20, nằm trên bản gốc', () => {
    const doc = body('<rect id="a" x="0" y="0" width="5" height="5"/><rect id="b"/>');
    const r = duplicateNodes(doc, [byId(doc, 'a')]);
    applyCommand(doc, r.batch);
    expect(doc.nodes.get(r.ids[0])!.attrs.get('x')).toBe('20');
    const order = documentOrder(doc).map((i) => doc.nodes.get(i)!.attrs.get('id'));
    expect(order.indexOf('a-copy')).toBe(order.indexOf('a') + 1);
  });

  it('hoàn tác dán: về đúng byte', () => {
    const doc = body(SRC);
    const before = serialize(doc);
    const inv = applyCommand(doc, pasteClip(doc, copyNodes(doc, [byId(doc, 'g')])).batch);
    applyCommand(doc, inv);
    expect(serialize(doc)).toBe(before);
  });
});

describe('dán văn bản SVG từ clipboard hệ thống', () => {
  it('SVG sạch: dán, uid mới, báo 0 phần tử loại', () => {
    const doc = body('<rect id="a"/>');
    const r = pasteSvgText(
      doc,
      `<svg ${NS} viewBox="0 0 10 10"><rect width="3" height="3" fill="#f00"/><circle r="2"/></svg>`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    applyCommand(doc, r.batch);
    expect(r.ids.length).toBe(2);
    expect(r.report.removedElements).toBe(0);
    expect(uidsOf(doc).length).toBe(2);
  });

  it('> 5 MB bị từ chối TRƯỚC khi phân tích: XML hỏng vẫn báo SVG_LIMIT, và nhanh', () => {
    const doc = body('');
    const big = `<svg ${NS}><g>` + '<'.repeat(5 * 1024 * 1024); // không phải XML hợp lệ
    const t0 = performance.now();
    const r = pasteSvgText(doc, big);
    expect(r).toMatchObject({ ok: false, code: 'SVG_LIMIT' });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('5 MB tính theo byte UTF-8 (chữ có dấu)', () => {
    const doc = body('');
    const r = pasteSvgText(doc, `<svg ${NS}><text>` + 'ệ'.repeat(1_800_000) + '</text></svg>');
    expect(r).toMatchObject({ ok: false, code: 'SVG_LIMIT' });
  });

  it('văn bản không phải SVG: không dán', () => {
    expect(pasteSvgText(body(''), 'hello <b>x</b>')).toMatchObject({
      ok: false,
      code: 'SVG_PARSE',
    });
  });

  it('kết quả rỗng sau lọc: không dán', () => {
    expect(
      pasteSvgText(body(''), `<svg ${NS} viewBox="0 0 9 9"><script>alert(1)</script></svg>`),
    ).toMatchObject({ ok: false, code: 'SVG_EMPTY' });
  });
});

describe('10 SVG độc (tests/svg-editor-fixtures/malicious): 100 % loại đúng và báo', () => {
  const dir = resolve(__dirname, '../../../tests/svg-editor-fixtures/malicious');
  const expectations = JSON.parse(readFileSync(resolve(dir, 'expect.json'), 'utf8')) as Record<
    string,
    { outcome: 'sanitized' | 'rejected'; code?: string; forbid?: string[]; reported?: string[] }
  >;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.svg'))
    .sort();

  it('đủ 10 tệp, mỗi tệp có mong đợi', () => {
    expect(files.length).toBe(10);
    for (const f of files) expect(expectations[f], f).toBeDefined();
  });

  it.each(files)(
    '%s',
    (f) => {
      const text = readFileSync(resolve(dir, f), 'utf8');
      const want = expectations[f];
      const doc = body('<rect id="keep"/>');
      const r = pasteSvgText(doc, text);
      if (want.outcome === 'rejected') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(want.code);
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      applyCommand(doc, r.batch);
      const out = serialize(doc);
      for (const bad of want.forbid ?? [])
        expect(out.toLowerCase()).not.toContain(bad.toLowerCase());
      assertAllowlisted(out);
      expect(r.report.removedElements + r.report.removedAttributes).toBeGreaterThan(0);
      const codes = r.report.removed.map((x) => x.code);
      for (const c of want.reported ?? []) expect(codes).toContain(c);
    },
    60_000,
  ); // m08: 20.001 phần tử qua bộ nhập (vài giây khi máy bận)
});
