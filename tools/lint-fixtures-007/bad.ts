// Mẫu vi phạm có chủ đích cho tools/lint-rules.test.mjs (T008).
export function bad(el: HTMLElement, s: string): void {
  el.innerHTML = s;
  el.outerHTML = s;
  el.insertAdjacentHTML('beforeend', s);
  document.write(s);
  eval(s);
  new Function(s);
  setTimeout('alert(1)', 10);
}
