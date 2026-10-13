// Thanh công cụ của editor Màn hình 0.3 (feature 007, T112, FR-058, FR-061, FR-067, FR-071; mockup studio-screens cảnh 1):
// Chọn và Tay, lưới, bắt dính, căn chỉnh 6 kiểu, phân bố, cùng rộng và cao, xếp lớp, khóa, ẩn, zoom, Vừa khung và chuyển
// Xem trước Tắt, Mô phỏng, Thiết bị. Mọi nút chạy lệnh có trong bảng lệnh (`app.run`), nên bàn phím và bảng lệnh làm được đúng
// các việc này; nút bị khóa kèm lý do ở tooltip (`app.enabled`).
import { html, nothing, type TemplateResult } from 'lit';
import type { CommandId } from '../../app/commands.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { zoomPercent } from '../../model/screen-edit/viewport.ts';
import { AppElement, icon } from '../base.ts';

interface Btn {
  id: CommandId;
  icon: IconName;
  /** Nút bật tắt: trạng thái nhấn. */
  pressed?: (app: MatScreenToolbar['app']) => boolean;
}

const GROUPS: ReadonlyArray<readonly Btn[]> = [
  [
    { id: 'screen.toolSelect', icon: 'pointer', pressed: (a) => a.screens.tool === 'select' },
    { id: 'screen.toolHand', icon: 'hand', pressed: (a) => a.screens.tool === 'hand' },
  ],
  [
    { id: 'screen.toggleGrid', icon: 'grid', pressed: (a) => a.screens.grid },
    { id: 'screen.toggleSnap', icon: 'snap', pressed: (a) => a.screens.snap },
  ],
  [
    { id: 'screen.alignLeft', icon: 'align-l' },
    { id: 'screen.alignCenter', icon: 'align-c' },
    { id: 'screen.alignRight', icon: 'align-r' },
    { id: 'screen.alignTop', icon: 'align-t' },
    { id: 'screen.alignMiddle', icon: 'align-m' },
    { id: 'screen.alignBottom', icon: 'align-b' },
  ],
  [
    { id: 'screen.distributeH', icon: 'dist-h' },
    { id: 'screen.distributeV', icon: 'dist-v' },
    { id: 'screen.sameWidth', icon: 'same-w' },
    { id: 'screen.sameHeight', icon: 'same-h' },
  ],
  [
    { id: 'screen.toFront', icon: 'front' },
    { id: 'screen.toBack', icon: 'back' },
    { id: 'screen.forward', icon: 'forward' },
    { id: 'screen.backward', icon: 'backward' },
  ],
  [
    { id: 'screen.lock', icon: 'lock' },
    { id: 'screen.hide', icon: 'eyeoff' },
  ],
];

const PREVIEW: ReadonlyArray<{
  mode: 'off' | 'sim' | 'device';
  id: CommandId;
  label: MessageKey;
  tip: MessageKey;
}> = [
  { mode: 'off', id: 'screen.previewOff', label: 'preview.mode.off', tip: 'scr.pv.offTip' },
  { mode: 'sim', id: 'screen.previewSim', label: 'preview.mode.sim', tip: 'scr.pv.simTip' },
  {
    mode: 'device',
    id: 'screen.previewDevice',
    label: 'preview.mode.device',
    tip: 'scr.pv.devTip',
  },
];

export class MatScreenToolbar extends AppElement {
  /** Id màn hình đang mở (để lấy vùng nhìn). */
  declare screenId: string;

  static override properties = { screenId: { attribute: false } };

  constructor() {
    super();
    this.screenId = '';
  }

  private button(b: Btn): TemplateResult {
    const app = this.app;
    const spec = app.enabled(b.id);
    const locked = spec !== true;
    const label = t(`cmd.${b.id}` as MessageKey);
    const keys = canvasKeyOf(b.id);
    const tip = locked ? `${label}: ${t(spec)}` : keys ? `${label} (${keys})` : label;
    const pressed = b.pressed?.(app);
    return html`<button
      class="ibtn"
      type="button"
      data-cmd=${b.id}
      aria-label=${label}
      title=${tip}
      aria-pressed=${pressed === undefined ? nothing : pressed ? 'true' : 'false'}
      ?disabled=${locked}
      @click=${() => void app.run(b.id)}
    >
      ${icon(b.icon)}
    </button>`;
  }

  private previewButton(p: (typeof PREVIEW)[number]): TemplateResult {
    const app = this.app;
    const mode = app.screens.previewMode;
    const locked = p.mode === 'device' && !app.online();
    const tip = locked ? t('preview.deviceLocked') : t(p.tip);
    return html`<button
      type="button"
      class=${p.mode === 'device' ? 'on-dev' : ''}
      data-mode=${p.mode}
      aria-pressed=${mode === p.mode ? 'true' : 'false'}
      aria-disabled=${locked ? 'true' : nothing}
      title=${tip}
      @click=${() => void app.run(p.id)}
    >
      ${t(p.label)}
    </button>`;
  }

  protected override render() {
    const app = this.app;
    const v = app.screens.view(this.screenId)?.viewport;
    const percent = v ? zoomPercent(v) : 100;
    const zoomOut = t('cmd.screen.zoomOut');
    const zoomIn = t('cmd.screen.zoomIn');
    const frozen = app.screens.previewMode !== 'off';
    return html`<div class="ed-tools se-tools" role="toolbar" aria-label=${t('scr.toolbar')}>
      ${GROUPS.map(
        (g, i) =>
          html`${i > 0 ? html`<span class="tsep"></span>` : nothing}${g.map((b) => this.button(b))}`,
      )}
      <span class="tsep"></span>
      <button
        class="ibtn"
        type="button"
        data-cmd="screen.zoomOut"
        aria-label=${zoomOut}
        title=${`${zoomOut} (-)`}
        @click=${() => void app.run('screen.zoomOut')}
      >
        ${icon('zoomout')}
      </button>
      <button
        class="tbtn se-zoom num"
        type="button"
        data-cmd="screen.zoom100"
        title=${t('scr.zoom100Tip')}
        @click=${() => void app.run('screen.zoom100')}
      >
        ${t('preview.zoomValue', { n: percent })}
      </button>
      <button
        class="ibtn"
        type="button"
        data-cmd="screen.zoomIn"
        aria-label=${zoomIn}
        title=${`${zoomIn} (+)`}
        @click=${() => void app.run('screen.zoomIn')}
      >
        ${icon('zoomin')}
      </button>
      <button
        class="ibtn"
        type="button"
        data-cmd="screen.zoomFit"
        aria-label=${t('cmd.screen.zoomFit')}
        title=${`${t('cmd.screen.zoomFit')} (0)`}
        @click=${() => void app.run('screen.zoomFit')}
      >
        ${icon('fit')}
      </button>
      <span class="grow"></span>
      <div class="seg" role="group" aria-label=${t('preview.modeGroup')}>
        ${PREVIEW.map((p) => this.previewButton(p))}
      </div>
      ${frozen ? html`<span class="se-frozen" role="status">${t('scr.pv.frozen')}</span>` : nothing}
    </div>`;
  }
}

/** Phím của canvas cho tooltip, lấy từ bảng lệnh. */
import { commandById } from '../../app/commands.ts';
const canvasKeyOf = (id: CommandId): string | undefined => commandById(id)?.canvasKey;

customElements.define('mat-screen-toolbar', MatScreenToolbar);

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-toolbar': MatScreenToolbar;
  }
}
