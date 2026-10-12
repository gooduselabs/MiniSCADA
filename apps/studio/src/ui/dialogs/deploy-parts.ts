// Phần dùng chung của hộp thoại Nạp xuống và Khôi phục (feature 005, US2, T123): danh sách bước, tiến trình gửi gói,
// khối kết quả. Chỉ dựng template từ `RunningView`/`ResultView` của model/download-flow.ts; chữ ở i18n/vi-deploy.ts.
import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { formatBytes } from '../../model/device.ts';
import type { ResultView, RunningView, StepView } from '../../model/download-flow.ts';
import { icon } from '../base.ts';

const STEP_KEY: Readonly<Record<string, MessageKey>> = {
  receive: 'dl.step.receive',
  'verify-package': 'dl.step.verify-package',
  validate: 'dl.step.validate',
  backup: 'dl.step.backup',
  activate: 'dl.step.activate',
  health: 'dl.step.health',
  rollback: 'dl.step.rollback',
};

const STATE_KEY: Readonly<Record<StepView['state'], MessageKey>> = {
  pending: 'dl.step.pending',
  running: 'dl.step.running',
  ok: 'dl.step.ok',
  failed: 'dl.step.failed',
  skipped: 'dl.step.skipped',
};

/** Mã lỗi của bước (device-api §5) → câu. */
const CODE_KEY: Readonly<Record<string, MessageKey>> = {
  RECEIVE_TIMEOUT: 'dl.code.RECEIVE_TIMEOUT',
  RECEIVE_ABORTED: 'dl.code.RECEIVE_ABORTED',
  NO_SPACE: 'dl.code.NO_SPACE',
  E_VALIDATION: 'dl.code.E_VALIDATION',
  STORE_IO: 'dl.code.STORE_IO',
  EXEC_FAILED: 'dl.code.EXEC_FAILED',
  HEALTH_TIMEOUT: 'dl.code.HEALTH_TIMEOUT',
  HEALTH_CRASH: 'dl.code.HEALTH_CRASH',
  HEALTH_PROJECT: 'dl.code.HEALTH_PROJECT',
  HEALTH_HTTPS: 'dl.code.HEALTH_HTTPS',
  INTERRUPTED: 'dl.code.INTERRUPTED',
};

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** Lý do lỗi: mã của thiết bị (`HEALTH_TIMEOUT`, `E_PKG_…`) hoặc mã của lệnh Rust (`no-space`, `busy`…). */
export function reasonText(code: string, detail?: unknown): string {
  const key = own(CODE_KEY, code);
  if (key) return t(key);
  if (/^[A-Z][A-Z0-9_]*$/.test(code)) return t('dl.code.other', { code });
  return deviceErrorText({ error: code, ...(detail === undefined ? {} : { detail }) });
}

const stepMark = (s: StepView): TemplateResult => {
  switch (s.state) {
    case 'running':
      return html`<span class="spin" aria-hidden="true"></span>`;
    case 'ok':
      return icon('ok', 'ok');
    case 'failed':
      return icon('err', 'err');
    default:
      return html`<span class="dot" aria-hidden="true"></span>`;
  }
};

/** Các bước của thao tác, mỗi bước một dòng với trạng thái (chữ và icon, không chỉ màu). */
export function stepsList(steps: readonly StepView[]): TemplateResult {
  return html`<ol class="steps" aria-label=${t('dl.steps')}>
    ${steps.map(
      (s) =>
        html`<li data-step=${s.id} data-state=${s.state}>
          ${stepMark(s)}<span>${own(STEP_KEY, s.id) ? t(STEP_KEY[s.id]) : s.id}</span>
          <span class="st">${t(STATE_KEY[s.state])}</span>
        </li>`,
    )}
  </ol>`;
}

/** Thân của hộp thoại khi thao tác đang chạy: tiến trình gửi gói, các bước, cảnh báo đang chạy lại. */
export function runningBody(run: RunningView): TemplateResult {
  const send = run.send;
  const pct =
    send && send.total > 0 ? Math.min(100, Math.round((send.sent / send.total) * 100)) : 0;
  return html`${
    send && run.steps[0]?.state === 'running'
      ? html`<div role="status" data-role="send">
          <span
            >${t('dl.send', { sent: formatBytes(send.sent), total: formatBytes(send.total) })}</span
          >
          <div class="send" aria-hidden="true">
            <span style=${styleMap({ width: `${pct}%` })}></span>
          </div>
        </div>`
      : nothing
  }
  ${stepsList(run.steps)}
  ${
    run.restarting
      ? html`<div class="banner warn" role="status" data-role="restarting">
          ${icon('warn', 'warn')}
          <div>${t('dl.restarting')}</div>
        </div>`
      : nothing
  }`;
}

const seconds = (ms: number): string =>
  new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    ms / 1000,
  );

interface Headline {
  tone: 'ok' | 'err' | 'warn';
  ic: IconName;
  text: string;
}

function headline(r: ResultView): Headline {
  const restore = r.kind === 'restore';
  const version = r.running?.projectVersion ?? '';
  switch (r.outcome) {
    case 'committed':
      return {
        tone: 'ok',
        ic: 'ok',
        text: t(restore ? 'dl.result.committedRestore' : 'dl.result.committed', {
          seconds: seconds(r.durationMs),
        }),
      };
    case 'rolled-back':
      return {
        tone: 'err',
        ic: 'err',
        text: t(restore ? 'dl.result.rolledBackRestore' : 'dl.result.rolledBack', { version }),
      };
    case 'interrupted':
      return { tone: 'warn', ic: 'warn', text: t('dl.result.interrupted') };
    case 'lost':
      return { tone: 'warn', ic: 'warn', text: t('dl.result.lost') };
    case 'error':
      return { tone: 'err', ic: 'err', text: t('dl.result.error') };
    default:
      return {
        tone: 'err',
        ic: 'err',
        text: t(restore ? 'dl.result.failedRestore' : 'dl.result.failed'),
      };
  }
}

/** Khối kết quả: câu chính, lý do, lỗi kiểm project (nếu có), bản đang chạy, bản trước, audit. */
export function resultBlock(r: ResultView, deviceName: string): TemplateResult {
  const h = headline(r);
  const issues = r.error?.issues ?? [];
  const reason = r.error ? reasonText(r.error.code, r.error.detail) : null;
  const text =
    r.outcome === 'committed'
      ? t('dl.result.committedText', {
          device: deviceName,
          name: r.running?.projectVersion ? (r.op?.to.projectId ?? '') : '',
          version: r.running?.projectVersion ?? '',
          clients: r.clientsNotified ?? 0,
        })
      : null;
  const user = r.op?.user ?? '';
  return html`<div class="result ${h.tone}" data-outcome=${r.outcome} role="status">
      ${icon(h.ic, `lg ${h.tone === 'warn' ? 'warn' : h.tone}`)}
      <div>
        <b>${h.text}</b>
        ${text ? html`<p>${text}</p>` : nothing}
        ${reason ? html`<p>${t('dl.result.reason', { reason })}</p>` : nothing}
        ${
          issues.length
            ? html`<p>${t('dl.result.issues')}</p>
                <ul class="issues">
                  ${issues.map(
                    (i) =>
                      html`<li><span class="mono">${i.code}</span> ${i.file}: ${i.message}</li>`,
                  )}
                </ul>`
            : nothing
        }
        ${
          r.outcome !== 'committed' && r.outcome !== 'error' && r.running && r.outcome !== 'lost'
            ? html`<p>
                ${t('dl.result.running', {
                  name: r.op?.to.projectId ?? '',
                  version: r.running.projectVersion,
                })}
              </p>`
            : nothing
        }
      </div>
    </div>
    ${stepsList(r.steps)}
    <dl class="kvs">
      ${
        r.outcome === 'committed' && r.kind === 'deploy' && r.op?.from
          ? html`<dt>${t('dl.result.previous')}</dt>
              <dd>${t('dl.result.previousText', { version: r.op.from.projectVersion })}</dd>`
          : nothing
      }
      ${
        user
          ? html`<dt>${t('dl.result.audit')}</dt>
              <dd>
                ${t('dl.result.auditText', {
                  user,
                  kind: t(r.kind === 'restore' ? 'dl.op.restore' : 'dl.op.deploy'),
                  result: t(
                    r.outcome === 'committed' ? 'dl.result.auditOk' : 'dl.result.auditFailed',
                  ),
                })}
              </dd>`
          : nothing
      }
    </dl>`;
}
