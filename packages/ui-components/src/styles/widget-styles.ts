// CSS dùng chung của widget (Shadow DOM). Màu lấy từ token --mat-*; chỉ màu do project đặt mới là mã cứng.
import { css } from 'lit';

export const widgetStyles = css`
  :host {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    font-family: var(--mat-font, system-ui, sans-serif);
    color: var(--mat-text, #1a2225);
    font-size: 13px;
  }
  :host([mode='edit']) {
    pointer-events: none;
    user-select: none;
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  .w {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 10px;
    background: var(--mat-surface, #fff);
    border: 1px solid var(--mat-border, #d2d9dc);
    border-radius: var(--mat-radius, 4px);
    box-shadow: var(--mat-shadow-card, none);
    overflow: hidden;
  }
  /* Khung có thanh tiêu đề (feature 014): biểu đồ, đồng hồ, panel kiểu card, ghi chú, danh sách trạng thái. */
  .w.framed {
    padding: 0;
    gap: 0;
    justify-content: flex-start;
    border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
    box-shadow: var(--mat-shadow-card, none);
  }
  .head {
    flex: none;
    display: block;
    min-height: 36px;
    padding: 9px 12px 8px;
    font-size: 13px;
    line-height: 18px;
    font-weight: 600;
    color: var(--mat-text, #1a2225);
    background: var(--mat-card-head-bg, var(--mat-surface-2, #f5f7f8));
    border-bottom: 1px solid var(--mat-border, #d2d9dc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .framed > .body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
  }
  /* Feature 029: nhấp nháy theo ngưỡng; giảm chuyển động thì viền đỏ đứng yên thay cho nhấp nháy. */
  .blink {
    animation: mat-blink 1s steps(2, start) infinite;
  }
  @keyframes mat-blink {
    to {
      visibility: hidden;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .blink {
      animation: none;
      outline: 2px solid var(--mat-bad, #c42b2b);
      outline-offset: 1px;
    }
  }
  /* Feature 037: widget đứng yên (thiết kế, ngoài vùng nhìn, project tắt chuyển động): không hoạt ảnh nào chạy;
     nhấp nháy báo động thành viền đỏ đứng yên để không mất thông tin. */
  :host([still]) *,
  :host([still]) *::before,
  :host([still]) *::after {
    animation: none !important;
    transition: none !important;
  }
  :host([still]) .blink {
    outline: 2px solid var(--mat-bad, #c42b2b);
    outline-offset: 1px;
  }
  .status2 {
    font-size: 12px;
    font-weight: 600;
    color: var(--mat-text-muted, #56646a);
  }
  .w.flat {
    background: transparent;
    border-color: transparent;
    padding: 0;
  }
  .w.q-bad {
    border: 2px solid var(--mat-bad, #c42b2b);
  }
  .w.q-stale {
    border-color: var(--mat-offline, #6b777c);
    border-style: dashed;
  }
  .w.q-uncertain {
    border: 2px solid var(--mat-warn, #8f5e00);
  }
  .w.q-unknown {
    border: 2px dotted var(--mat-offline, #6b777c);
  }
  .w.q-stale .main,
  .w.q-bad .main {
    filter: grayscale(0.4);
  }
  .dim {
    opacity: 0.55;
  }
  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font: 600 10px/1 var(--mat-font-mono, monospace);
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid currentColor;
    pointer-events: none;
    background: var(--mat-surface, #fff);
  }
  .badge.q-bad {
    color: var(--mat-bad, #c42b2b);
    background: var(--mat-bad-soft, #fbe1e1);
  }
  .badge.q-stale,
  .badge.q-unknown {
    color: var(--mat-text-muted, #56646a);
    background: var(--mat-surface-2, #f5f7f8);
  }
  .badge.q-uncertain {
    color: var(--mat-warn, #8f5e00);
    background: var(--mat-warn-soft, #fbefcf);
  }
  .muted {
    color: var(--mat-text-muted, #56646a);
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .mono {
    font-family: var(--mat-font-mono, monospace);
    font-variant-numeric: tabular-nums;
  }
`;
