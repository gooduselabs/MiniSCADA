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

export function optionLabel(v: string): string {
  const k = `wopt.${v}`;
  return hasKey(k) ? t(k as MessageKey) : v;
}

/** Chuỗi hiện giá trị mặc định cạnh nhãn. */
function defaultHint(f: FieldModel): string | null {
  if (f.default === undefined || f.kind === 'array' || f.kind === 'object') return null;
  if (f.fromTag !== undefined) return t('pf.defaultFromTag');
  if (f.kind === 'bool') return f.default ? t('pf.on') : t('pf.off');
  if (f.kind === 'enum') return optionLabel(String(f.default));
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

function listField(f: FieldModel, env: FieldEnv) {
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
  return html`<div class="pf-zones">
    ${zones.map(
      (z, i) =>
        html`<div class="pf-zone">
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
          <input
            type="color"
            aria-label=${t('pf.zone.color', { n: i + 1 })}
            .value=${/^#[0-9a-fA-F]{6}$/.test(z.color) ? z.color : '#15703a'}
            @input=${(e: Event) => upd(i, { color: (e.target as HTMLInputElement).value })}
          />
          <button
            type="button"
            class="ibtn sm"
            aria-label=${t('pf.zone.remove', { n: i + 1 })}
            @click=${() => set(zones.filter((_, k) => k !== i))}
          >
            ${icon('x', 'sm')}
          </button>
        </div>`,
    )}
    <button
      type="button"
      class="btn sm"
      ?disabled=${zones.length >= max}
      @click=${() => {
        const last = zones[zones.length - 1];
        const from = last ? last.to : 0;
        set([...zones, { from, to: from + 10, color: '#c42b2b' }]);
      }}
    >
      ${t('pf.zone.add')}
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
              ${optionLabel(o)}
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
      control = f.name === 'zones' ? zonesField(f, env) : listField(f, env);
      break;
    case 'object':
      control = html`<span class="muted">${t('pf.unsupported')}</span>`;
      break;
    default:
      control = textField(f, env, local, setError);
  }
  const hint = rangeHint(f);
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
        f.items &&
        (f.items as { kind: string }).kind !== 'enum')
        ? html`<div class="pf-hint" id="${fieldId(f.name)}-hint">
            ${hint ?? t('pf.linesHint', { max: f.maxItems ?? 0 })}
          </div>`
        : nothing
    }
    ${err ? html`<div class="pf-err" id="${fieldId(f.name)}-err" role="alert">${err}</div>` : nothing}
  </div>`;
}
