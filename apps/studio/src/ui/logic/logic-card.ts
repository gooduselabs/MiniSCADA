// Task card "Khối / Tag" khi editor Logic mở (feature 011, T144 phần còn lại; mockup studio-logic.html cảnh 1): thay Toolbox
// widget của editor Màn hình. Khối: bảy nhóm kèm số dùng / giới hạn, kéo vào bảng khối hoặc nhấp đúp / Enter để thêm (sau
// khối đang chọn nếu cùng nhóm). Tag: ô lọc, danh sách Tag kéo vào ô biểu thức (text/plain là id Tag, textarea nhận thả sẵn).
// Cuối: ước tính ghi retain (như dòng đếm của editor). Dữ liệu chỉ qua binding của Lit.
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import { fold, t, type MessageKey } from '../../i18n/index.ts';
import { formatBytes } from '../../model/device.ts';
import {
  KIND_LIMIT,
  LOGIC_KINDS,
  blockCounts,
  retainBytesPerDay,
  type LogicKind,
} from '../../model/logic-doc.ts';
import { icon } from '../base.ts';
import { KIND_ICON, kindLabel } from './logic-parts.ts';
import type { GateTool } from '../../model/logic-graph-edit.ts';
import type { NodePos } from '../../model/logic-layout.ts';
import { addLogicBlock, isKind, logicDoc, logicUi, projectTags } from './logic-state.ts';

/** Loại dữ liệu kéo thả của một khối (bảng khối của editor nhận). */
export const LOGIC_BLOCK_MIME = 'application/x-mat-logic-block';
/** Feature 015: cổng AND/OR/NOT/so sánh kéo vào một cổng vào trên sơ đồ (bọc biểu thức). */
export const LOGIC_GATE_MIME = 'application/x-mat-logic-gate';
const GATES: readonly GateTool[] = ['and', 'or', 'not', 'cmp'];
/** Số Tag hiện tối đa khi chưa lọc (project 1000 Tag vẫn nhẹ). */
const TAG_SHOW = 200;
const filters = new WeakMap<StudioApp, string>();

function addFromCard(app: StudioApp, kind: LogicKind, full: boolean, at?: NodePos): void {
  if (full) {
    app.toast(t('tc.logic.full', { kind: kindLabel(kind), n: KIND_LIMIT[kind] }));
    return;
  }
  // Sơ đồ đang mở: khối mới ở giữa vùng nhìn (thả: ở chỗ thả).
  addLogicBlock(app, kind, at ?? diagramCenter(app));
}

/** Tâm vùng nhìn của sơ đồ khi editor Logic ở khung nhìn Sơ đồ (undefined: đang ở Bảng). */
export function diagramCenter(app: StudioApp): NodePos | undefined {
  if (logicUi(app).view !== 'diagram' || typeof document === 'undefined') return undefined;
  return document.querySelector('mat-logic-diagram')?.centerPos();
}

/** Thả một khối kéo từ task card lên bảng khối (hoặc sơ đồ, `at`): thêm khối nhóm đó. Trả true khi đã xử lý. */
export function dropLogicBlock(app: StudioApp, e: DragEvent, at?: NodePos): boolean {
  const kind = e.dataTransfer?.getData(LOGIC_BLOCK_MIME) ?? '';
  if (!isKind(kind)) return false;
  e.preventDefault();
  const counts = blockCounts(logicDoc(app));
  addFromCard(app, kind, counts[kind] >= KIND_LIMIT[kind], at);
  return true;
}

export function renderLogicCard(app: StudioApp, refresh: () => void) {
  const doc = logicDoc(app);
  const counts = blockCounts(doc);
  const ro = app.store.state.readOnly;
  const q = filters.get(app) ?? '';
  const query = fold(q).trim();
  const tags = projectTags(app).filter(
    (tg) => !query || fold(`${tg.id} ${tg.description ?? ''}`).includes(query),
  );
  const shown = tags.slice(0, TAG_SHOW);
  return html`<div class="tc-logic">
    <div class="tc-sec2">
      <div class="pane-h">
        <span>${t('tc.logic.blocks')}</span><span class="lc">${t('tc.logic.blocksSub')}</span>
      </div>
      <div class="tc-blocks" role="list">
        ${LOGIC_KINDS.map((k) => {
          const full = counts[k] >= KIND_LIMIT[k];
          const label = kindLabel(k);
          return html`<div
            class="blk"
            role="listitem"
            tabindex="0"
            draggable=${ro ? 'false' : 'true'}
            data-block=${k}
            aria-disabled=${ro || full ? 'true' : 'false'}
            title=${t('tc.logic.blockTip', { kind: label })}
            @dragstart=${(e: DragEvent) => {
              if (!e.dataTransfer) return;
              e.dataTransfer.setData(LOGIC_BLOCK_MIME, k);
              e.dataTransfer.setData('text/plain', label);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            @dblclick=${() => !ro && addFromCard(app, k, full)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== 'Enter' || ro) return;
              e.preventDefault();
              addFromCard(app, k, full);
            }}
          >
            ${icon('grip', 'sm')}${icon(KIND_ICON[k])}<span class="nm">${label}</span
            ><span class="k">${counts[k]}/${KIND_LIMIT[k]}</span>
          </div>`;
        })}
      </div>
    </div>
    ${logicUi(app).view === 'diagram' ? gatesSection(ro) : nothing}
    <div class="tc-sec2 grow">
      <div class="pane-h">
        <span>${t('tc.logic.tags')}</span><span class="lc">${t('tc.logic.tagsSub')}</span>
      </div>
      <div class="tc-tagf">
        <input
          class="input sm tc-tag-filter"
          type="search"
          aria-label=${t('tc.logic.filter')}
          placeholder=${t('tc.logic.filter')}
          .value=${live(q)}
          @input=${(e: Event) => {
            filters.set(app, (e.target as HTMLInputElement).value);
            refresh();
          }}
        />
      </div>
      <div class="tc-tags" role="list" aria-label=${t('tc.logic.tags')}>
        ${
          shown.length === 0
            ? html`<p class="help pad">${t('tc.logic.noTag')}</p>`
            : shown.map(
                (tg) =>
                  html`<div
                    class="tc-tag"
                    role="listitem"
                    tabindex="-1"
                    draggable="true"
                    data-tag=${tg.id}
                    title=${tg.description ?? tg.id}
                    @dragstart=${(e: DragEvent) => {
                      if (!e.dataTransfer) return;
                      e.dataTransfer.setData('text/plain', tg.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    ${icon('tag', 'sm')}<span class="mono nm">${tg.id}</span
                    ><span class="ty">${tg.type}</span>
                  </div>`,
              )
        }
        ${
          tags.length > shown.length
            ? html`<p class="help pad">${t('tc.logic.more', { n: tags.length - shown.length })}</p>`
            : nothing
        }
      </div>
    </div>
    ${
      doc
        ? html`<div class="tc-retain help pad">
            ${t('tc.logic.retain', { size: formatBytes(retainBytesPerDay(doc, 60)) })}
          </div>`
        : nothing
    }
  </div>`;
}

/** Cổng logic kéo vào sơ đồ (feature 015): chỉ ở khung nhìn Sơ đồ. */
function gatesSection(ro: boolean) {
  return html`<div class="tc-sec2">
    <div class="pane-h">
      <span>${t('tc.logic.gates')}</span><span class="lc">${t('tc.logic.gatesSub')}</span>
    </div>
    <div class="tc-gates" role="list">
      ${GATES.map((g) => {
        const label = t(`lgd.gate.${g}` as MessageKey);
        return html`<div
          class="gate"
          role="listitem"
          tabindex="-1"
          draggable=${ro ? 'false' : 'true'}
          data-gate=${g}
          aria-disabled=${ro ? 'true' : 'false'}
          title=${t('tc.logic.gateTip', { gate: label })}
          @dragstart=${(e: DragEvent) => {
            if (!e.dataTransfer) return;
            e.dataTransfer.setData(LOGIC_GATE_MIME, g);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          ${icon('grip', 'sm')}<span class="mono">${label}</span>
        </div>`;
      })}
    </div>
  </div>`;
}
