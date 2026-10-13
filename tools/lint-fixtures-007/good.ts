export function good(el: HTMLElement, s: string): void {
  el.textContent = s;
  setTimeout(() => el.remove(), 10);
}
