// Inspector theo loại khối của editor Logic (feature 011, T144; mockup studio-logic.html cảnh 1; điểm chỉnh của T007: nhóm
// rộng tối thiểu 360 px, hẹp thì xếp dọc — CSS `.insp3` lưới auto-fit minmax(360px, 1fr)). Ba nhóm: Chung (id, tên, bật,
// trạng thái trên thiết bị), Điều kiện hoặc Đầu vào (ô biểu thức dùng lại `mat-expression-input`: gợi ý Tag, kiểm khi gõ),
// Hành động hoặc Tham số và đầu ra. Mỗi lần sửa là một sửa đổi `logicSet` (ô biểu thức gộp các lần gõ liên tiếp).
import type { LogicAction, LogicValue } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  addAction,
  findBlock,
  isExprValue,
  removeAction,
  updateAction,
  type Edge,
  type LogicKind,
} from '../../model/logic-doc.ts';
import { icon } from '../base.ts';
import {
  boolInput,
  exprInput,
  frow,
  group,
  idInput,
  liveRows,
  numInput,
  parseNumber,
  patch,
  textInput,
  type FieldCtx,
} from './fields.ts';
import { ACTION_ICON, KIND_ICON, actionLabel, kindLabel } from './logic-parts.ts';
import { editLogic, logicDoc, projectTags } from './logic-state.ts';
import { scheduleInspector } from './schedule-editor.ts';
import { writesInspector } from './writes-editor.ts';

// ---------- Hành động của luật ----------

function parseValue(s: string): LogicValue {
  const v = s.trim();
  if (v.startsWith('=')) return { expr: v.slice(1).trim() };
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && Number.isFinite(Number(v))) return Number(v);
  return v;
}
const showValue = (v: LogicValue | undefined): string =>
  v === undefined ? '' : isExprValue(v) ? `= ${v.expr}` : String(v);

function actionRow(
  c: FieldCtx,
  edge: Edge,
  a: LogicAction,
  i: number,
  writesIds: string[],
  internal: string[],
) {
  const set = (p: Record<string, unknown>) =>
    editLogic(c.app, updateAction(c.doc, c.b.id, edge, i, p));
  const isWrite = a.do === 'write' || a.do === 'pulse';
  const missing = isWrite && !writesIds.includes(a.write ?? '');
  const edgeText = t(edge === 'onRise' ? 'logic.edge.rise' : 'logic.edge.fall');
  const opt = (list: string[], cur: string | undefined) =>
    html`${list.map(
      (x) => html`<option value=${x} ?selected=${x === cur}>${x}</option>`,
    )}${cur !== undefined && cur !== '' && !list.includes(cur) ? html`<option value=${cur} selected>${t('logic.act.missing', { id: cur })}</option>` : nothing}`;
  return html`<div
    class="act ${missing ? 'err' : ''}"
    data-edge=${edge}
    data-i=${i}
    title=${missing ? 'E_LOGIC_WRITE_UNDECLARED' : nothing}
  >
    <span class="n">${i + 1}</span>${icon(ACTION_ICON[a.do] ?? 'info')}
    <select
      class="select sm"
      aria-label=${t('logic.act.kindOf', { n: i + 1, edge: edgeText })}
      data-act-field="do"
      ?disabled=${c.ro}
      @change=${(e: Event) => {
        const d = (e.target as HTMLSelectElement).value;
        const next: Record<string, unknown> = { do: d };
        if (d === 'write' || d === 'pulse') next.write = a.write ?? writesIds[0] ?? '';
        else next.tag = a.tag ?? internal[0] ?? '';
        if (d !== 'toggle') next.value = a.value ?? true;
        if (d === 'pulse') next.ms = a.ms ?? 500;
        set(next);
      }}
    >
      ${['setTag', 'toggle', 'write', 'pulse'].map(
        (d) => html`<option value=${d} ?selected=${d === a.do}>${actionLabel(d)}</option>`,
      )}
    </select>
    ${
      isWrite
        ? html`<select
            class="select sm mono"
            data-act-field="write"
            aria-label=${t('logic.act.writeOf', { n: i + 1, edge: edgeText })}
            ?disabled=${c.ro}
            @change=${(e: Event) => set({ write: (e.target as HTMLSelectElement).value })}
          >
            ${opt(writesIds, a.write)}
          </select>`
        : html`<select
            class="select sm mono"
            data-act-field="tag"
            aria-label=${t('logic.act.tag', { n: i + 1, edge: edgeText })}
            ?disabled=${c.ro}
            @change=${(e: Event) => set({ tag: (e.target as HTMLSelectElement).value })}
          >
            ${opt(internal, a.tag)}
          </select>`
    }
    ${
      a.do !== 'toggle'
        ? html`<input
            class="input sm mono act-v"
            data-act-field="value"
            aria-label=${t('logic.act.value', { n: i + 1, edge: edgeText })}
            title=${t('logic.act.valueTip')}
            ?readonly=${c.ro}
            .value=${showValue(a.value)}
            @change=${(e: Event) => set({ value: parseValue((e.target as HTMLInputElement).value) })}
          />`
        : nothing
    }
    ${
      a.do === 'pulse'
        ? html`<input
              class="input sm num act-ms"
              data-act-field="ms"
              inputmode="numeric"
              aria-label=${t('logic.act.ms', { n: i + 1, edge: edgeText })}
              ?readonly=${c.ro}
              .value=${String(a.ms ?? '')}
              @change=${(e: Event) => {
                const n = parseNumber((e.target as HTMLInputElement).value, true);
                if (n !== null) set({ ms: n });
              }}
            /><span class="muted">ms</span>`
        : nothing
    }
    <button
      type="button"
      class="ibtn sm"
      data-act="del-action"
      ?disabled=${c.ro}
      aria-label=${t('logic.act.delete', { n: i + 1, edge: edgeText })}
      @click=${() => editLogic(c.app, removeAction(c.doc, c.b.id, edge, i))}
    >
      ${icon('x')}
    </button>
  </div>`;
}

function actionsGroup(c: FieldCtx): TemplateResult {
  const writesIds = (c.doc.writes ?? []).map((w) => w.id);
  const logicOut = new Set(
    [
      ...(c.doc.timers ?? []),
      ...(c.doc.counters ?? []),
      ...(c.doc.totalizers ?? []),
      ...(c.doc.runhours ?? []),
      ...(c.doc.schedules ?? []),
    ].flatMap((b) => Object.values(b).filter((v): v is string => typeof v === 'string')),
  );
  const internal = projectTags(c.app)
    .filter((x) => x.kind === 'internal' && !logicOut.has(x.id))
    .map((x) => x.id);
  const list = (edge: Edge) => (c.b[edge] as LogicAction[] | undefined) ?? [];
  const total = list('onRise').length + list('onFall').length;
  const adds = (edge: Edge) =>
    html`<div
      class="addacts"
      role="group"
      aria-label=${t('logic.act.addGroup', { edge: t(edge === 'onRise' ? 'logic.edge.rise' : 'logic.edge.fall') })}
    >
      ${(['setTag', 'toggle', 'write', 'pulse'] as const).map(
        (d) =>
          html`<button
            type="button"
            class="addact"
            data-add-action="${edge}:${d}"
            ?disabled=${c.ro || total >= 8}
            @click=${() => {
              const a: LogicAction =
                d === 'write'
                  ? { do: 'write', write: writesIds[0] ?? '', value: true }
                  : d === 'pulse'
                    ? { do: 'pulse', write: writesIds[0] ?? '', value: true, ms: 500 }
                    : d === 'toggle'
                      ? { do: 'toggle', tag: internal[0] ?? '' }
                      : { do: 'setTag', tag: internal[0] ?? '', value: true };
              editLogic(c.app, addAction(c.doc, c.b.id, edge, a));
            }}
          >
            ${icon('plus', 'sm')}${actionLabel(d)}
          </button>`,
      )}
    </div>`;
  const usesWrite = [...list('onRise'), ...list('onFall')].some(
    (a) => a.do === 'write' || a.do === 'pulse',
  );
  return group(
    'play',
    t('logic.g.actions'),
    html`<div class="minihead">${t('logic.edge.rise')} <span class="muted mono">onRise</span></div>
      <div class="acts">
        ${list('onRise').map((a, i) => actionRow(c, 'onRise', a, i, writesIds, internal))}
        ${adds('onRise')}
      </div>
      <div class="minihead">${t('logic.edge.fall')} <span class="muted mono">onFall</span></div>
      <div class="acts">
        ${list('onFall').map((a, i) => actionRow(c, 'onFall', a, i, writesIds, internal))}
        ${adds('onFall')}
      </div>
      <p class="help">${t(usesWrite ? 'logic.act.writeHelp' : 'logic.act.noWrite')}</p>`,
    `${total} / 8`,
  );
}

// ---------- Inspector từng loại ----------

function ruleInspector(c: FieldCtx): TemplateResult {
  return html`<div class="insp3">
    ${group(
      KIND_ICON.rule,
      t('logic.g.general'),
      html`${idInput(c)} ${textInput(c, 'name', t('logic.f.name'), { empty: 'remove' })}
      ${boolInput(c, 'enabled', t('logic.f.enabled'), c.b.enabled === false ? t('logic.f.disabledText') : t('logic.f.enabledText'), true)}
      ${liveRows(c)}`,
    )}
    ${group(
      'fx',
      t('logic.g.condition'),
      html`${exprInput(c, 'when', html`${t('logic.f.when')} <span class="mono">when</span>`, 'BOOL', { sub: t('logic.f.whenHelp') })}
      ${numInput(c, 'hold', html`${t('logic.f.hold')} <span class="mono">hold</span>`, { unit: 'ms', sub: t('logic.f.holdHelp') })}
      ${numInput(c, 'repeatMs', html`${t('logic.f.repeat')} <span class="mono">repeatMs</span>`, { unit: 'ms', sub: t('logic.f.repeatHelp') })}
      ${boolInput(c, 'fireOnStart', t('logic.f.start'), t('logic.f.fireOnStart'))}`,
    )}
    ${actionsGroup(c)}
  </div>`;
}

const HELP: Readonly<Partial<Record<LogicKind, MessageKey>>> = {
  counter: 'logic.help.counter',
  totalizer: 'logic.help.totalizer',
  runhours: 'logic.help.runhours',
};

const outTitle = () => t('logic.f.outTip');

function timerInspector(c: FieldCtx): TemplateResult {
  const k = String(c.b.kind ?? 'ton');
  return html`<div class="insp3">
    ${group(
      KIND_ICON.timer,
      t('logic.g.general'),
      html`${idInput(c)}
        ${frow(
          t('logic.f.timerKind'),
          html`<span class="seg" role="group" aria-label=${t('logic.f.timerKind')}>
            ${['ton', 'tof', 'tp'].map(
              (x) =>
                html`<button
                  type="button"
                  data-timer-kind=${x}
                  aria-pressed=${x === k ? 'true' : 'false'}
                  ?disabled=${c.ro}
                  @click=${() => patch(c, { kind: x })}
                >
                  ${x}
                </button>`,
            )}
          </span>`,
        )}
        ${liveRows(c)}
        <p class="help">
          ${t(`logic.help.${k === 'tof' ? 'tof' : k === 'tp' ? 'tp' : 'ton'}` as MessageKey)}
        </p>`,
    )}
    ${group('fx', t('logic.g.input'), exprInput(c, 'in', html`${t('logic.f.in')} <span class="mono">in</span>`, 'BOOL'))}
    ${group(
      'gear',
      t('logic.g.params'),
      html`${numInput(c, 'pt', html`pt`, { unit: 'ms' })}
      ${textInput(c, 'q', t('logic.f.outQ'), { mono: true, title: outTitle() })}
      ${textInput(c, 'et', t('logic.f.outEt'), { mono: true, title: outTitle(), empty: 'remove' })}`,
    )}
  </div>`;
}

function counterLike(c: FieldCtx): TemplateResult {
  const k = c.kind;
  const inputs =
    k === 'counter'
      ? html`${exprInput(c, 'up', html`${t('logic.f.up')} <span class="mono">up</span>`, 'BOOL')}
        ${exprInput(c, 'down', html`${t('logic.f.down')} <span class="mono">down</span>`, 'BOOL', { nullable: true })}
        ${exprInput(c, 'reset', html`${t('logic.f.reset')} <span class="mono">reset</span>`, 'BOOL', { nullable: true })}`
      : k === 'totalizer'
        ? html`${exprInput(c, 'source', html`${t('logic.f.source')} <span class="mono">source</span>`, 'FLOAT64')}
          ${exprInput(c, 'reset', html`${t('logic.f.reset')} <span class="mono">reset</span>`, 'BOOL', { nullable: true })}`
        : html`${exprInput(c, 'run', html`${t('logic.f.run')} <span class="mono">run</span>`, 'BOOL')}
          ${exprInput(c, 'reset', html`${t('logic.f.reset')} <span class="mono">reset</span>`, 'BOOL', { nullable: true })}`;
  const params =
    k === 'counter'
      ? html`${numInput(c, 'preset', t('logic.f.preset'), { nullable: true })}
        ${textInput(c, 'value', t('logic.f.outValue'), { mono: true, title: outTitle() })}
        ${textInput(c, 'reached', t('logic.f.outReached'), { mono: true, title: outTitle(), empty: 'remove' })}`
      : k === 'totalizer'
        ? html`${frow(
            t('logic.f.rateUnit'),
            html`<select
              class="select sm"
              data-field="rateUnit"
              aria-label=${t('logic.f.rateUnit')}
              ?disabled=${c.ro}
              @change=${(e: Event) => patch(c, { rateUnit: (e.target as HTMLSelectElement).value })}
            >
              ${['s', 'min', 'h', 'd'].map(
                (u) =>
                  html`<option value=${u} ?selected=${u === c.b.rateUnit}>
                    ${t(`logic.unit.${u}` as MessageKey)}
                  </option>`,
              )}
            </select>`,
          )}
          ${numInput(c, 'factor', t('logic.f.factor'), { int: false })}
          ${numInput(c, 'cutoff', t('logic.f.cutoff'), { int: false })}
          ${numInput(c, 'maxGapMs', t('logic.f.maxGap'), { unit: 'ms' })}
          ${numInput(c, 'rolloverAt', t('logic.f.rollover'), { int: false, nullable: false })}
          ${textInput(c, 'total', t('logic.f.outTotal'), { mono: true, title: outTitle() })}
          ${textInput(c, 'gapSeconds', t('logic.f.outGap'), { mono: true, title: outTitle(), empty: 'remove' })}`
        : html`${numInput(c, 'serviceEveryHours', t('logic.f.service'), { int: false, nullable: true, unit: 'h' })}
          ${textInput(c, 'hours', t('logic.f.outHours'), { mono: true, title: outTitle() })}
          ${textInput(c, 'starts', t('logic.f.outStarts'), { mono: true, title: outTitle(), empty: 'remove' })}
          ${textInput(c, 'due', t('logic.f.outDue'), { mono: true, title: outTitle(), empty: 'remove' })}`;
  return html`<div class="insp3">
    ${group(
      KIND_ICON[k],
      t('logic.g.general'),
      html`${idInput(c)} ${liveRows(c)}
        <p class="help">${t(HELP[k]!)}</p>`,
    )}
    ${group('fx', t('logic.g.input'), inputs)}
    ${group(
      'gear',
      t('logic.g.params'),
      html`${params} ${boolInput(c, 'retain', t('logic.f.retain'), t('logic.f.retainText'), true)}`,
    )}
  </div>`;
}

/** Nội dung Inspector của khối đang chọn. */
export function blockInspector(app: StudioApp, kind: LogicKind, id: string | null): TemplateResult {
  const doc = logicDoc(app);
  const b = doc && id !== null ? findBlock(doc, kind, id) : null;
  if (!doc || !b)
    return html`<p class="help pad">${t('logic.insp.none', { kind: kindLabel(kind) })}</p>`;
  const c: FieldCtx = { app, doc, kind, b, ro: app.store.state.readOnly };
  switch (kind) {
    case 'rule':
      return ruleInspector(c);
    case 'timer':
      return timerInspector(c);
    case 'schedule':
      return scheduleInspector(c);
    case 'writes':
      return writesInspector(c);
    default:
      return counterLike(c);
  }
}
