// Ô nhập dùng chung của Inspector Logic (feature 011, T144): số, chữ, BOOL, ô biểu thức (dùng lại `mat-expression-input`:
// gợi ý Tag của project và Tag logic, kiểm khi gõ), ô Id (đổi id cập nhật tham chiếu), dòng trạng thái trên thiết bị, nhóm.
import type { TagDataType } from '@mat/expression';
import type { LogicDoc } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import {
  findBlock,
  logicAssist,
  renameBlock,
  updateBlock,
  type Block,
  type LogicKind,
} from '../../model/logic-doc.ts';
import { isDeviceError } from '../../platform/device-types.ts';
import { icon } from '../base.ts';
import '../editors/expression-input.ts';
import { stateChip } from './logic-parts.ts';
import {
  editLogic,
  liveOnline,
  logicDoc,
  logicUi,
  projectTags,
  refreshLive,
  select,
  tableNames,
} from './logic-state.ts';

// ---------- Ô nhập dùng chung ----------

export interface FieldCtx {
  app: StudioApp;
  doc: LogicDoc;
  kind: LogicKind;
  b: Block;
  ro: boolean;
}

export const patch = (c: FieldCtx, p: Record<string, unknown>, merge?: string): void =>
  editLogic(c.app, updateBlock(c.doc, c.kind, c.b.id, p), merge);

export const frow = (label: unknown, control: unknown, sub?: unknown): TemplateResult =>
  html`<div class="fr">
    <span class="lbl">${label}</span
    >${control}${sub ? html`<span class="sub">${sub}</span>` : nothing}
  </div>`;

export const lblFor = (id: string, text: unknown) => html`<label for=${id}>${text}</label>`;

let uid = 0;
const nextId = (f: string) => `lgf-${f}-${++uid}`;

/** Số gõ kiểu Việt: bỏ dấu chấm và khoảng trắng phân nhóm nghìn khi là số nguyên; dấu phẩy là dấu thập phân. */
export function parseNumber(s: string, int: boolean): number | null {
  let v = s.trim().replace(/\s/g, '');
  if (v === '') return null;
  if (int) v = v.replace(/\./g, '');
  v = v.replace(',', '.');
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return int ? Math.round(n) : n;
}

export function numInput(
  c: FieldCtx,
  field: string,
  label: unknown,
  opts: { int?: boolean; unit?: string; nullable?: boolean; sub?: unknown } = {},
): TemplateResult {
  const id = nextId(field);
  const v = c.b[field];
  const int = opts.int ?? true;
  return html`<div class="fr">
    ${lblFor(id, label)}
    <span class="unit">
      <input
        id=${id}
        class="input sm num"
        inputmode=${int ? 'numeric' : 'decimal'}
        data-field=${field}
        ?readonly=${c.ro}
        .value=${typeof v === 'number' ? String(v) : ''}
        @change=${(e: Event) => {
          const el = e.target as HTMLInputElement;
          const n = parseNumber(el.value, int);
          if (n === null && !opts.nullable) {
            el.value = typeof v === 'number' ? String(v) : '';
            return;
          }
          patch(c, { [field]: n === null ? (opts.nullable ? null : undefined) : n });
        }}
      />${opts.unit ? html`<span class="muted">${opts.unit}</span>` : nothing}
    </span>
    ${opts.sub ? html`<span class="sub">${opts.sub}</span>` : nothing}
  </div>`;
}

export function textInput(
  c: FieldCtx,
  field: string,
  label: unknown,
  opts: { mono?: boolean; title?: string; empty?: 'remove' | 'keep' } = {},
): TemplateResult {
  const id = nextId(field);
  const v = c.b[field];
  return html`<div class="fr">
    ${lblFor(id, label)}
    <input
      id=${id}
      class="input sm ${opts.mono ? 'mono' : ''}"
      data-field=${field}
      title=${opts.title ?? nothing}
      spellcheck="false"
      ?readonly=${c.ro}
      .value=${typeof v === 'string' ? v : ''}
      @change=${(e: Event) => {
        const s = (e.target as HTMLInputElement).value;
        patch(c, { [field]: s === '' && opts.empty === 'remove' ? undefined : s });
      }}
    />
  </div>`;
}

export function boolInput(c: FieldCtx, field: string, label: unknown, text: unknown, def = false) {
  const v = c.b[field];
  const on = typeof v === 'boolean' ? v : def;
  return frow(
    label,
    html`<label class="row inline"
      ><input
        type="checkbox"
        data-field=${field}
        ?disabled=${c.ro}
        .checked=${on}
        @change=${(e: Event) => patch(c, { [field]: (e.target as HTMLInputElement).checked })}
      /><span class="sm-text">${text}</span></label
    >`,
  );
}

/** Ô biểu thức (ADR-015): gợi ý Tag của project và Tag logic, kiểm khi gõ; trống ở ô tùy chọn là `null`. */
export function exprInput(
  c: FieldCtx,
  field: string,
  label: unknown,
  target: TagDataType,
  opts: { nullable?: boolean; sub?: unknown } = {},
): TemplateResult {
  const v = c.b[field];
  const assist = logicAssist(projectTags(c.app), c.doc, target, tableNames(c.app));
  const commit = (s: string, merge?: string) => {
    const cur = logicDoc(c.app);
    if (!cur) return;
    const value = s.trim() === '' && opts.nullable ? null : s;
    const now = findBlock(cur, c.kind, c.b.id)?.[field];
    if (now === value || (now === undefined && value === null)) return;
    editLogic(c.app, updateBlock(cur, c.kind, c.b.id, { [field]: value }), merge);
  };
  return html`<div class="fr fr-ex">
    <span class="lbl">${label}</span>
    <mat-expression-input
      data-field=${field}
      .app=${c.app}
      .value=${typeof v === 'string' ? v : ''}
      .assist=${assist}
      .label=${typeof label === 'string' ? label : field}
      ?disabled=${c.ro}
      @expr-input=${(e: CustomEvent<{ value: string }>) =>
        commit(e.detail.value, `logic:${c.b.id}:${field}`)}
      @expr-commit=${(e: CustomEvent<{ value: string }>) => commit(e.detail.value)}
    ></mat-expression-input>
    ${opts.sub ? html`<span class="sub">${opts.sub}</span>` : nothing}
  </div>`;
}

/** Ô Id: đổi id cập nhật mọi tham chiếu; sai dạng hoặc trùng thì báo, không đổi. */
export function idInput(c: FieldCtx): TemplateResult {
  const ui = logicUi(c.app);
  const id = nextId('id');
  const msg = ui.idMsg && ui.idMsg.id === c.b.id ? ui.idMsg.reason : null;
  return html`<div class="fr">
      ${lblFor(id, t('logic.f.id'))}
      <input
        id=${id}
        class="input sm mono ${msg ? 'err' : ''}"
        data-field="id"
        spellcheck="false"
        autocomplete="off"
        aria-invalid=${msg ? 'true' : 'false'}
        aria-describedby=${msg ? `${id}-m` : nothing}
        ?readonly=${c.ro}
        .value=${c.b.id}
        @change=${(e: Event) => {
          const to = (e.target as HTMLInputElement).value.trim();
          const r = renameBlock(c.doc, c.b.id, to);
          if (!r.ok) {
            ui.idMsg = { id: c.b.id, reason: r.reason === 'missing' ? 'format' : r.reason };
            c.app.requestRender();
            return;
          }
          ui.idMsg = null;
          editLogic(c.app, r.doc);
          select(c.app, c.kind, to);
        }}
      />
      ${
        msg
          ? html`<span class="sub errc" id="${id}-m" data-role="id-msg" role="alert"
              >${t(msg === 'duplicate' ? 'logic.id.duplicate' : 'logic.id.format')}</span
            >`
          : nothing
      }
    </div>
    <p class="help">${t('logic.id.help', { re: '^[a-z][a-z0-9_]{0,47}$' })}</p>`;
}

/** Dòng "Trên thiết bị" khi Online; khối có giá trị giữ (counter, cộng dồn, giờ chạy): nút Đặt lại. */
export function liveRows(c: FieldCtx): TemplateResult | typeof nothing {
  const live = logicUi(c.app).live;
  if (!live || !liveOnline(c.app)) return nothing;
  const st = live.blocks.get(c.b.id);
  const resettable = c.kind === 'counter' || c.kind === 'totalizer' || c.kind === 'runhours';
  return html`${frow(t('logic.f.onDevice'), st ? stateChip(st.state, st.reason) : html`<span class="muted">—</span>`)}
  ${
    st && c.kind === 'rule'
      ? frow(
          t('logic.f.lastFired'),
          html`<span class="mono sm-text"
            >${st.lastFired ?? '—'} · ${t('logic.f.firedN', { n: st.fired ?? 0 })}</span
          >`,
        )
      : nothing
  }
  ${
    resettable && st
      ? frow(
          '',
          html`<button
            type="button"
            class="btn sm"
            data-act="reset-block"
            title=${t('logic.reset.tip')}
            @click=${async () => {
              const r = await c.app.session.resetLogicBlock(c.b.id, 0);
              c.app.toast(
                isDeviceError(r)
                  ? t('logic.reset.fail', { id: c.b.id, code: r.error })
                  : t('logic.reset.ok', { id: c.b.id }),
              );
              refreshLive(c.app);
            }}
          >
            ${icon('refresh')}${t('logic.reset.button')}
          </button>`,
        )
      : nothing
  }`;
}

export const group = (ic: IconName, title: unknown, body: unknown, extra?: unknown) =>
  html`<section class="igrp">
    <h4>${icon(ic)}${title}${extra ? html` <span class="cnt">${extra}</span>` : nothing}</h4>
    ${body}
  </section>`;
