// Feature 037: chuyển loại widget cũ (stat-tile) sang loại hợp nhất (card) khi Studio mở project.
import { describe, expect, it } from 'vitest';
import { isLegacyWidget, upgradeLegacyItem, upgradeLegacyWidgets } from './widget-aliases.ts';

describe('upgradeLegacyWidgets', () => {
  const tile = {
    id: 't1',
    type: 'widget' as const,
    widget: 'stat-tile',
    props: { label: 'Nhiệt độ', color: 'rose', icon: 'thermometer', sparkline: true },
    tags: { value: 'T1', alarm: 'A1' },
  };
  it('stat-tile thành card nền đặc, giữ màu, biểu tượng, khe Tag', () => {
    expect(isLegacyWidget('stat-tile')).toBe(true);
    expect(isLegacyWidget('card')).toBe(false);
    expect(upgradeLegacyItem(tile)).toEqual({
      id: 't1',
      type: 'widget',
      widget: 'card',
      props: {
        fill: 'solid',
        fontSize: 'l',
        statusText: true,
        accent: 'rose',
        label: 'Nhiệt độ',
        icon: 'thermometer',
        sparkline: true,
      },
      tags: { value: 'T1', alarm: 'A1' },
    });
  });
  it('màu vắng thì teal (mặc định cũ); statusText đặt tay được giữ', () => {
    const r = upgradeLegacyItem({ ...tile, props: { statusText: false } });
    expect(r.props).toEqual({ fill: 'solid', fontSize: 'l', statusText: false, accent: 'teal' });
  });
  it('màu ngoài bảng (sửa tay) về teal', () => {
    expect(
      (
        upgradeLegacyItem({ ...tile, props: { color: '#ff0000' } }).props as Record<string, unknown>
      )['accent'],
    ).toBe('teal');
    expect(
      (upgradeLegacyItem({ ...tile, props: { color: 'pink' } }).props as Record<string, unknown>)[
        'accent'
      ],
    ).toBe('teal');
  });
  it('không có gì đổi thì trả null; item khác giữ nguyên tham chiếu', () => {
    const card = { id: 'c', type: 'widget', widget: 'card' };
    const svg = { id: 's', type: 'svg' };
    expect(upgradeLegacyWidgets({ items: [card, svg] })).toBeNull();
    expect(upgradeLegacyWidgets({})).toBeNull();
    const r = upgradeLegacyWidgets({ id: 'm', items: [card, tile] })!;
    expect(r.items[0]).toBe(card);
    expect((r.items[1] as { widget: string }).widget).toBe('card');
  });
});
