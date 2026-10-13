// Nạp token --mat-* vào document một lần (nơi chứa chưa tự nạp tokens.css). Dùng :where() nên token của trang chủ
// luôn thắng. Shadow DOM dùng token qua kế thừa biến CSS. jsdom có thể thiếu adoptedStyleSheets: dự phòng <style>.
import tokensCss from './tokens.css?raw';

export const TOKENS_CSS: string = tokensCss;

const installed = new WeakSet<Document>();

export function installTokens(doc: Document = document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in doc) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(tokensCss);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return;
    }
  } catch {
    /* rơi xuống <style> */
  }
  const style = doc.createElement('style');
  style.setAttribute('data-mat-tokens', '');
  style.textContent = tokensCss;
  (doc.head ?? doc.documentElement).appendChild(style);
}
