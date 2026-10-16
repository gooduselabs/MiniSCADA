// Chữ dung lượng của feature 010 (khung Ước tính, hộp thoại chặn mềm, tóm tắt lưu trữ của tab Thiết bị): đơn vị thập phân,
// 3 chữ số có nghĩa, cùng cách ghi với câu cảnh báo của bộ kiểm tra (GB = 10⁹).
import { t } from '../i18n/index.ts';

const NUM = new Intl.NumberFormat('vi-VN', { maximumSignificantDigits: 3 });

export function sizeText(n: number): string {
  if (n >= 1e9) return t('hist.est.gb', { n: NUM.format(n / 1e9) });
  if (n >= 1e6) return t('hist.est.mb', { n: NUM.format(n / 1e6) });
  if (n >= 1e3) return t('hist.est.kb', { n: NUM.format(n / 1e3) });
  return t('hist.est.b', { n: NUM.format(n) });
}
