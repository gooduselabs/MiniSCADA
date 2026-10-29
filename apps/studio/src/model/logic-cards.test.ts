// Thẻ luật ⇄ logic.json (feature 043): đọc rồi ghi lại không đổi gì (mọi project mẫu, vector logic, fixture), mẫu tạo
// luật hợp lệ khi đã chọn Tag, sửa từng ô trong câu chỉ đổi đúng phần đó.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LogicDoc, TagV1 } from '@mat/project-schema';
import {
  TEMPLATES,
  addFromTemplate,
  duplicateRule,
  formatCondition,
  parseCondition,
  readCards,
  removeRule,
  reorderRule,
  writeCounterCard,
  writeRuleCard,
  writeTimerCard,
  type RuleCard,
  type TimeTrigger,
} from './logic-cards.ts';
import { checkLogicDoc } from './logic-doc.ts';
import { LOGIC_TAGS, pumpLogic } from './logic-fixtures.ts';

const REPO = resolve(__dirname, '../../../..');

function sampleDocs(): Array<[string, LogicDoc, TagV1[]]> {
  const out: Array<[string, LogicDoc, TagV1[]]> = [['fixture pumpLogic', pumpLogic(), LOGIC_TAGS]];
  const pdir = resolve(REPO, 'projects');
  for (const p of readdirSync(pdir)) {
    const f = resolve(pdir, p, 'logic.json');
    if (!existsSync(f)) continue;
    const tf = resolve(pdir, p, 'tags.json');
    const tags = existsSync(tf)
      ? ((JSON.parse(readFileSync(tf, 'utf8')) as { tags?: TagV1[] }).tags ?? [])
      : [];
    out.push([`projects/${p}`, JSON.parse(readFileSync(f, 'utf8')) as LogicDoc, tags]);
  }
  const vdir = resolve(REPO, 'tests/logic-vectors');
  for (const f of readdirSync(vdir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(resolve(vdir, f), 'utf8')) as {
      cases: Array<{ id: string; doc: LogicDoc }>;
    };
    for (const c of j.cases) out.push([`vector ${c.id}`, c.doc, []]);
  }
  return out;
}

describe('round-trip thẻ ⇄ logic.json', () => {
  const samples = sampleDocs();
  it('có project mẫu và vector', () => {
    expect(samples.some(([n]) => n.startsWith('projects/'))).toBe(true);
    expect(samples.length).toBeGreaterThan(20);
  });
  for (const [name, doc, tags] of samples)
    it(`ghi lại mọi thẻ không đổi gì: ${name}`, () => {
      let cur = doc;
      for (const c of readCards(doc)) {
        if (c.kind === 'rule') cur = writeRuleCard(cur, c, tags);
        else if (c.kind === 'timer') cur = writeTimerCard(cur, c);
        else if (c.kind === 'counter') cur = writeCounterCard(cur, c);
      }
      expect(cur).toEqual(doc);
    });
});

describe('điều kiện dạng câu', () => {
  it('đọc so sánh, bật/tắt, VÀ/HOẶC, hằng bên trái', () => {
    expect(parseCondition('TANK01.LEVEL > 80')).toEqual({
      join: 'and',
      clauses: [{ tag: 'TANK01.LEVEL', test: 'cmp', op: '>', rhs: { kind: 'const', v: 80 } }],
    });
    expect(parseCondition('RUN && !(FAULT)')?.clauses).toEqual([
      { tag: 'RUN', test: 'on' },
      { tag: 'FAULT', test: 'off' },
    ]);
    expect(parseCondition('A == 1 || B == "x" || C != D')?.join).toBe('or');
    expect(parseCondition('5 < LEVEL')?.clauses[0]).toEqual({
      tag: 'LEVEL',
      test: 'cmp',
      op: '>',
      rhs: { kind: 'const', v: 5 },
    });
    expect(parseCondition('LEVEL > -3')?.clauses[0]).toMatchObject({ rhs: { v: -3 } });
  });
  it('biểu thức phức tạp là nâng cao', () => {
    expect(parseCondition('A && B || C')).toBeNull();
    expect(parseCondition('LEVEL * 2 > 3')).toBeNull();
    expect(parseCondition('abs(X) > 1')).toBeNull();
  });
  it('còn ô Tag trống thì chưa viết biểu thức', () => {
    expect(formatCondition('and', [{ tag: '', test: 'on' }])).toBe('');
    expect(
      formatCondition('and', [
        { tag: 'A', test: 'on' },
        { tag: 'B', test: 'cmp', op: '>=', rhs: { kind: 'const', v: 2.5 } },
      ]),
    ).toBe('A && B >= 2.5');
  });
});

const TAGS: TagV1[] = [
  ...LOGIC_TAGS,
  {
    id: 'OVEN.TEMP',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'plc1', address: 'HR1' },
  },
  {
    id: 'FAN.RUN',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'plc1', address: 'C1' },
  },
  { id: 'INT.FLAG', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
  { id: 'INT.N', kind: 'internal', type: 'INT32', access: 'RW', initial: 0 },
] as unknown as TagV1[];

const errorsOf = (doc: LogicDoc) => checkLogicDoc(doc, { tags: TAGS }).errors;
const ruleCard = (doc: LogicDoc, id: string) =>
  readCards(doc).find((c) => c.kind === 'rule' && c.id === id) as RuleCard;

describe('mẫu và sửa ô', () => {
  it('Vượt ngưỡng: chọn Tag xong là luật hợp lệ, Tag thiết bị đi qua writes tự tạo', () => {
    const r = addFromTemplate({ schemaVersion: '1.0.0' }, 'threshold', 'Quạt', TAGS);
    let card = ruleCard(r.doc, r.id);
    card = {
      ...card,
      trigger: {
        ...r.drafts[r.id]!,
        clauses: [{ ...r.drafts[r.id]!.clauses[0]!, tag: 'OVEN.TEMP' }],
      },
      rise: [{ verb: 'on', tag: 'FAN.RUN' }],
    } as RuleCard;
    const doc = writeRuleCard(r.doc, card, TAGS);
    expect(doc.rules![0]).toMatchObject({
      when: 'OVEN.TEMP > 80',
      hold: 5000,
      onRise: [{ do: 'write', write: 'wa_fan_run', value: true }],
    });
    expect(doc.writes).toEqual([
      {
        id: 'wa_fan_run',
        tag: 'FAN.RUN',
        allowed: { values: [true, false] },
        minIntervalMs: 1000,
        maxPerHour: 60,
      },
    ]);
    expect(errorsOf(doc)).toEqual([]);
    // đổi sang Tag nội bộ: writes tự tạo bị dọn
    const c2 = ruleCard(doc, r.id);
    const doc2 = writeRuleCard(doc, { ...c2, rise: [{ verb: 'on', tag: 'INT.FLAG' }] }, TAGS);
    expect(doc2.writes).toEqual([]);
    expect(doc2.rules![0]!.onRise).toEqual([{ do: 'setTag', tag: 'INT.FLAG', value: true }]);
  });

  it('Đến giờ: Lịch một phút, đổi giờ chỉ đổi khung, đọc lại là thẻ Theo giờ', () => {
    const r = addFromTemplate({ schemaVersion: '1.0.0' }, 'at', 'Bơm 7h', TAGS);
    let card = ruleCard(r.doc, r.id);
    expect(card.trigger).toMatchObject({ type: 'time', from: '07:00', at: true });
    card = { ...card, rise: [{ verb: 'on', tag: 'INT.FLAG' }] };
    let doc = writeRuleCard(r.doc, card, TAGS);
    expect(doc.schedules![0]).toMatchObject({
      weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '07:00', to: '07:01' }],
    });
    expect(doc.rules![0]!.when).toBe(doc.schedules![0]!.out);
    expect(errorsOf(doc)).toEqual([]);
    // Lịch riêng của luật không hiện thành thẻ riêng
    expect(readCards(doc).map((c) => c.kind)).toEqual(['rule']);
    card = ruleCard(doc, r.id);
    doc = writeRuleCard(
      doc,
      {
        ...card,
        trigger: { ...(card.trigger as TimeTrigger), from: '06:30', days: [1, 2, 3, 4, 5] },
      },
      TAGS,
    );
    expect(doc.schedules![0]!.weekly[0]).toEqual({
      days: [1, 2, 3, 4, 5],
      from: '06:30',
      to: '06:31',
    });
    // nhân bản có Lịch riêng; xóa dọn Lịch
    const d = duplicateRule(doc, r.id);
    expect(d.doc.schedules).toHaveLength(2);
    expect(errorsOf(d.doc)).toEqual([]);
    expect(removeRule(d.doc, d.id).schedules).toHaveLength(1);
  });

  it('Lặp lại mỗi: when true + repeatMs + fireOnStart, hợp lệ', () => {
    const r = addFromTemplate({ schemaVersion: '1.0.0' }, 'every', 'Đếm', TAGS);
    const card = ruleCard(r.doc, r.id);
    const doc = writeRuleCard(
      r.doc,
      { ...card, rise: [{ verb: 'add', tag: 'INT.N', value: 1 }] },
      TAGS,
    );
    expect(doc.rules![0]).toMatchObject({ when: 'true', repeatMs: 300000, fireOnStart: true });
    expect(doc.rules![0]!.onRise).toEqual([
      { do: 'setTag', tag: 'INT.N', value: { expr: 'INT.N + 1' } },
    ]);
    expect(errorsOf(doc)).toEqual([]);
    expect(ruleCard(doc, r.id).trigger).toEqual({ type: 'every', everyMs: 300000 });
  });

  it('mọi mẫu tạo được và đọc lại được', () => {
    for (const tpl of TEMPLATES) {
      const r = addFromTemplate({ schemaVersion: '1.0.0' }, tpl, tpl, TAGS);
      const cards = readCards(r.doc);
      expect(
        cards.find((c) => c.id === r.id),
        tpl,
      ).toBeTruthy();
      expect(
        cards.every((c) => c.kind !== 'other'),
        tpl,
      ).toBe(true);
    }
  });

  it('giữ cách viết của người dùng khi nghĩa không đổi; kéo đổi thứ tự', () => {
    const doc: LogicDoc = {
      schemaVersion: '1.0.0',
      rules: [
        {
          id: 'a',
          when: '(INT.N>3)',
          onRise: [{ do: 'setTag', tag: 'INT.N', value: { expr: 'INT.N+2' } }],
        },
        { id: 'b', when: 'INT.FLAG' },
      ],
    };
    const c = ruleCard(doc, 'a');
    expect(c.rise![0]).toMatchObject({ verb: 'add', value: 2 });
    expect(writeRuleCard(doc, c, TAGS)).toEqual(doc);
    const changed = writeRuleCard(doc, { ...c, rise: [{ ...c.rise![0]!, value: 5 }] }, TAGS);
    expect(changed.rules![0]!.onRise![0]!.value).toEqual({ expr: 'INT.N + 5' });
    expect(changed.rules![0]!.when).toBe('(INT.N>3)');
    expect(reorderRule(doc, 'b', 'a').rules!.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('luật phức tạp là nâng cao và không bị đụng', () => {
    const doc: LogicDoc = {
      schemaVersion: '1.0.0',
      rules: [{ id: 'x', when: 'A && B || C', onRise: [] }],
    };
    const c = ruleCard(doc, 'x');
    expect(c.trigger.type).toBe('advanced');
    expect(writeRuleCard(doc, { ...c, enabled: false }, TAGS).rules![0]).toEqual({
      id: 'x',
      when: 'A && B || C',
      onRise: [],
      enabled: false,
    });
  });
});
