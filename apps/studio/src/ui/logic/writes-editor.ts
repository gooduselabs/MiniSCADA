// Inspector của mục Ghi PLC (`writes`, feature 011, T144; contracts/logic-engine.md §8; mockup cảnh 1 và 3): danh sách cho
// phép mà luật được ghi xuống PLC. Đích chỉ là Tag thiết bị đọc/ghi (E_LOGIC_WRITE_TARGET), giá trị cho phép là danh sách
// hoặc khoảng min đến max (số), giới hạn tần suất `minIntervalMs` ≥ 1.000 và `maxPerHour` ≥ 1; liệt kê luật đang dùng.
import type { LogicScalar, LogicWrite, TagV1 } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import { t } from '../../i18n/index.ts';
import { writesUsage } from '../../model/logic-doc.ts';
import { frow, group, idInput, numInput, parseNumber, patch, type FieldCtx } from './fields.ts';
import { KIND_ICON, allowedText } from './logic-parts.ts';
import { projectTags } from './logic-state.ts';

const NUMERIC = new Set([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
]);

/** "true, false" hoặc "1, 2" hoặc "\"A\", B" → giá trị theo kiểu Tag. */
export function parseAllowed(text: string, type: string | undefined): LogicScalar[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s): LogicScalar => {
      if (type === 'BOOL' || s === 'true' || s === 'false') return s === 'true' || s === '1';
      if (type !== 'STRING' && NUMERIC.has(type ?? 'FLOAT64')) {
        const n = parseNumber(s, false);
        if (n !== null) return n;
      }
      if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
        try {
          return JSON.parse(s) as string;
        } catch {
          return s.slice(1, -1);
        }
      }
      return s;
    });
}

export function writesInspector(c: FieldCtx): TemplateResult {
  const w = c.b as unknown as LogicWrite;
  const tags = projectTags(c.app);
  const rw = tags.filter((x: TagV1) => x.kind === 'external' && x.access === 'RW');
  const type = tags.find((x) => x.id === w.tag)?.type;
  const range = !!w.allowed && !('values' in w.allowed);
  const used = writesUsage(c.doc).get(w.id) ?? [];
  const target = group(
    'tag',
    t('logic.w.target'),
    html`${frow(
      html`<label for="lgw-tag">${t('logic.w.tag')}</label>`,
      html`<select
        id="lgw-tag"
        class="select sm mono"
        data-field="tag"
        ?disabled=${c.ro}
        @change=${(e: Event) => patch(c, { tag: (e.target as HTMLSelectElement).value })}
      >
        ${w.tag === '' ? html`<option value="" selected>${t('logic.w.pick')}</option>` : nothing}
        ${rw.map((x) => html`<option value=${x.id} ?selected=${x.id === w.tag}>${x.id}</option>`)}
        ${
          w.tag !== '' && !rw.some((x) => x.id === w.tag)
            ? html`<option value=${w.tag} selected>${t('logic.w.notRw', { tag: w.tag })}</option>`
            : nothing
        }
      </select>`,
    )}
    ${frow(t('logic.w.type'), html`<span class="mono">${type ?? '—'}</span>`)}
    ${frow(
      html`<label for="lgw-mode">${t('logic.w.mode')}</label>`,
      html`<select
        id="lgw-mode"
        class="select sm"
        data-field="allowedMode"
        ?disabled=${c.ro || (type !== undefined && !NUMERIC.has(type))}
        @change=${(e: Event) =>
          patch(c, {
            allowed:
              (e.target as HTMLSelectElement).value === 'range'
                ? { min: 0, max: 100 }
                : { values: type === 'BOOL' ? [true, false] : [0] },
          })}
      >
        <option value="values" ?selected=${!range}>${t('logic.w.modeValues')}</option>
        <option value="range" ?selected=${range}>${t('logic.w.modeRange')}</option>
      </select>`,
    )}
    ${
      range
        ? html`${frow(
            html`<label for="lgw-min">min</label>`,
            html`<input
              id="lgw-min"
              class="input sm num"
              data-field="allowedMin"
              inputmode="decimal"
              ?readonly=${c.ro}
              .value=${String((w.allowed as { min: number }).min)}
              @change=${(e: Event) => {
                const n = parseNumber((e.target as HTMLInputElement).value, false);
                if (n !== null) patch(c, { allowed: { ...(w.allowed as object), min: n } });
              }}
            />`,
          )}
          ${frow(
            html`<label for="lgw-max">max</label>`,
            html`<input
              id="lgw-max"
              class="input sm num"
              data-field="allowedMax"
              inputmode="decimal"
              ?readonly=${c.ro}
              .value=${String((w.allowed as { max: number }).max)}
              @change=${(e: Event) => {
                const n = parseNumber((e.target as HTMLInputElement).value, false);
                if (n !== null) patch(c, { allowed: { ...(w.allowed as object), max: n } });
              }}
            />`,
          )}`
        : frow(
            html`<label for="lgw-allowed">${t('logic.w.allowed')}</label>`,
            html`<input
              id="lgw-allowed"
              class="input sm mono"
              data-field="allowed"
              spellcheck="false"
              ?readonly=${c.ro}
              .value=${allowedText(w.allowed)}
              @change=${(e: Event) =>
                patch(c, {
                  allowed: { values: parseAllowed((e.target as HTMLInputElement).value, type) },
                })}
            />`,
            t('logic.w.allowedHelp'),
          )
    }`,
  );
  const limits = group(
    'gear',
    t('logic.w.limits'),
    html`${numInput(c, 'minIntervalMs', t('logic.w.minInterval'), { unit: 'ms', sub: t('logic.w.minIntervalHelp') })}
      ${numInput(c, 'maxPerHour', t('logic.w.maxPerHour'))}
      ${frow(
        t('logic.w.used'),
        used.length
          ? html`<span class="mono sm-text">${used.join(', ')}</span>`
          : html`<span class="muted">${t('logic.unused')}</span>`,
      )}
      <p class="help">${t('logic.w.help')}</p>`,
  );
  return html`<div class="insp3">
    ${group(
      KIND_ICON.writes,
      t('logic.g.general'),
      html`${idInput(c)}
        <p class="help">${t('logic.w.chain')}</p>`,
    )}
    ${target} ${limits}
  </div>`;
}
