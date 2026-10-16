// Tên file xuất: `<id>_<kỳ>.<đuôi>` đã làm sạch (bỏ ký tự cấm của Windows và ký tự điều khiển, tối đa 80 ký tự).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export function exportFileName(id: string, periodKey: string, ext: string): string {
  const clean = (s: string) => s.replace(FORBIDDEN, '-');
  const limit = 80 - ext.length - 1;
  let base = [clean(id), clean(periodKey)].filter((s) => s !== '').join('_');
  base = base.slice(0, limit).replace(/[. ]+$/, '');
  if (base === '') base = 'report';
  return `${base}.${ext}`;
}
