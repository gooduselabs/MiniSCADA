// Chữ kết quả lệnh ghi của một dòng Bảng theo dõi (feature 006, US2, FR-050, data-model §8): trạng thái, mã chi tiết bằng tiếng
// Việt (`NO_READBACK` là "thiết bị xác nhận, không đọc lại", `TIMEOUT` là "không chắc đã ghi"), giá trị đọc lại, exception kèm nghĩa,
// và thời điểm. Hàm thuần theo `RowWrite`.
import { exceptionText, writeCodeText, writeStatusText } from '../../app/code-text.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { WriteCell } from '../../model/watch-table.ts';
import type { RowWrite } from '../../model/write-flow.ts';

const clock = (ms: number, timeZone?: string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(ms));

const show = (v: unknown): string => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

export interface WriteViewOptions {
  /** Giới hạn ghi của Tag (cho lý do `OUT_OF_LIMITS` kèm khoảng). */
  limits?: { min?: number; max?: number };
  timeZone?: string;
}

/** Chữ và sắc thái kết quả ghi của dòng; `null` khi dòng chưa ghi lần nào. */
export function writeResultView(
  r: RowWrite | undefined,
  o: WriteViewOptions = {},
): WriteCell | null {
  if (!r) return null;
  const at = clock(r.at, o.timeZone);
  const upper = (x: string): string => x.charAt(0).toLocaleUpperCase('vi') + x.slice(1);
  const done = (status: string, detail: string, tone: WriteCell['tone']): WriteCell => ({
    text: upper([writeStatusText(status), detail, at].filter(Boolean).join(' · ')),
    tone,
  });
  switch (r.state) {
    case 'sending':
      return { text: t('wr.sending'), tone: 'pending' };
    case 'accepted':
      return {
        text: upper(
          [writeStatusText('ACCEPTED'), r.phase ? t(`wr.phase.${r.phase}` as MessageKey) : '']
            .filter(Boolean)
            .join(' · '),
        ),
        tone: 'pending',
      };
    case 'confirmed': {
      const code = r.code ?? 'CONFIRMED';
      const detail = writeCodeText(code);
      const back =
        r.readback !== undefined && code === 'CONFIRMED'
          ? t('wr.readback', { value: show(r.readback) })
          : '';
      return done(
        'CONFIRMED',
        [detail, back].filter(Boolean).join(', '),
        code === 'NO_READBACK' ? 'warn' : 'ok',
      );
    }
    case 'failed': {
      const ex = r.exception
        ? t('modbusEx.line', { code: r.exception.code, meaning: exceptionText(r.exception.code) })
        : '';
      const base = r.code ? writeCodeText(r.code) : '';
      const readback =
        r.readback !== undefined ? t('wr.readback', { value: show(r.readback) }) : '';
      return done('FAILED', [base, ex, readback].filter(Boolean).join(' · '), 'err');
    }
    case 'timeout':
      return done('TIMEOUT', r.code ? writeCodeText(r.code) : '', 'warn');
    case 'rejected':
      return done(
        'REJECTED',
        r.code
          ? writeCodeText(r.code, {
              ...(o.limits?.min !== undefined ? { min: o.limits.min } : {}),
              ...(o.limits?.max !== undefined ? { max: o.limits.max } : {}),
              ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
            })
          : '',
        'err',
      );
    case 'unknown':
      return {
        text: upper(
          [
            writeStatusText('UNKNOWN'),
            r.code === 'NO_SUCH_REQUEST' ? t('wr.noSuchRequest') : t('wr.unknownHelp'),
            at,
          ].join(' · '),
        ),
        tone: 'warn',
      };
    case 'relogin':
      return { text: t('wr.relogin'), tone: 'warn' };
    default:
      return null;
  }
}
