// Logic của hộp thoại "Tạo alarm cho Tag…" (feature 009, T077, FR-075; contract studio-alarm-editor §6): biểu mẫu → đầu vào
// cho từng Tag, giá trị gợi ý theo khoảng của Tag, lớp gợi ý theo ngưỡng, các dòng sẽ tạo (xem trước), lý do khóa nút Tạo.
// Hàm thuần, không DOM.
import { ALARM_THRESHOLDS, type AlarmThresholdName } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import {
  defaultClassFor,
  parseNumberText,
  quickCreate,
  quickDefaults,
  suggestDeadband,
  suggestThreshold,
  type AlarmDoc,
  type QuickCreateInput,
  type TagLite,
} from './alarm-doc.ts';
import { previewText, sampleFor } from './alarm-text.ts';
import { instanceCount } from './alarm-doc.ts';

export interface QuickForm {
  tags: readonly string[];
  kind: QuickCreateInput['kind'];
  /** Ngưỡng bật và lớp riêng; `value` trống thì dùng giá trị gợi ý của từng Tag. */
  thresholds: Record<AlarmThresholdName, { on: boolean; value: string; cls: string }>;
  trigger: boolean;
  on: 'bad' | 'notGood';
  byDevice: boolean;
  cls: string;
  deadband: string;
  onDelayS: string;
  offDelayS: string;
  area: string;
}

/** Biểu mẫu ban đầu: ngưỡng H và HH bật, trễ 3 s, deadband gợi ý theo Tag đầu (trống = theo từng Tag). */
export function initialForm(
  tags: readonly string[],
  lookup: ReadonlyMap<string, TagLite>,
  doc: AlarmDoc,
): QuickForm {
  const first = tags.map((id) => lookup.get(id)).find((x): x is TagLite => !!x);
  const d = first ? quickDefaults(first, doc.classes) : null;
  const th = {} as QuickForm['thresholds'];
  for (const n of ALARM_THRESHOLDS)
    th[n] = {
      on: n === 'H' || n === 'HH',
      value: '',
      cls: defaultClassFor(n, doc.classes) ?? '',
    };
  return {
    tags,
    kind: d?.kind ?? 'limit',
    thresholds: th,
    trigger: true,
    on: 'bad',
    byDevice: false,
    cls: (d?.class ?? defaultClassFor('digital', doc.classes)) || '',
    deadband: '',
    onDelayS: '3',
    offDelayS: '3',
    area: '',
  };
}

const numberOrUndefined = (s: string): number | undefined => {
  if (s.trim() === '') return undefined;
  const n = parseNumberText(s);
  return typeof n === 'number' ? n : Number.NaN;
};

/** Đầu vào của từng Tag từ biểu mẫu (ngưỡng chưa gõ lấy gợi ý theo khoảng của chính Tag). */
export function inputsOf(
  form: QuickForm,
  lookup: ReadonlyMap<string, TagLite>,
  devices: ReadonlyMap<string, string>,
  doc: AlarmDoc,
): QuickCreateInput[] {
  const out: QuickCreateInput[] = [];
  for (const id of form.tags) {
    const tag = lookup.get(id);
    if (!tag) continue;
    const thresholds: NonNullable<QuickCreateInput['thresholds']> = {};
    for (const n of ALARM_THRESHOLDS) {
      const f = form.thresholds[n];
      if (!f.on) {
        thresholds[n] = null;
        continue;
      }
      const typed = numberOrUndefined(f.value);
      thresholds[n] = {
        value: typed !== undefined ? typed : suggestThreshold(tag, n),
        class: f.cls || (defaultClassFor(n, doc.classes) ?? ''),
      };
    }
    const device = form.byDevice ? devices.get(id) : undefined;
    const db = numberOrUndefined(form.deadband);
    out.push({
      tag,
      kind: form.kind,
      thresholds,
      trigger: form.trigger,
      on: form.on,
      ...(device ? { device } : {}),
      class: form.cls,
      deadband: db !== undefined ? db : suggestDeadband(tag),
      onDelayS: numberOrUndefined(form.onDelayS) ?? 0,
      offDelayS: numberOrUndefined(form.offDelayS) ?? 0,
      ...(form.area ? { area: form.area } : {}),
    });
  }
  return out;
}

export interface QuickPreviewRow {
  id: string;
  summary: string;
  classes: string;
  text: string;
  /** Id đã đổi vì trùng (gợi ý `_2`). */
  renamedFrom?: string;
}

export interface QuickPreview {
  rows: QuickPreviewRow[];
  /** Khóa chuỗi lý do chặn nút Tạo; `null` khi tạo được. */
  blocked: string | null;
  skipped: Array<{ tag: string; reason: string }>;
  instances: number;
  doc: AlarmDoc;
  added: number[];
}

/** Các dòng sẽ tạo, nội dung mặc định đã chèn mẫu, lý do khóa (không có Tag, loại không hợp, vượt 500 instance). */
export function previewOf(
  form: QuickForm,
  lookup: ReadonlyMap<string, TagLite>,
  devices: ReadonlyMap<string, string>,
  doc: AlarmDoc,
): QuickPreview {
  const inputs = inputsOf(form, lookup, devices, doc);
  if (!inputs.length)
    return { rows: [], blocked: 'alarm.quick.noTag', skipped: [], instances: 0, doc, added: [] };
  const r = quickCreate(doc, inputs);
  const rows = r.added.map((i): QuickPreviewRow => {
    const def = r.doc.alarms[i] as unknown as {
      id: string;
      type: string;
      tag?: string;
      limits?: Record<string, { value: number; class: string }>;
      class?: string;
      trigger?: boolean;
    };
    const cn = (id: string | undefined) => r.doc.classes.find((c) => c.id === id)?.name ?? id ?? '';
    const sample = sampleFor(r.doc.alarms[i]!, r.doc, lookup);
    const summary =
      def.type === 'limit'
        ? [...ALARM_THRESHOLDS]
            .reverse()
            .filter((n) => def.limits?.[n])
            .map((n) => `${n} ${def.limits![n]!.value}`)
            .join(' · ')
        : def.type === 'digital'
          ? t(def.trigger === false ? 'alarm.trigger.off' : 'alarm.trigger.on')
          : t(form.on === 'notGood' ? 'alarm.qualityOn.notGood' : 'alarm.qualityOn.bad');
    const classes =
      def.type === 'limit'
        ? [...ALARM_THRESHOLDS]
            .reverse()
            .filter((n) => def.limits?.[n])
            .map((n) => cn(def.limits![n]!.class))
            .join(' · ')
        : cn(def.class);
    return {
      id: def.id,
      summary,
      classes,
      text: previewText('', r.doc.alarms[i]!, sample),
    };
  });
  const blocked =
    r.blocked ?? (rows.length === 0 ? (r.skipped[0]?.reason ?? 'alarm.quick.noTag') : null);
  return {
    rows,
    blocked,
    skipped: r.skipped,
    instances: instanceCount(r.doc.alarms),
    doc: r.doc,
    added: r.added,
  };
}
