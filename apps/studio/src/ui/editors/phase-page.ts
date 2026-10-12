// Trang giai đoạn (feature 004, T053, FR-004): mục chưa làm trên cây mở trang nói chức năng làm gì và có ở
// giai đoạn nào của lộ trình v2 (nội dung như mockup bản 1).
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { PHASE_PAGES, phaseLabel, type PhasePageKey } from '../../model/tree.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';

export class PhasePageEl extends AppElement {
  private key: PhasePageKey = 'connections';

  set pageKey(key: PhasePageKey) {
    this.key = key;
    this.requestUpdate();
  }

  protected override render() {
    const page = PHASE_PAGES[this.key];
    if (!page) return nothing;
    const title = t(page.title);
    const phase = phaseLabel(page.phase);
    return html`<div class="ed">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="grow"></span><span class="chip info">${phase}</span>
      </div>
      <div class="empty phase-page">
        ${icon(page.icon, 'lg')}
        <b>${t('phasePage.heading', { title, phase })}</b>
        <p>${t(page.text)}</p>
        <p class="help">${t('phasePage.roadmap')}</p>
      </div>
    </div>`;
  }
}

customElements.define('mat-phase-page', PhasePageEl);

registerEditor({
  match: (id) => id.startsWith('phase:'),
  render: (app, id) =>
    html`<mat-phase-page
      .app=${app}
      .pageKey=${id.slice('phase:'.length) as PhasePageKey}
    ></mat-phase-page>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-phase-page': PhasePageEl;
  }
}
