// Mẫu vi phạm có chủ đích cho tools/lint-rules-alarm.test.mjs (009 T005): chuỗi tiếng Việt cứng.
export const a = 'Đang có, chưa xác nhận';
export const b = `Bồn ${1} mức rất cao`;
export function c(el: HTMLElement): void {
  el.textContent = 'Xác nhận';
}
