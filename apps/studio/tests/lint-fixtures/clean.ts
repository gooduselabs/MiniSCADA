// Mẫu hợp lệ: chú thích tiếng Việt được phép; chuỗi trong mã là khóa i18n hoặc ASCII.
export const key = 'project.save';
export const css = `color: var(--fg)`;
export function show(el: HTMLElement, text: string): void {
  el.textContent = text;
}
