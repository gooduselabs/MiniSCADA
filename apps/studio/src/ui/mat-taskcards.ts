// Task card bên phải (feature 004, T050, FR-001, studio-ux.md §3): dải tab dọc (Toolbox, Thư viện, Công
// cụ online, Tìm) và vùng nội dung thu gọn được. Toolbox và Thư viện chỉ giới thiệu widget của GĐ 3a/3b
// (nhấp hay kéo đều báo giai đoạn); Công cụ online tóm tắt thiết bị khi đang theo dõi; Tìm tìm Tag và
// phần tử màn hình (Ctrl+F đưa focus vào ô tìm).
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { TaskCard } from '../app/workspace.ts';
import { fold, t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import type { DeviceInfo } from '../model/device.ts';
import { phaseLabel, type Phase } from '../model/tree.ts';
import { AppElement, icon } from './base.ts';
import {
  metric,
  projectIcon,
  projectOf,
  projectText,
  sessionHost,
  sessionsOf,
} from './diagnostics.ts';

const CARDS: ReadonlyArray<{ id: TaskCard; label: MessageKey; icon: IconName }> = [
  { id: 'toolbox', label: 'tc.toolbox', icon: 'toolbox' },
  { id: 'library', label: 'tc.library', icon: 'library' },
  { id: 'online', label: 'tc.online', icon: 'pulse' },
  { id: 'find', label: 'tc.find', icon: 'search' },
];

type Tool = readonly [IconName, MessageKey];

const TOOLBOX: ReadonlyArray<{ group: MessageKey; phase: Phase; tools: readonly Tool[] }> = [
  {
    group: 'tc.group.display',
    phase: 'p3a',
    tools: [
      ['card', 'tc.tool.card'],
      ['text', 'tc.tool.text'],
      ['lamp', 'tc.tool.lamp'],
      ['gauge', 'tc.tool.gauge'],
      ['tank', 'tc.tool.level'],
    ],
  },
  {
    group: 'tc.group.control',
    phase: 'p3a',
    tools: [
      ['button', 'tc.tool.button'],
      ['switch', 'tc.tool.switch'],
      ['input', 'tc.tool.setpoint'],
      ['slider', 'tc.tool.slider'],
    ],
  },
  {
    group: 'tc.group.chart',
    phase: 'p3a',
    tools: [
      ['line', 'tc.tool.line'],
      ['bar', 'tc.tool.bar'],
      ['pie', 'tc.tool.pie'],
    ],
  },
  {
    group: 'tc.group.alarm',
    phase: 'p4',
    tools: [
      ['bell', 'tc.tool.alarmTable'],
      ['bell', 'tc.tool.alarmBanner'],
    ],
  },
  {
    group: 'tc.group.symbols',
    phase: 'p3b',
    tools: [
      ['pump', 'tc.tool.pump'],
      ['valve', 'tc.tool.valve'],
      ['tank', 'tc.tool.tank'],
      ['motor', 'tc.tool.motor'],
      ['pipe', 'tc.tool.pipe'],
    ],
  },
];

interface FindHit {
  key: string;
  icon: IconName;
  title: string;
  sub: string;
  open: () => void;
}

export class MatTaskcards extends AppElement {
  private openGroups = new Set<MessageKey>(['tc.group.display', 'tc.group.control']);

  protected override attached(): void {
    this.app.hooks.focusFind = () =>
      void this.updateComplete.then(() =>
        this.querySelector<HTMLInputElement>('input.tc-find')?.focus(),
      );
  }

  private onStripKey(e: KeyboardEvent, card: TaskCard): void {
    const i = CARDS.findIndex((c) => c.id === card);
    let j: number;
    if (e.key === 'ArrowDown') j = (i + 1) % CARDS.length;
    else if (e.key === 'ArrowUp') j = (i - 1 + CARDS.length) % CARDS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = CARDS.length - 1;
    else return;
    e.preventDefault();
    this.querySelectorAll<HTMLElement>('.tc-strip [role="tab"]')[j]?.focus();
  }

  private tool([ic, name]: Tool, phase: Phase) {
    const label = t(name);
    const soon = t('tc.toolSoon', { name: label, phase: phaseLabel(phase) });
    return html`<button
      type="button"
      class="tool"
      draggable="true"
      title=${soon}
      @dragstart=${(e: DragEvent) => e.dataTransfer?.setData('text/plain', `widget:${label}`)}
      @click=${() => this.app.toast(soon)}
    >
      ${icon(ic, 'lg')}<span>${label}</span>
    </button>`;
  }

  private toolbox() {
    const phases = this.app.workspace.showPhases;
    return TOOLBOX.map(({ group, phase, tools }) => {
      const open = this.openGroups.has(group);
      return html`<div class="acc">
        <button
          type="button"
          aria-expanded=${open ? 'true' : 'false'}
          @click=${() => {
            if (this.openGroups.has(group)) this.openGroups.delete(group);
            else this.openGroups.add(group);
            this.requestUpdate();
          }}
        >
          ${icon(open ? 'chev-d' : 'chev-r', 'sm')}<span>${t(group)}</span>
          <span class="grow"></span>
          ${phases ? html`<span class="phase">${phaseLabel(phase)}</span>` : nothing}
        </button>
        ${open ? html`<div class="items">${tools.map((x) => this.tool(x, phase))}</div>` : nothing}
      </div>`;
    });
  }

  private library() {
    const phases = this.app.workspace.showPhases;
    const chip = phases ? html`<span class="phase">${phaseLabel('p3b')}</span>` : nothing;
    const symbols: Tool[] = [
      ['pump', 'tc.tool.pump'],
      ['valve', 'tc.tool.valve'],
      ['tank', 'tc.tool.tank'],
      ['motor', 'tc.tool.motor'],
      ['pipe', 'tc.tool.pipe'],
    ];
    return html`<div class="tc-sec">${t('tc.lib.project')} ${chip}</div>
      <div class="empty">
        ${icon('library', 'lg')}
        <p>${t('tc.lib.empty')}</p>
      </div>
      <div class="tc-sec">${t('tc.lib.common')} ${chip}</div>
      <div class="items">${symbols.map((x) => this.tool(x, 'p3b'))}</div>`;
  }

  /** Tóm tắt thiết bị: runtime, client trên tối đa, project trên thiết bị. */
  private deviceSummary(info: DeviceInfo) {
    const project = projectOf(this.app, info);
    const sessions = sessionsOf(info);
    return html`<div class="mini">
      ${metric(t('device.info.runtime'), info.runtimeVersion ?? t('device.info.unknown'))}
      ${metric(t('tc.online.clients'), sessions.text, { frac: sessions.frac })}
      ${metric(
        t('tc.online.project'),
        projectText(project) ?? t('device.info.unknown'),
        projectIcon(project),
      )}
    </div>`;
  }

  /**
   * Công cụ online (T074, mockup bản 1): tóm tắt thiết bị đang theo dõi, Mở web thiết bị; ghi xuống
   * thiết bị bị khóa (feature 005).
   */
  private online() {
    const app = this.app;
    if (!app.online())
      return html`<div class="empty">
        ${icon('pulse', 'lg')}<b>${t('tc.online.offTitle')}</b>
        <p>${t('tc.online.offText')}</p>
        <button class="btn" type="button" @click=${() => void app.run('online.connect')}>
          ${icon('online')}${t('cmd.online.connect')}
        </button>
      </div>`;
    const session = app.session;
    const info = session.info;
    const state =
      session.state === 'lost'
        ? t('device.state.lost')
        : session.state === 'full'
          ? t('sb.full')
          : session.state === 'connecting'
            ? t('sb.connecting', { address: sessionHost(app) })
            : null;
    const writeReason = app.enabled('online.download');
    return html`<div class="tc-sec">
        ${icon('device', 'sm')}<span>${t('tree.device')}</span
        ><span class="mono">${sessionHost(app)}</span>
      </div>
      ${state ? html`<p class="help pad" role="status">${state}</p>` : nothing}
      ${info ? this.deviceSummary(info) : nothing}
      <div class="tc-actions">
        <button class="btn" type="button" @click=${() => void app.run('online.openWeb')}>
          ${icon('ext')}${t('cmd.online.openWeb')}
        </button>
        <button
          class="btn"
          type="button"
          data-cmd="online.download"
          aria-disabled=${writeReason === true ? nothing : 'true'}
          title=${writeReason === true ? t('cmd.online.download') : t(writeReason)}
          @click=${() => void app.run('online.download')}
        >
          ${icon(writeReason === true ? 'download' : 'lock')}${t('tc.online.write')}
        </button>
      </div>
      <p class="help pad">${t('tc.online.readonly')}</p>`;
  }

  private hits(q: string): FindHit[] {
    const app = this.app;
    const s = app.store.state;
    const query = fold(q).trim();
    if (!query || !s.project) return [];
    const out: FindHit[] = [];
    (s.outline.tags?.tags ?? []).forEach((tag, row) => {
      const id = typeof tag.id === 'string' ? tag.id : '';
      const desc = typeof tag.description === 'string' ? tag.description : '';
      if (fold(`${id} ${desc}`).includes(query))
        out.push({
          key: `tag-${row}`,
          icon: 'tag',
          title: id,
          sub: t('tc.find.tag', { type: String(tag.type ?? '') }),
          open: () => app.revealTag(row),
        });
    });
    for (const scr of s.outline.screens) {
      const screenName = typeof scr.screen?.name === 'string' ? scr.screen.name : scr.id;
      for (const el of scr.screen?.elements ?? []) {
        const name = typeof el.name === 'string' ? el.name : '';
        if (fold(`${name} ${el.elementUid}`).includes(query))
          out.push({
            key: `el-${scr.id}-${el.elementUid}`,
            icon: 'shape',
            title: name || el.elementUid,
            sub: t('tc.find.element', { screen: screenName }),
            open: () => {
              app.openEditor(`screen:${scr.id}`);
              app.select({ kind: 'element', screen: scr.id, uid: el.elementUid });
            },
          });
      }
    }
    return out;
  }

  private find() {
    const app = this.app;
    const q = app.ui.findQuery;
    const hits = this.hits(q);
    return html`<div class="find">
      <input
        class="input tc-find"
        type="search"
        aria-label=${t('tc.find.label')}
        placeholder=${t('tc.find.placeholder')}
        .value=${live(q)}
        @input=${(e: Event) => app.setFindQuery((e.target as HTMLInputElement).value)}
      />
      ${
        !q.trim()
          ? html`<p class="help">${t('tc.find.hint')}</p>`
          : hits.length
            ? hits.map(
                (h) =>
                  html`<button class="find-row" type="button" @click=${h.open}>
                    ${icon(h.icon)}<span><b>${h.title}</b><small>${h.sub}</small></span>
                  </button>`,
              )
            : html`<p class="help">${t('tc.find.none')}</p>`
      }
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const { taskCard, taskCardOpen } = app.workspace;
    const card = CARDS.find((c) => c.id === taskCard) ?? CARDS[0];
    const body =
      taskCard === 'toolbox'
        ? this.toolbox()
        : taskCard === 'library'
          ? this.library()
          : taskCard === 'online'
            ? this.online()
            : this.find();
    return html`${
        taskCardOpen
          ? html`<div
              class="tc-panel"
              id="tc-panel"
              role="tabpanel"
              aria-labelledby="tc-tab-${card.id}"
            >
              <div class="pane-h">
                <span>${t(card.label)}</span>
                <button
                  class="ibtn sm"
                  type="button"
                  aria-label=${t('tc.collapse')}
                  title=${t('tc.collapse')}
                  @click=${() => void app.run('view.taskCards')}
                >
                  ${icon('chev-r', 'sm')}
                </button>
              </div>
              <div class="tc-body">${body}</div>
            </div>`
          : nothing
      }
      <div
        class="tc-strip"
        role="tablist"
        aria-label=${t('shell.taskCards')}
        aria-orientation="vertical"
      >
        ${CARDS.map(
          (c) =>
            html`<button
              type="button"
              role="tab"
              id="tc-tab-${c.id}"
              data-tc=${c.id}
              aria-selected=${taskCardOpen && taskCard === c.id ? 'true' : 'false'}
              aria-controls=${taskCardOpen ? 'tc-panel' : nothing}
              tabindex=${taskCard === c.id ? 0 : -1}
              @click=${() => app.setTaskCard(c.id)}
              @keydown=${(e: KeyboardEvent) => this.onStripKey(e, c.id)}
            >
              ${icon(c.icon)}<span>${t(c.label)}</span>
            </button>`,
        )}
      </div>`;
  }
}

customElements.define('mat-taskcards', MatTaskcards);

declare global {
  interface HTMLElementTagNameMap {
    'mat-taskcards': MatTaskcards;
  }
}
