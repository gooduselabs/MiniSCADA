// Mọi thứ của danh mục widget mà Studio hiện ra đều có chữ tiếng Việt (feature 014): tên widget, nhãn thuộc tính (riêng
// hoặc dùng chung), lựa chọn của thuộc tính enum, khe Tag. Không để lộ tên kỹ thuật như "highLimit" hay "teal".
import { WIDGET_CATALOG } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { hasKey } from './index.ts';

describe('nhãn tiếng Việt của danh mục widget', () => {
  it('tên widget, nhãn thuộc tính, lựa chọn enum, khe Tag', () => {
    const missing: string[] = [];
    for (const w of WIDGET_CATALOG.widgets) {
      if (!hasKey(w.label)) missing.push(w.label);
      for (const p of w.props) {
        const own = `widget.${w.id}.prop.${p.name}`;
        if (!hasKey(own) && !hasKey(`wprop.${p.name}`)) missing.push(own);
        if (p.kind === 'enum')
          for (const o of p.options ?? [])
            if (!hasKey(`${own}.${o}`) && !hasKey(`wopt.${o}`)) missing.push(`${own}.${o}`);
      }
      for (const s of w.slots)
        if (!hasKey(`widget.${w.id}.slot.${s.name}`) && !hasKey(`wslot.${s.name}`))
          missing.push(`widget.${w.id}.slot.${s.name}`);
    }
    expect(missing).toEqual([]);
  });
});
