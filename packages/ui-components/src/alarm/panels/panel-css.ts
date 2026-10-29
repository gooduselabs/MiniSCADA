// CSS của bảng Alarm, bảng Lịch sử alarm và hộp thoại (feature 041; chuyển từ apps/runtime-web/src/alarm/alarm.css).
// Runtime chèn vào document (trang hệ thống, hộp thoại ở body); widget alarm-list chế độ đầy đủ chèn vào shadow root.
export const alarmPanelCssText = `.al-btn {
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 3px 10px;
  border-radius: var(--mat-radius);
  border: 1px solid var(--mat-border-strong);
  background: var(--mat-surface);
  color: var(--mat-text);
}
.al-btn:focus-visible,
.al-tabs button:focus-visible,
.al-filters select:focus-visible,
.al-filters input:focus-visible {
  outline: 2px solid var(--mat-accent);
  outline-offset: 1px;
}
.al-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}
.al-page[hidden] {
  display: none;
}
.al-page h2 {
  margin: 0;
  font-size: 18px;
}
.al-muted {
  color: var(--mat-text-muted);
  font-size: 12px;
}
.al-mono {
  font-family: var(--mat-font-mono);
}
.al-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mat-border);
}
.al-tabs button {
  font: inherit;
  cursor: pointer;
  padding: 6px 14px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--mat-text-muted);
}
.al-tabs button[aria-selected='true'] {
  color: var(--mat-text);
  font-weight: 600;
  border-bottom-color: var(--mat-accent);
}
.al-filters,
.al-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.al-filters select,
.al-filters input {
  font: inherit;
  font-size: 13px;
  padding: 3px 6px;
  border-radius: var(--mat-radius);
  border: 1px solid var(--mat-border-strong);
  background: var(--mat-surface);
  color: var(--mat-text);
}
.al-btn.primary {
  background: var(--mat-accent);
  border-color: var(--mat-accent);
  color: var(--mat-accent-ink);
}
.al-btn[aria-disabled='true'] {
  opacity: 0.55;
  cursor: not-allowed;
}
.al-btn:disabled {
  opacity: 0.55;
}
.al-lock {
  font-size: 12px;
  color: var(--mat-text-muted);
}
.al-hint {
  margin-left: auto;
}
.al-page mat-alarm-table {
  flex: 1;
  min-height: 120px;
}
.al-follow {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.al-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.al-progress progress {
  width: 160px;
}
.al-err {
  min-height: 0;
  color: var(--mat-bad);
  font-size: 12px;
}
.al-hist {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.al-hist th,
.al-hist td {
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--mat-border);
}
.al-hist th {
  position: sticky;
  top: 0;
  background: var(--mat-surface-2);
  color: var(--mat-text-muted);
  white-space: nowrap;
}
.al-hist th button {
  all: unset;
  cursor: pointer;
}
.al-hist th button:focus-visible {
  outline: 2px solid var(--mat-accent);
}
.al-hist-wrap {
  flex: 1;
  overflow: auto;
  min-height: 120px;
}

.al-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: var(--mat-scrim);
}
.al-dialog {
  width: min(460px, 94vw);
  max-height: 90vh;
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--mat-border);
  background: var(--mat-surface);
  color: var(--mat-text);
  box-shadow: var(--mat-shadow);
}
.al-dialog h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.al-dialog-body {
  display: grid;
  gap: 8px;
}
.al-dialog-body input[type='text'] {
  font: inherit;
  padding: 4px 6px;
  border-radius: var(--mat-radius);
  border: 1px solid var(--mat-border-strong);
  background: var(--mat-surface);
  color: var(--mat-text);
}
.al-dialog-body [role='group'] {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.al-dialog-body [role='group'] button {
  font: inherit;
  padding: 3px 10px;
  border-radius: var(--mat-radius);
  border: 1px solid var(--mat-border-strong);
  background: var(--mat-surface);
  color: var(--mat-text);
  cursor: pointer;
}
.al-dialog-body [role='group'] button[aria-pressed='true'] {
  background: var(--mat-accent);
  border-color: var(--mat-accent);
  color: var(--mat-accent-ink);
}
.al-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

`;

const INJECTED = 'data-mat-alarm-panel-css';

/** Chèn CSS vào <head> một lần (trang hệ thống của runtime). */
export function injectAlarmPanelCss(doc: Document = document): void {
  if (doc.head.querySelector('style[' + INJECTED + ']')) return;
  const st = doc.createElement('style');
  st.setAttribute(INJECTED, '');
  st.textContent = alarmPanelCssText;
  doc.head.append(st);
}
