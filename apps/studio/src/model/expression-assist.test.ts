// Trợ giúp gõ biểu thức (T182, FR-049, SC-015, R22): gợi ý tên Tag (một phần tên, không phân biệt hoa thường), tên hàm kèm
// cú pháp, tên bảng giá trị trong text(; kiểm sau 200 ms ngừng gõ; lỗi đúng span kèm lý do; xem trước kết quả. Chỉ dùng
// @mat/expression cho phần tính.
import { describe, expect, it } from 'vitest';
import {
  CHECK_DELAY_MS,
  DebouncedCheck,
  FUNCTIONS,
  TagIndex,
  checkExpression,
  highlight,
  previewExpression,
  suggest,
  type AssistContext,
  type AssistTag,
} from './expression-assist.ts';

const tag = (id: string, type: AssistTag['type'] = 'FLOAT32'): AssistTag => ({ id, type });

const TAGS: AssistTag[] = [
  tag('TANK01.LEVEL'),
  tag('TANK01.SP_HI'),
  tag('TANK02.LEVEL'),
  tag('PUMP01.STATE', 'UINT16'),
  tag('PUMP01.RUN', 'BOOL'),
  tag('MODE', 'STRING'),
  tag('ROTOR'),
  tag('DIFF', 'FLOAT64'),
];
const ctx = (extra: Partial<AssistContext> = {}): AssistContext => ({
  tags: TAGS,
  tables: ['TrangThaiBom', 'Mau'],
  target: 'FLOAT64',
  ...extra,
});
const idx = (extra: Partial<AssistContext> = {}) => new TagIndex(ctx(extra));

describe('suggest: tên Tag', () => {
  it('một phần tên, không phân biệt hoa thường: tank01.le → TANK01.LEVEL; khoảng thay là từ đang gõ', () => {
    const r = suggest(idx(), 'tank01.le', 9);
    expect(r[0]).toMatchObject({
      kind: 'tag',
      label: 'TANK01.LEVEL',
      insert: 'TANK01.LEVEL',
      range: [0, 9],
    });
    expect(r.map((s) => s.label)).not.toContain('TANK01.SP_HI');
  });

  it('khớp giữa tên; khớp đầu tên xếp trước; từ đang gõ ở giữa biểu thức', () => {
    const r = suggest(idx(), 'A + level', 9);
    expect(r.map((s) => s.label)).toEqual(['TANK01.LEVEL', 'TANK02.LEVEL']);
    expect(r[0]!.range).toEqual([4, 9]);
    const r2 = suggest(idx(), 'x * tan', 7);
    expect(r2.every((s) => s.label.startsWith('TANK'))).toBe(true);
  });

  it('caret giữa từ: lấy phần từ đầu từ tới caret, thay cả từ', () => {
    const r = suggest(idx(), 'tank0 + 1', 5);
    expect(r[0]!.range).toEqual([0, 5]);
  });

  it('chưa gõ gì, trong chuỗi chữ hay ngay sau số: không gợi ý', () => {
    expect(suggest(idx(), '', 0)).toEqual([]);
    expect(suggest(idx(), 'A + ', 4)).toEqual([]);
    expect(suggest(idx(), 'MODE == "TAN', 12)).toEqual([]);
    expect(suggest(idx(), '12', 2)).toEqual([]);
  });

  it('bỏ Tag đang sửa (tự tham chiếu là vòng) và giới hạn số gợi ý', () => {
    const r = suggest(idx({ self: 'DIFF' }), 'di', 2);
    expect(r.map((s) => s.label)).not.toContain('DIFF');
    const many = new TagIndex(ctx({ tags: Array.from({ length: 50 }, (_, i) => tag(`T${i}`)) }));
    expect(suggest(many, 't', 1, 8)).toHaveLength(8);
  });

  it('SC-015: 2.000 Tag, mỗi phím gợi ý ≤ 200 ms', () => {
    const tags = Array.from({ length: 2000 }, (_, i) => tag(`AREA${i % 40}.DEV${i}.PV`));
    const index = new TagIndex(ctx({ tags }));
    const src = 'area7.dev1';
    let worst = 0;
    for (let n = 1; n <= src.length; n++) {
      const t0 = performance.now();
      suggest(index, src.slice(0, n), n);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(200);
  });
});

describe('suggest: hàm và bảng giá trị', () => {
  it('hàm kèm cú pháp và mô tả; đủ 6 hàm của ngôn ngữ', () => {
    expect(FUNCTIONS.map((f) => f.name)).toEqual(['min', 'max', 'abs', 'round', 'clamp', 'text']);
    const r = suggest(idx(), 'cla', 3);
    expect(r[0]).toMatchObject({ kind: 'function', label: 'clamp', insert: 'clamp(' });
    expect(r[0]!.detail).toContain('clamp(x, lo, hi)');
  });

  it('trong text( tham số thứ hai: gợi ý tên bảng giá trị, không gợi ý Tag', () => {
    const src = 'text(PUMP01.STATE, tr';
    const r = suggest(idx(), src, src.length);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'table', label: 'TrangThaiBom', range: [19, 21] });
    // tham số thứ nhất vẫn là Tag
    const r1 = suggest(idx(), 'text(pump', 9);
    expect(r1[0]!.kind).toBe('tag');
  });

  it('tham số thứ hai của text sau khi đã gõ xong tham số thứ nhất có hàm lồng', () => {
    const src = 'text(round(PUMP01.STATE, 1), Ma';
    expect(suggest(idx(), src, src.length)[0]).toMatchObject({ kind: 'table', label: 'Mau' });
  });
});

describe('checkExpression: lỗi đúng span kèm lý do', () => {
  it('biểu thức đúng: không lỗi, trả danh sách Tag đầu vào', () => {
    const r = checkExpression('TANK01.LEVEL * 12.5 + TANK02.LEVEL', ctx());
    expect(r.problem).toBeNull();
    expect(r.inputs).toEqual(['TANK01.LEVEL', 'TANK02.LEVEL']);
  });

  it('tên Tag không có: span trên tên, lý do nêu tên', () => {
    const r = checkExpression('TANK9.LEVEL * 2', ctx());
    expect(r.problem).toMatchObject({ code: 'E_EXPR_UNKNOWN_TAG', span: [0, 11] });
    expect(r.problem!.message).toContain('TANK9.LEVEL');
  });

  it('cú pháp, hàm lạ, số tham số, bảng lạ, sai kiểu', () => {
    expect(checkExpression('(TANK01.LEVEL + 1', ctx()).problem).toMatchObject({
      code: 'E_EXPR_SYNTAX',
    });
    expect(checkExpression('sqrt(TANK01.LEVEL)', ctx()).problem).toMatchObject({
      code: 'E_EXPR_UNKNOWN_FUNC',
      span: [0, 4],
    });
    expect(checkExpression('abs(TANK01.LEVEL, 2)', ctx()).problem).toMatchObject({
      code: 'E_EXPR_ARITY',
    });
    expect(checkExpression('text(PUMP01.STATE, KhongCo)', ctx()).problem).toMatchObject({
      code: 'E_EXPR_UNKNOWN_TABLE',
      span: [19, 26],
    });
    const ty = checkExpression('MODE + 1', ctx());
    expect(ty.problem?.code).toBe('E_EXPR_TYPE');
    expect(ty.problem!.message.length).toBeGreaterThan(5);
  });

  it('kết quả sai kiểu của Tag đích (số cho Tag BOOL) là lỗi kiểu trên cả biểu thức', () => {
    const r = checkExpression('TANK01.LEVEL + 1', ctx({ target: 'BOOL' }));
    expect(r.problem).toMatchObject({ code: 'E_EXPR_TYPE', span: [0, 16] });
  });

  it('vòng tham chiếu: kèm đường vòng A → B → A, span cả biểu thức', () => {
    const c = ctx({
      tags: [...TAGS, tag('A', 'FLOAT64'), tag('B', 'FLOAT64')],
      self: 'A',
      calcs: [{ id: 'B', inputs: ['A'] }],
    });
    const r = checkExpression('B + 1', c);
    expect(r.problem).toMatchObject({ code: 'E_EXPR_CYCLE', span: [0, 5], cycle: ['A', 'B', 'A'] });
    expect(r.problem!.message).toContain('A → B → A');
  });

  it('tự tham chiếu là vòng; chuỗi quá 16 tầng là E_EXPR_DEPTH', () => {
    const self = checkExpression('A * 2', ctx({ tags: [...TAGS, tag('A', 'FLOAT64')], self: 'A' }));
    expect(self.problem).toMatchObject({ code: 'E_EXPR_CYCLE', cycle: ['A', 'A'] });
    const chain = Array.from({ length: 16 }, (_, i) => ({
      id: `C${i}`,
      inputs: i === 0 ? [] : [`C${i - 1}`],
    }));
    const deep = checkExpression('C15 + 1', {
      ...ctx({ tags: [...TAGS, tag('A', 'FLOAT64'), ...chain.map((c) => tag(c.id, 'FLOAT64'))] }),
      self: 'A',
      calcs: chain,
    });
    expect(deep.problem?.code).toBe('E_EXPR_DEPTH');
  });

  it('cảnh báo INT64 không chặn', () => {
    const r = checkExpression('BIG + 1', ctx({ tags: [...TAGS, tag('BIG', 'INT64')] }));
    expect(r.problem).toBeNull();
    expect(r.warnings[0]?.code).toBe('W_EXPR_INT64');
  });

  it('chỉ gọi bộ biên dịch của @mat/expression: đo ≤ 500 ms với biểu thức dài 1.000 ký tự', () => {
    const src = Array.from({ length: 100 }, () => 'TANK01.LEVEL')
      .join(' + ')
      .slice(0, 1000);
    const t0 = performance.now();
    checkExpression(src, ctx());
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('previewExpression', () => {
  const live = (m: Record<string, unknown>) => (id: string) =>
    id in m
      ? (m[id] as {
          value: number | boolean | string | null;
          quality: 'GOOD' | 'BAD' | 'UNCERTAIN';
          reason?: string;
        })
      : null;

  it('kết quả kèm giá trị từng đầu vào', () => {
    const r = previewExpression(
      'TANK01.LEVEL * 2 + TANK02.LEVEL',
      ctx(),
      live({
        'TANK01.LEVEL': { value: 21, quality: 'GOOD' },
        'TANK02.LEVEL': { value: 1, quality: 'GOOD' },
      }),
      [],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe('43');
    expect(r.quality).toBe('GOOD');
    expect(r.inputs.map((i) => [i.id, i.text, i.quality])).toEqual([
      ['TANK01.LEVEL', '21', 'GOOD'],
      ['TANK02.LEVEL', '1', 'GOOD'],
    ]);
  });

  it('đầu vào xấu: kết quả BAD kèm lý do tiếng Việt, không có giá trị', () => {
    const r = previewExpression(
      'TANK01.LEVEL * 2',
      ctx(),
      live({ 'TANK01.LEVEL': { value: null, quality: 'BAD', reason: 'TIMEOUT' } }),
      [],
    );
    expect(r.ok && r.quality).toBe('BAD');
    if (r.ok) {
      expect(r.value).toBeNull();
      expect(r.reason).toBe('đầu vào của biểu thức không tốt');
    }
  });

  it('đầu vào chưa có giá trị: BAD chưa có giá trị', () => {
    const r = previewExpression('TANK01.LEVEL * 2', ctx(), () => null, []);
    expect(r.ok && r.reason).toBe('chưa có giá trị');
  });

  it('text() tra bảng giá trị', () => {
    const r = previewExpression(
      'text(PUMP01.STATE, TrangThaiBom)',
      { ...ctx(), target: 'STRING' },
      live({ 'PUMP01.STATE': { value: 1, quality: 'GOOD' } }),
      [{ name: 'TrangThaiBom', entries: [{ value: 1, text: 'Chạy', color: '#2da44e' }] }],
    );
    expect(r.ok && r.value).toBe('Chạy');
  });

  it('biểu thức lỗi: trả lỗi, không tính', () => {
    const r = previewExpression('TANK9 + 1', ctx(), () => null, []);
    expect(r).toMatchObject({ ok: false, problem: { code: 'E_EXPR_UNKNOWN_TAG' } });
  });

  it('chia cho 0 là BAD với lý do', () => {
    const r = previewExpression(
      'TANK01.LEVEL / TANK02.LEVEL',
      ctx(),
      live({
        'TANK01.LEVEL': { value: 1, quality: 'GOOD' },
        'TANK02.LEVEL': { value: 0, quality: 'GOOD' },
      }),
      [],
    );
    expect(r.ok && r.quality).toBe('BAD');
    expect(r.ok && r.reason).toBe('phép chia cho 0');
  });
});

describe('DebouncedCheck: kiểm sau 200 ms ngừng gõ', () => {
  function fakeTimers() {
    let now = 0;
    const q: { at: number; fn: () => void; id: number }[] = [];
    let n = 0;
    return {
      set: (fn: () => void, ms: number) => {
        q.push({ at: now + ms, fn, id: ++n });
        return n;
      },
      clear: (id: unknown) => {
        const i = q.findIndex((x) => x.id === id);
        if (i >= 0) q.splice(i, 1);
      },
      advance: (ms: number) => {
        now += ms;
        for (const x of q.filter((e) => e.at <= now).sort((a, b) => a.at - b.at)) {
          q.splice(q.indexOf(x), 1);
          x.fn();
        }
      },
    };
  }

  it('mỗi phím đặt lại hẹn giờ; chỉ kiểm bản cuối sau CHECK_DELAY_MS', () => {
    expect(CHECK_DELAY_MS).toBe(200);
    const ft = fakeTimers();
    const seen: string[] = [];
    const d = new DebouncedCheck((src) => seen.push(src), {
      setTimer: ft.set,
      clearTimer: ft.clear,
    });
    d.input('T');
    ft.advance(150);
    d.input('TA');
    ft.advance(150);
    expect(seen).toEqual([]);
    ft.advance(60);
    expect(seen).toEqual(['TA']);
  });

  it('flush kiểm ngay (rời ô, Enter) và hủy hẹn giờ', () => {
    const ft = fakeTimers();
    const seen: string[] = [];
    const d = new DebouncedCheck((src) => seen.push(src), {
      setTimer: ft.set,
      clearTimer: ft.clear,
    });
    d.input('A');
    d.flush();
    ft.advance(500);
    expect(seen).toEqual(['A']);
  });

  it('dispose hủy kiểm đang chờ', () => {
    const ft = fakeTimers();
    const seen: string[] = [];
    const d = new DebouncedCheck((src) => seen.push(src), {
      setTimer: ft.set,
      clearTimer: ft.clear,
    });
    d.input('A');
    d.dispose();
    ft.advance(500);
    expect(seen).toEqual([]);
  });
});

describe('highlight: tô màu cú pháp và gạch lỗi', () => {
  it('chia theo loại token, giữ nguyên chữ (kể cả khoảng trắng và xuống dòng)', () => {
    const src = 'text(PUMP01.STATE, TrangThaiBom)  + 12\n';
    const segs = highlight(src, null);
    expect(segs.map((s) => s.text).join('')).toBe(src);
    expect(segs.find((s) => s.text === 'text')?.kind).toBe('function');
    expect(segs.find((s) => s.text === 'PUMP01.STATE')?.kind).toBe('tag');
    expect(segs.find((s) => s.text === '12')?.kind).toBe('number');
    expect(segs.every((s) => !s.error)).toBe(true);
  });

  it('gạch dưới đúng span; span rỗng ở cuối gạch ký tự cuối', () => {
    const segs = highlight('TANK9.LEVEL * 2', [0, 11]);
    expect(
      segs
        .filter((s) => s.error)
        .map((s) => s.text)
        .join(''),
    ).toBe('TANK9.LEVEL');
    const end = highlight('A +', [3, 3]);
    expect(
      end
        .filter((s) => s.error)
        .map((s) => s.text)
        .join(''),
    ).toBe('+');
  });
});
