// Mẫu vi phạm: gán innerHTML / outerHTML, gọi insertAdjacentHTML (Constitution V).
export function paint(el: HTMLElement, s: string): void {
  el.innerHTML = s;
  el.outerHTML = s;
  el.insertAdjacentHTML('beforeend', s);
}
