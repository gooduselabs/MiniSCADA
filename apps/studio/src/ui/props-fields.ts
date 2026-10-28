// Ô nhập của inspector cho item (feature 007, T115, FR-063): dựng từ `FieldModel` của danh mục widget. Mỗi kiểu thuộc tính một
// bộ điều khiển (chữ, số, bật tắt, lựa chọn, màu, danh sách, vùng màu), kiểm giá trị bằng `checkPropValue` của project-schema
// trước khi áp (lỗi hiện ngay tại ô, không bắn thông báo mỗi lần gõ). Chữ nhập bằng ô thường của Studio, bỏ qua phím trong lúc
// bộ gõ đang ghép chữ (`isComposing`, ADR-016). Hàm thuần dựng template; trạng thái do inspector giữ.
import { checkPropValue, type PropValue } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import { hasKey, t, type MessageKey } from '../i18n/index.ts';
import { icon } from './base.ts';
import type { FieldModel } from '../model/screen-catalog.ts';

export interface FieldEnv {
  /** Giá trị hiện tại; `undefined` là chưa đặt (dùng mặc định). */
  value: PropValue | undefined;
  /** Nhiều item đang chọn có giá trị khác nhau. */
  mixed: boolean;
  /** Câu lỗi của bộ kiểm tra cho ô này (viền đỏ). */
  issue: string | null;
  /** Áp giá trị mới; `undefined` bỏ khóa (về mặc định). Trả `false` nếu bị từ chối. */
  commit: (v: PropValue | undefined) => boolean;
  /** Danh sách tên bảng giá trị của project (kiểu `tableRef`). */
  tables: readonly string[];
  /** Khu vực, lớp alarm và màn hình của project (widget alarm-list, alarm-count; feature 009, FR-068). */
  areas?: readonly { id: string; name: string }[];
  classes?: readonly { id: string; name: string }[];
  screens?: readonly { id: string; name: string }[];
  /** Nhóm lưu trữ của project (kiểu `logGroup`, feature 010): id và tên. */
  logGroups?: ReadonlyArray<{ id: string; name: string }>;
  /** Giá trị đề xuất từ Tag (nút "Dùng của Tag"); `undefined` nếu không có. */
  suggestion?: PropValue | undefined;
}

export const fieldId = (name: string): string => `pf-${name}`;

/** Nhãn của thuộc tính: riêng của widget nếu có, không thì nhãn dùng chung. */
export function propLabel(f: FieldModel): string {
  if (hasKey(f.i18nKey)) return t(f.i18nKey as MessageKey);
  const shared = `wprop.${f.name}`;
  return hasKey(shared) ? t(shared as MessageKey) : f.name;
}

/** Nhãn của một lựa chọn: riêng của thuộc tính (`<khóa i18n của thuộc tính>.<giá trị>`, feature 014) nếu có, không thì
 * nhãn dùng chung `wopt.<giá trị>`, không thì chính giá trị. */
export function optionLabel(v: string, f?: Pick<FieldModel, 'i18nKey'>): string {
  const own = f ? `${f.i18nKey}.${v}` : '';
  if (own && hasKey(own)) return t(own as MessageKey);
  const k = `wopt.${v}`;
  return hasKey(k) ? t(k as MessageKey) : v;
}

/** Chuỗi hiện giá trị mặc định cạnh nhãn. */
function defaultHint(f: FieldModel): string | null {
  if (f.default === undefined || f.kind === 'array' || f.kind === 'object') return null;
  if (f.fromTag !== undefined) return t('pf.defaultFromTag');
  if (f.kind === 'bool') return f.default ? t('pf.on') : t('pf.off');
  if (f.kind === 'enum') return optionLabel(String(f.default), f);
  const s = String(f.default);
  return s === '' ? null : s;
}

const COMMA = /,/;

/** Số từ chữ gõ: dấu chấm thập phân (từ chối dấu phẩy, như Chrome vận hành). */
export function parseNumberText(
  text: string,
  integer: boolean,
): { ok: true; value: number | undefined } | { ok: false; error: MessageKey } {
  const s = text.trim();
  if (s === '') return { ok: true, value: undefined };
  if (COMMA.test(s)) return { ok: false, error: 'pf.err.comma' };
  const n = Number(s);
  if (!Number.isFinite(n) || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s))
    return { ok: false, error: 'pf.err.number' };
  if (integer && !Number.isInteger(n)) return { ok: false, error: 'pf.err.integer' };
  return { ok: true, value: n };
}

function rangeHint(f: FieldModel): string | null {
  if (f.kind !== 'int' && f.kind !== 'number') return null;
  if (f.min !== undefined && f.max !== undefined) return t('pf.range', { min: f.min, max: f.max });
  if (f.min !== undefined) return t('pf.rangeMin', { min: f.min });
  if (f.max !== undefined) return t('pf.rangeMax', { max: f.max });
  if (f.exclusiveMin !== undefined) return t('pf.rangeGt', { min: f.exclusiveMin });
  return null;
}

/** Lỗi của giá trị theo danh mục; `null` khi hợp lệ. */
export function fieldError(f: FieldModel, v: PropValue): string | null {
  return checkPropValue(f as unknown as Parameters<typeof checkPropValue>[0], v);
}

// ---------------------------------------------------------------------------------------------

type OnText = (e: Event) => void;

function textField(
  f: FieldModel,
  env: FieldEnv,
  local: { error: MessageKey | null },
  setError: (e: MessageKey | null) => void,
) {
  const numeric = f.kind === 'int' || f.kind === 'number';
  const value = env.value === undefined ? '' : String(env.value);
  const apply = (raw: string, final: boolean): void => {
    if (numeric) {
      const p = parseNumberText(raw, f.kind === 'int');
      if (!p.ok) return (setError(p.error), void 0);
      if (p.value !== undefined && fieldError(f, p.value)) {
        setError('pf.err.range');
        return;
      }
      setError(null);
      env.commit(p.value);
      return;
    }
    if (raw.length > (f.maxLength ?? 1e9)) {
      setError('pf.err.tooLong');
      return;
    }
    setError(null);
    // Chuỗi rỗng là "chưa đặt" (về mặc định); chỉ bỏ khóa khi rời ô, để gõ xóa hết rồi gõ tiếp không nhảy.
    env.commit(raw === '' ? (final ? undefined : '') : raw);
  };
  const onInput: OnText = (e) => {
    if ((e as InputEvent).isComposing) return;
    apply((e.target as HTMLInputElement).value, false);
  };
  const onChange: OnText = (e) => apply((e.target as HTMLInputElement).value, true);
  const err = local.error ? t(local.error) : env.issue;
  // Feature 014: chuỗi nhiều dòng (ghi chú) sửa bằng ô nhiều dòng; Enter xuống dòng, rời ô thì áp.
  if (f.multiline)
    return html`<textarea
      id=${fieldId(f.name)}
      class="pf-in pf-area"
      rows="4"
      spellcheck="false"
      placeholder=${env.mixed ? t('pf.mixed') : ''}
      maxlength=${f.maxLength !== undefined ? String(f.maxLength) : nothing}
      .value=${env.mixed ? '' : value}
      aria-invalid=${err ? 'true' : 'false'}
      aria-describedby=${err ? `${fieldId(f.name)}-err` : nothing}
      @input=${onInput}
      @change=${onChange}
      @compositionend=${onChange}
    ></textarea>`;
  return html`<input
    id=${fieldId(f.name)}
    class="pf-in ${numeric ? 'mono num' : ''}"
    type="text"
    autocomplete="off"
    spellcheck="false"
    inputmode=${numeric ? 'decimal' : 'text'}
    placeholder=${env.mixed ? t('pf.mixed') : (defaultHint(f) ?? '')}
    maxlength=${f.maxLength !== undefined ? String(f.maxLength) : nothing}
    .value=${env.mixed ? '' : value}
    aria-invalid=${err ? 'true' : 'false'}
    aria-describedby=${err ? `${fieldId(f.name)}-err` : nothing}
    @input=${onInput}
    @change=${onChange}
    @compositionend=${onChange}
    @keydown=${(e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
    }}
  />`;
}

function colorField(f: FieldModel, env: FieldEnv) {
  const v = typeof env.value === 'string' ? env.value : undefined;
  const auto = f.allowAuto === true;
  const isAuto = v === 'auto' || (auto && v === undefined && f.default === 'auto');
  const hex = v !== undefined && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#0b7285';
  return html`<span class="pf-color">
    <input
      id=${fieldId(f.name)}
      type="color"
      aria-label=${propLabel(f)}
      .value=${hex}
      ?disabled=${isAuto}
      @input=${(e: Event) => env.commit((e.target as HTMLInputElement).value)}
    />
    <span class="mono pf-hex">${env.mixed ? t('pf.mixed') : (v ?? t('pf.default'))}</span>
    ${
      auto
        ? html`<label class="pf-chk"
            ><input
              type="checkbox"
              .checked=${isAuto}
              @change=${(e: Event) =>
                env.commit((e.target as HTMLInputElement).checked ? 'auto' : hex)}
            />${t('pf.auto')}</label
          >`
        : nothing
    }
    <button
      type="button"
      class="btn sm"
      ?disabled=${v === undefined}
      @click=${() => env.commit(undefined)}
    >
      ${t('pf.reset')}
    </button>
  </span>`;
}

/** Danh sách chọn từ project (khu vực, lớp): hộp tích, rỗng nghĩa là mọi mục. */
function projectListField(
  f: FieldModel,
  env: FieldEnv,
  list: readonly { id: string; name: string }[],
  none: MessageKey,
) {
  const cur = Array.isArray(env.value) ? (env.value as PropValue[]).map(String) : [];
  const set = (next: string[]) =>
    env.commit(next.length ? (next as unknown as PropValue) : undefined);
  if (list.length === 0) return html`<span class="muted">${t(none)}</span>`;
  return html`<span class="pf-checks" role="group" aria-label=${propLabel(f)}>
    ${list.map(
      (o) =>
        html`<label class="pf-chk"
          ><input
            type="checkbox"
            data-id=${o.id}
            .checked=${cur.includes(o.id)}
            @change=${(e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              set(list.map((x) => x.id).filter((x) => (x === o.id ? on : cur.includes(x))));
            }}
          />${o.name}</label
        >`,
    )}
  </span>`;
}

/** Đích khi bấm widget alarm-count: trang Alarm, một màn hình, hoặc không làm gì. */
function targetField(f: FieldModel, env: FieldEnv) {
  const cur = (env.value ?? f.default ?? { kind: 'alarms' }) as { kind?: string; screen?: string };
  const kinds = ['alarms', 'screen', 'none'];
  const set = (next: { kind: string; screen?: string }) => env.commit(next as unknown as PropValue);
  return html`<span class="pf-checks">
    <select
      id=${fieldId(f.name)}
      class="pf-in"
      @change=${(e: Event) => {
        const kind = (e.target as HTMLSelectElement).value;
        set(kind === 'screen' ? { kind, screen: env.screens?.[0]?.id ?? '' } : { kind });
      }}
    >
      ${kinds.map(
        (k) =>
          html`<option value=${k} ?selected=${(cur.kind ?? 'alarms') === k}>
            ${t(`wprop.target.${k}` as MessageKey)}
          </option>`,
      )}
    </select>
    ${
      cur.kind === 'screen'
        ? html`<select
            class="pf-in"
            aria-label=${t('wprop.target.screen')}
            @change=${(e: Event) =>
              set({ kind: 'screen', screen: (e.target as HTMLSelectElement).value })}
          >
            ${(env.screens ?? []).map(
              (s) =>
                html`<option value=${s.id} ?selected=${cur.screen === s.id}>${s.name}</option>`,
            )}
          </select>`
        : nothing
    }
  </span>`;
}

function listField(f: FieldModel, env: FieldEnv) {
  if (f.name === 'areas') return projectListField(f, env, env.areas ?? [], 'wprop.areas.none');
  if (f.name === 'classes')
    return projectListField(f, env, env.classes ?? [], 'wprop.classes.none');
  const items = f.items as { kind: string; options?: string[] } | undefined;
  const cur = Array.isArray(env.value) ? (env.value as PropValue[]) : [];
  if (items?.kind === 'enum') {
    const opts = items.options ?? [];
    return html`<span class="pf-checks" role="group" aria-label=${propLabel(f)}>
      ${opts.map(
        (o) =>
          html`<label class="pf-chk"
            ><input
              type="checkbox"
              .checked=${cur.includes(o)}
              @change=${(e: Event) => {
                const on = (e.target as HTMLInputElement).checked;
                // Giữ thứ tự của danh mục.
                const next = opts.filter((x) => (x === o ? on : cur.includes(x)));
                env.commit(next);
              }}
            />${optionLabel(o)}</label
          >`,
      )}
    </span>`;
  }
  if (items?.kind === 'color') return colorListField(f, env, cur.map(String));
  // Danh sách chữ (nhãn đường, cột): mỗi dòng một mục.
  const text = cur.map(String).join('\n');
  return html`<textarea
    id=${fieldId(f.name)}
    class="pf-in pf-area"
    rows="3"
    spellcheck="false"
    placeholder=${t('pf.linesHint', { max: f.maxItems ?? 0 })}
    aria-describedby=${`${fieldId(f.name)}-hint`}
    .value=${text}
    @change=${(e: Event) => {
      const lines = (e.target as HTMLTextAreaElement).value
        .split('\n')
        .map((l) => l.trim())
        .filter((l, i, a) => l !== '' || i < a.length - 1);
      env.commit(lines.length ? lines.filter((l) => l !== '') : undefined);
    }}
  ></textarea>`;
}

/** Feature 029: màu riêng từng chuỗi (line, history-trend): mỗi chuỗi một ô màu, thêm/bớt ngay tại chỗ. */
function colorListField(f: FieldModel, env: FieldEnv, cur: string[]) {
  const max = f.maxItems ?? 8;
  const set = (next: string[]) => env.commit(next.length ? next : undefined);
  return html`<div class="pf-colors" id=${fieldId(f.name)} role="group" aria-label=${propLabel(f)}>
    ${cur.map(
      (c, i) =>
        html`<span class="pf-color-item">
          <input
            type="color"
            .value=${/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#348fe2'}
            aria-label=${t('pf.seriesColor', { n: i + 1 })}
            @change=${(e: Event) =>
              set(cur.map((x, k) => (k === i ? (e.target as HTMLInputElement).value : x)))}
          />
          <button
            type="button"
            class="btn sm icon"
            title=${t('pf.removeItem')}
            aria-label=${t('pf.removeItem')}
            @click=${() => set(cur.filter((_, k) => k !== i))}
          >
            ${icon('x')}
          </button>
        </span>`,
    )}
    ${
      cur.length < max
        ? html`<button
            type="button"
            class="btn sm"
            data-act="add-color"
            @click=${() => set([...cur, SERIES_DEFAULTS[cur.length % SERIES_DEFAULTS.length]!])}
          >
            + ${t('pf.addColor')}
          </button>`
        : nothing
    }
  </div>`;
}

/** Màu gợi ý khi thêm chuỗi: thứ tự màu biểu đồ của giao diện atscada (feature 029). */
const SERIES_DEFAULTS = [
  '#348fe2',
  '#00a5a5',
  '#d08416',
  '#ff5b57',
  '#727cb6',
  '#709e3a',
  '#3d9bb5',
  '#8753de',
];

function zonesField(f: FieldModel, env: FieldEnv) {
  const zones = (Array.isArray(env.value) ? env.value : []) as Array<{
    from: number;
    to: number;
    color: string;
  }>;
  const max = f.maxItems ?? 4;
  const set = (next: typeof zones) =>
    env.commit(next.length ? (next as unknown as PropValue) : undefined);
  const upd = (i: number, patch: Partial<(typeof zones)[number]>) =>
    set(zones.map((z, k) => (k === i ? { ...z, ...patch } : z)));
  // Mỗi vùng một dòng có nhãn (Từ, Đến) và nút xóa biểu tượng 28 px: vừa khung Thuộc tính dọc hẹp (~400 px).
  return html`<div class="pf-zones">
    ${zones.map(
      (z, i) =>
        html`<div class="pf-zone" data-zone=${String(i)}>
          <label class="pf-zl">
            <span>${t('pf.zone.fromShort')}</span>
            <input
              class="pf-in mono num"
              inputmode="decimal"
              aria-label=${t('pf.zone.from', { n: i + 1 })}
              .value=${String(z.from)}
              @change=${(e: Event) => {
                const p = parseNumberText((e.target as HTMLInputElement).value, false);
                if (p.ok && p.value !== undefined) upd(i, { from: p.value });
              }}
            />
          </label>
          <label class="pf-zl">
            <span>${t('pf.zone.toShort')}</span>
            <input
              class="pf-in mono num"
              inputmode="decimal"
              aria-label=${t('pf.zone.to', { n: i + 1 })}
              .value=${String(z.to)}
              @change=${(e: Event) => {
                const p = parseNumberText((e.target as HTMLInputElement).value, false);
                if (p.ok && p.value !== undefined) upd(i, { to: p.value });
              }}
            />
          </label>
          <input
            type="color"
            class="pf-zc"
            title=${t('pf.zone.colorShort')}
            aria-label=${t('pf.zone.color', { n: i + 1 })}
            .value=${/^#[0-9a-fA-F]{6}$/.test(z.color) ? z.color : '#15703a'}
            @input=${(e: Event) => upd(i, { color: (e.target as HTMLInputElement).value })}
          />
          <button
            type="button"
            class="ibtn pf-zx"
            data-act="zone-remove"
            title=${t('pf.zone.removeTip')}
            aria-label=${t('pf.zone.remove', { n: i + 1 })}
            @click=${() => set(zones.filter((_, k) => k !== i))}
          >
            ${icon('trash', 'sm')}
          </button>
        </div>`,
    )}
    <button
      type="button"
      class="btn sm pf-zadd"
      ?disabled=${zones.length >= max}
      @click=${() => {
        const last = zones[zones.length - 1];
        const from = last ? last.to : 0;
        set([...zones, { from, to: from + 10, color: '#c42b2b' }]);
      }}
    >
      + ${t('pf.zone.add')}
    </button>
  </div>`;
}

/** Màu gợi ý cho trạng thái mới của multi-state (feature 037): xám dừng, xanh chạy, đỏ lỗi, cam, xanh dương… */
const STATE_DEFAULTS = ['#6f7f88', '#268426', '#c84845', '#a36810', '#2c7ac0', '#8753de'];

/**
 * Bảng trạng thái của `multi-state` (feature 037): mỗi dòng Giá trị, Chữ, Màu, Nhấp nháy, Xóa; thêm dòng đặt sẵn giá trị kế
 * tiếp và màu gợi ý để người dùng chỉ việc gõ chữ.
 */
function statesField(f: FieldModel, env: FieldEnv) {
  type St = { value: number; text: string; color: string; blink?: boolean };
  const list = (Array.isArray(env.value) ? env.value : []) as St[];
  const max = f.maxItems ?? 16;
  const set = (next: St[]) => env.commit(next.length ? (next as unknown as PropValue) : undefined);
  const upd = (i: number, patch: Partial<St>) =>
    set(list.map((z, k) => (k === i ? { ...z, ...patch } : z)));
  return html`<div class="pf-zones pf-states">
    ${list.map(
      (z, i) =>
        html`<div class="pf-zone" data-state=${String(i)}>
          <label class="pf-zl">
            <span>${t('wfield.value')}</span>
            <input
              class="pf-in mono num"
              inputmode="decimal"
              aria-label=${`${t('wfield.value')} ${i + 1}`}
              .value=${String(z.value)}
              @change=${(e: Event) => {
                const p = parseNumberText((e.target as HTMLInputElement).value, false);
                if (p.ok && p.value !== undefined) upd(i, { value: p.value });
              }}
            />
          </label>
          <input
            class="pf-in pf-stext"
            maxlength="32"
            aria-label=${`${t('wfield.text')} ${i + 1}`}
            placeholder=${t('wfield.text')}
            .value=${z.text}
            @change=${(e: Event) => upd(i, { text: (e.target as HTMLInputElement).value })}
          />
          <input
            type="color"
            class="pf-zc"
            title=${t('wfield.color')}
            aria-label=${`${t('wfield.color')} ${i + 1}`}
            .value=${/^#[0-9a-fA-F]{6}$/.test(z.color) ? z.color : '#6f7f88'}
            @input=${(e: Event) => upd(i, { color: (e.target as HTMLInputElement).value })}
          />
          <label class="pf-chk" title=${t('wfield.blink')}
            ><input
              type="checkbox"
              aria-label=${`${t('wfield.blink')} ${i + 1}`}
              .checked=${z.blink === true}
              @change=${(e: Event) => {
                const on = (e.target as HTMLInputElement).checked;
                const next: St = { value: z.value, text: z.text, color: z.color };
                if (on) next.blink = true;
                set(list.map((x, k) => (k === i ? next : x)));
              }}
          /></label>
          <button
            type="button"
            class="ibtn pf-zx"
            data-act="state-remove"
            aria-label=${t('pf.zone.remove', { n: i + 1 })}
            @click=${() => set(list.filter((_, k) => k !== i))}
          >
            ${icon('trash', 'sm')}
          </button>
        </div>`,
    )}
    <button
      type="button"
      class="btn sm pf-zadd"
      data-act="state-add"
      ?disabled=${list.length >= max}
      @click=${() => {
        const next = list.length ? Math.max(...list.map((z) => z.value)) + 1 : 0;
        set([
          ...list,
          { value: next, text: '', color: STATE_DEFAULTS[list.length % STATE_DEFAULTS.length]! },
        ]);
      }}
    >
      + ${t('wfield.add')}
    </button>
  </div>`;
}

/** Một dòng thuộc tính: nhãn, ô nhập, gợi ý. `local` giữ lỗi nhập tạm của ô (chưa vào tài liệu). */
export function renderField(
  f: FieldModel,
  env: FieldEnv,
  local: { error: MessageKey | null },
  setError: (e: MessageKey | null) => void,
): TemplateResult {
  let control: TemplateResult;
  switch (f.kind) {
    case 'bool':
      control = html`<label class="pf-chk"
        ><input
          id=${fieldId(f.name)}
          type="checkbox"
          .checked=${env.value === undefined ? f.default === true : env.value === true}
          .indeterminate=${env.mixed}
          @change=${(e: Event) => env.commit((e.target as HTMLInputElement).checked)}
        />${env.mixed ? t('pf.mixed') : ''}</label
      >`;
      break;
    case 'enum':
      control = html`<select
        id=${fieldId(f.name)}
        class="pf-in"
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          env.commit(v === '' ? undefined : v);
        }}
      >
        ${env.mixed ? html`<option value="" selected>${t('pf.mixed')}</option>` : nothing}
        ${(f.options ?? []).map(
          (o) =>
            html`<option value=${o} ?selected=${!env.mixed && (env.value ?? f.default) === o}>
              ${optionLabel(o, f)}
            </option>`,
        )}
      </select>`;
      break;
    case 'color':
      control = colorField(f, env);
      break;
    case 'tableRef':
      control = html`<select
        id=${fieldId(f.name)}
        class="pf-in"
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          env.commit(v === '' ? undefined : v);
        }}
      >
        <option value="" ?selected=${env.value === undefined}>${t('pf.tableOfTag')}</option>
        ${env.tables.map(
          (n) => html`<option value=${n} ?selected=${env.value === n}>${n}</option>`,
        )}
      </select>`;
      break;
    case 'logGroup': {
      // Danh sách nhóm lưu trữ của project (feature 010): chọn nhóm cho widget lịch sử; id không còn trong project vẫn hiện
      // (kèm nhãn) để bộ kiểm tra báo lỗi theo ô, không tự đổi.
      const groups = env.logGroups ?? [];
      const cur = typeof env.value === 'string' ? env.value : undefined;
      const known = cur === undefined || groups.some((g) => g.id === cur);
      control = html`<select
        id=${fieldId(f.name)}
        class="pf-in"
        aria-invalid=${env.issue ? 'true' : 'false'}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          env.commit(v === '' ? undefined : v);
        }}
      >
        <option value="" ?selected=${cur === undefined && !env.mixed}>
          ${t('pf.pickLogGroup')}
        </option>
        ${env.mixed ? html`<option value="" selected>${t('pf.mixed')}</option>` : nothing}
        ${
          known || cur === undefined
            ? nothing
            : html`<option value=${cur} selected>${t('pf.logGroupUnknown', { id: cur })}</option>`
        }
        ${groups.map(
          (g) =>
            html`<option value=${g.id} ?selected=${!env.mixed && cur === g.id}>
              ${g.name} (${g.id})
            </option>`,
        )}
      </select>`;
      break;
    }
    case 'array':
      control =
        f.name === 'zones'
          ? zonesField(f, env)
          : f.name === 'states'
            ? statesField(f, env)
            : listField(f, env);
      break;
    case 'object':
      control =
        f.name === 'target'
          ? targetField(f, env)
          : html`<span class="muted">${t('pf.unsupported')}</span>`;
      break;
    default:
      control = textField(f, env, local, setError);
  }
  // 037: gợi ý ngắn cho thuộc tính khó hiểu (`whelp.<tên>`), sau gợi ý khoảng giá trị.
  const help = `whelp.${f.name}`;
  const hint = rangeHint(f) ?? (hasKey(help) ? t(help) : null);
  const err = local.error ? t(local.error) : env.issue;
  return html`<div
    class="pf-row ${err ? 'bad' : ''}"
    data-field=${`prop:${f.name}`}
    ?data-mixed=${env.mixed}
  >
    <label class="pf-l" for=${fieldId(f.name)} title=${propLabel(f)}>${propLabel(f)}</label>
    <div class="pf-v">
      ${control}
      ${
        env.suggestion !== undefined && env.value === undefined
          ? html`<button
              type="button"
              class="btn sm pf-sug"
              title=${t('pf.useTagTip')}
              @click=${() => env.commit(env.suggestion)}
            >
              ${t('pf.useTag', { value: String(env.suggestion) })}
            </button>`
          : nothing
      }
    </div>
    ${
      hint ||
      (f.kind === 'array' &&
        f.name !== 'zones' &&
        f.name !== 'states' &&
        f.items &&
        (f.items as { kind: string }).kind !== 'enum' &&
        (f.items as { kind: string }).kind !== 'color')
        ? html`<div class="pf-hint" id="${fieldId(f.name)}-hint">
            ${hint ?? t('pf.linesHint', { max: f.maxItems ?? 0 })}
          </div>`
        : nothing
    }
    ${err ? html`<div class="pf-err" id="${fieldId(f.name)}-err" role="alert">${err}</div>` : nothing}
  </div>`;
}
