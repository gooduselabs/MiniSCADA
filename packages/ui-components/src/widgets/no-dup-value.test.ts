// Feature 044: mỗi widget chỉ hiện giá trị chính MỘT lần theo mặc định (người dùng: "62%" và "62.0 %" cùng lúc trên
// Mức chất lỏng/Thanh tiến độ). Duyệt mọi widget của danh mục với mặc định, từng lựa chọn của thuộc tính enum hiển thị
// và preset kiểu Studio; giá trị mẫu 62 trên thang 0–100 nên phần trăm tự tính cũng là 62: số 62 xuất hiện ≥ 2 lần
// trong chữ nhìn thấy (bỏ bảng sr-only cho trình đọc màn hình) là lặp.
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../../../../schemas/widgets.catalog.json' with { type: 'json' };
import { cleanup, fakeECharts, makeSource, mount, tagInfo, widgetItem } from './test-util.ts';
import { WIDGET_ELEMENTS } from './register.ts';

afterEach(cleanup);

interface PropSpec {
  name: string;
  kind: string;
  options?: string[];
}
interface WidgetSpec {
  id: string;
  slots: Array<{ name: string; required: boolean; multi: boolean }>;
  props: PropSpec[];
}

/** Preset của Studio (apps/studio/src/model/widget-presets.ts), chép phần ảnh hưởng hiển thị số. */
const STUDIO_PRESETS: Record<string, Record<string, unknown>> = {
  card: { fill: 'soft', accent: 'blue', flash: true, fontSize: 'l', trend: true, sparkline: true },
  level: { style: 'tank', wave: true },
  progress: { shape: 'ring' },
  equipment: { kind: 'pump' },
};

/**
 * Ngoại lệ có chủ đích (props tường minh của người dùng, không phải mặc định):
 * - level.showRaw / progress.showValue = true: người dùng chọn hiện thêm giá trị thô (62 % và 62.0 m).
 */
const EXPLICIT_BOTH: Record<string, Record<string, unknown>> = {
  level: { showRaw: true },
  progress: { showValue: true },
};

/** Chữ nhìn thấy trong Shadow DOM (cả shadow lồng), bỏ <style> và .sr-only. */
function visibleText(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return `${n.textContent ?? ''} `;
  if (n instanceof Element) {
    if (n.tagName === 'STYLE' || n.classList.contains('sr-only')) return '';
    let s = n.shadowRoot ? visibleText(n.shadowRoot) : '';
    n.childNodes.forEach((c) => (s += visibleText(c)));
    return s;
  }
  let s = '';
  n.childNodes.forEach((c) => (s += visibleText(c)));
  return s;
}

const count62 = (s: string): number => (s.match(/(?<![\d.,])62(?:[.,]\d+)?(?!\d)/g) ?? []).length;

async function render(
  w: WidgetSpec,
  unit: string,
  props: Record<string, unknown>,
  statusSame = false,
) {
  const tags: Record<string, string | string[]> = {};
  for (const s of w.slots)
    if (s.required || (statusSame && s.name === 'status')) tags[s.name] = s.multi ? ['v'] : 'v';
  const src = makeSource([tagInfo('v', { unit, min: 0, max: 100, access: 'RW' })]);
  src.set('v', { value: 62, quality: 'GOOD' });
  fakeECharts();
  const el = await mount(widgetItem(w.id, tags as never, props as never), src);
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const text = visibleText(el.shadowRoot!).replace(/\s+/g, ' ').trim();
  cleanup();
  return text;
}

const widgets = (catalog as unknown as { widgets: WidgetSpec[] }).widgets.filter(
  (w) => WIDGET_ELEMENTS[w.id],
);

describe('044: giá trị chính hiện một lần', () => {
  it.each(widgets.map((w) => [w.id, w] as const))('%s', async (_id, w) => {
    const variants: Array<Record<string, unknown>> = [{}, STUDIO_PRESETS[w.id] ?? {}];
    for (const p of w.props)
      if (
        p.kind === 'enum' &&
        p.options &&
        ['shape', 'style', 'orientation', 'fill'].includes(p.name)
      )
        for (const o of p.options) variants.push({ ...(STUDIO_PRESETS[w.id] ?? {}), [p.name]: o });
    for (const unit of ['%', 'm³', ''])
      for (const props of variants) {
        const text = await render(w, unit, props);
        expect(
          count62(text),
          `${w.id} unit=${unit} ${JSON.stringify(props)}: "${text}"`,
        ).toBeLessThanOrEqual(1);
      }
  });

  it('khe Trạng thái gắn cùng Tag với giá trị: không lặp số (card, stat-tile)', async () => {
    for (const id of ['card', 'stat-tile']) {
      const w = widgets.find((x) => x.id === id)!;
      const text = await render(w, 'm³', {}, true);
      expect(count62(text), `${id}: "${text}"`).toBe(1);
    }
  });

  it('tùy chọn tường minh "hiện thêm giá trị thô" vẫn được tôn trọng (project cũ, ngoại lệ có chủ đích)', async () => {
    for (const [id, props] of Object.entries(EXPLICIT_BOTH)) {
      const w = widgets.find((x) => x.id === id)!;
      const text = await render(w, 'm³', props);
      expect(text, id).toContain('62.0');
      expect(text, id).toMatch(/62 ?%/);
      // Đơn vị đã là % trên thang 0–100: giá trị thô trùng phần trăm, không lặp dù bật.
      expect(count62(await render(w, '%', props)), id).toBe(1);
    }
  });
});
