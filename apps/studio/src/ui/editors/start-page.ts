// Tab Bắt đầu (feature 004, T053, FR-003, mockup bản 1): tóm tắt project đang mở, tác vụ nhanh, tối đa 10
// project gần đây (mục mất thư mục thì báo và cho bỏ khỏi danh sách), lộ trình v2 (chức năng nào ở giai
// đoạn nào). Không đóng được. Chưa mở project (2026-10-20): hai nút lớn Tạo project mới (Ctrl+N) và Mở project… (Ctrl+O),
// danh sách gần đây ngay dưới.
import { html, nothing } from 'lit';
import { commandById, type CommandId } from '../../app/commands.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import type { RecentEntry } from '../../platform/types.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';

interface RoadmapRow {
  k: MessageKey;
  title: MessageKey;
  text: MessageKey;
  cls: '' | 'done' | 'now';
}

// Khóa viết đủ (không dựng chuỗi) để TypeScript kiểm mọi khóa có trong vi.ts.
const ROADMAP: readonly RoadmapRow[] = [
  { k: 'road.done', title: 'road.done.title', text: 'road.done.text', cls: 'done' },
  { k: 'road.p0', title: 'road.p0.title', text: 'road.p0.text', cls: 'done' },
  { k: 'road.p1', title: 'road.p1.title', text: 'road.p1.text', cls: 'now' },
  { k: 'road.p2', title: 'road.p2.title', text: 'road.p2.text', cls: '' },
  { k: 'road.p3a', title: 'road.p3a.title', text: 'road.p3a.text', cls: '' },
  { k: 'road.p3b', title: 'road.p3b.title', text: 'road.p3b.text', cls: '' },
  { k: 'road.p45', title: 'road.p45.title', text: 'road.p45.text', cls: '' },
  { k: 'road.p6', title: 'road.p6.title', text: 'road.p6.text', cls: '' },
];

export class StartPage extends AppElement {
  private tile(cmd: CommandId, ic: IconName, title: MessageKey, text: string) {
    const app = this.app;
    const enabled = app.enabled(cmd);
    const reason = enabled === true ? null : t(enabled);
    return html`<button
      class="tile"
      type="button"
      data-cmd=${cmd}
      aria-disabled=${reason ? 'true' : nothing}
      title=${reason ?? nothing}
      @click=${() => void app.run(cmd)}
    >
      ${icon(ic)}<b>${t(title)}</b><span>${reason ?? text}</span>
    </button>`;
  }

  private recentRow(r: RecentEntry) {
    const app = this.app;
    const current = app.store.state.project?.display === r.display;
    const when = new Date(r.openedAt);
    const date = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('vi-VN');
    return html`<div class="li ${r.exists ? '' : 'missing'}">
      ${icon('project')}
      <button
        class="li-open"
        type="button"
        aria-label=${t('start.recentOpen', { name: r.name })}
        @click=${() => void app.run('project.openRecent', r.index)}
      >
        <span>${r.name}</span><small>${r.display}${date ? ` · ${date}` : ''}</small>
      </button>
      ${current ? html`<span class="chip info">${t('start.recentCurrent')}</span>` : nothing}
      ${
        r.exists
          ? nothing
          : html`<span class="chip warn">${icon('warn')}${t('start.recentMissing')}</span>
              <button
                class="ibtn sm"
                type="button"
                aria-label=${t('start.recentForget', { name: r.name })}
                title=${t('start.recentForget', { name: r.name })}
                @click=${() => void app.forgetRecent(r.index)}
              >
                ${icon('x', 'sm')}
              </button>`
      }
    </div>`;
  }

  private hero() {
    const app = this.app;
    const s = app.store.state;
    if (!s.project)
      return html`<div class="grow">
        <h1>${t('start.welcome')}</h1>
        <p class="muted">${t('start.welcomeText')}</p>
      </div>`;
    const o = s.outline;
    const summary = t('start.summary', {
      path: s.project.display,
      version: typeof o.project?.projectVersion === 'string' ? o.project.projectVersion : '?',
      tags: o.tags?.tags.length ?? 0,
      screens: o.screens.length,
      groups: o.logging?.groups.length ?? 0,
    });
    return html`<div class="grow">
      <h1>${app.projectName()}</h1>
      <p class="muted">${summary}</p>
    </div>`;
  }

  private recentList() {
    const recent = this.app.ui.recent;
    return recent.length
      ? html`<div class="list">${recent.map((r) => this.recentRow(r))}</div>`
      : html`<p class="help">${t('start.recentEmpty')}</p>`;
  }

  /** Nút lớn của tab Bắt đầu khi chưa mở project (Tạo project mới, Mở project…). */
  private bigAction(
    cmd: CommandId,
    ic: IconName,
    title: MessageKey,
    text: MessageKey,
    primary: boolean,
  ) {
    const shortcut = commandById(cmd)?.shortcut;
    return html`<button
      class="start-action ${primary ? 'primary' : ''}"
      type="button"
      data-cmd=${cmd}
      @click=${() => void this.app.run(cmd)}
    >
      <span class="sa-ic">${icon(ic)}</span>
      <span class="sa-t"><b>${t(title)}</b><small>${t(text)}</small></span>
      ${shortcut ? html`<kbd>${shortcut}</kbd>` : nothing}
    </button>`;
  }

  protected override render() {
    const app = this.app;
    const { errors, warnings } = app.counts();
    const hasProject = app.store.state.project !== null;
    return html`<div class="ed start">
      <div class="start-hero">
        ${this.hero()}
        ${
          hasProject
            ? html`<div class="row">
                <button
                  class="btn"
                  type="button"
                  data-cmd="project.new"
                  @click=${() => void app.run('project.new')}
                >
                  ${icon('fnew')}${t('cmd.project.new')}
                </button>
                <button
                  class="btn primary"
                  type="button"
                  data-cmd="project.open"
                  @click=${() => void app.run('project.open')}
                >
                  ${icon('project')}${t('cmd.project.open')}
                </button>
              </div>`
            : html`<div class="start-actions">
                ${this.bigAction('project.new', 'fnew', 'start.new', 'start.newText', true)}
                ${this.bigAction('project.open', 'project', 'cmd.project.open', 'start.openText', false)}
              </div>`
        }
      </div>
      <div class="start-grid">
        <div>
          ${
            hasProject
              ? nothing
              : html`<h2 class="sec">${t('start.recent')}</h2>
                  ${this.recentList()}`
          }
          <h2 class="sec ${hasProject ? '' : 'gap'}">${t('start.quick')}</h2>
          <div class="tiles">
            ${
              hasProject
                ? html`${this.tile('project.new', 'fnew', 'start.new', t('start.newText'))}
                  ${this.tile('project.open', 'project', 'start.tile.open', t('start.tile.openText'))}`
                : nothing
            }
            ${this.tile(
              'tools.validate',
              'check',
              'start.tile.validate',
              hasProject
                ? t('start.tile.validateText', { e: errors, w: warnings })
                : t('start.tile.validateNone'),
            )}
            ${this.tile('open.tags', 'table', 'start.tile.tags', t('start.tile.tagsText'))}
            ${this.tile('online.connect', 'online', 'start.tile.connect', t('start.tile.connectText'))}
            ${this.tile('online.devices', 'device', 'start.tile.devices', t('start.tile.devicesText'))}
          </div>
          ${
            hasProject
              ? html`<h2 class="sec gap">${t('start.recent')}</h2>
                  ${this.recentList()}`
              : nothing
          }
        </div>
        <div>
          <h2 class="sec">${t('start.roadmap')}</h2>
          <div class="roadmap">
            ${ROADMAP.map(
              (p) =>
                html`<div class="ph ${p.cls}">
                  <div class="k">${t(p.k)}</div>
                  <div><b>${t(p.title)}</b><span>${t(p.text)}</span></div>
                </div>`,
            )}
          </div>
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-start-page', StartPage);

registerEditor({
  match: (id) => id === 'start',
  render: (app) => html`<mat-start-page .app=${app}></mat-start-page>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-start-page': StartPage;
  }
}
