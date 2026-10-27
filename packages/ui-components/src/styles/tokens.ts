// Nạp token --mat-* vào document một lần (nơi chứa chưa tự nạp tokens.css). Dùng :where() nên token của trang chủ
// luôn thắng. Shadow DOM dùng token qua kế thừa biến CSS. jsdom có thể thiếu adoptedStyleSheets: dự phòng <style>.
// Bảng CSS dựng bằng replaceSync() không nhận @import và url tương đối theo tệp CSS, nên ở đây ghép thẳng giao diện
// atscada (feature 029) và @font-face của tokens.css với URL tệp phông do Vite cấp (`?url`).
import tokensFile from './tokens.css?raw';
import atscada from './themes/atscada.css?raw';
import interLatin from './fonts/inter-latin-wght-normal.woff2?url';
import interLatinExt from './fonts/inter-latin-ext-wght-normal.woff2?url';
import interVietnamese from './fonts/inter-vietnamese-wght-normal.woff2?url';

const FONT_URLS: Record<string, string> = {
  'inter-latin-wght-normal.woff2': interLatin,
  'inter-latin-ext-wght-normal.woff2': interLatinExt,
  'inter-vietnamese-wght-normal.woff2': interVietnamese,
};

/** @font-face của tokens.css, URL phông thay bằng URL Vite cấp. */
export const FONT_FACES: string = [...tokensFile.matchAll(/@font-face\s*{[^}]*}/g)]
  .map((m) =>
    m[0].replace(/url\('\.\/fonts\/([^']+)'\)/g, (_, f: string) => `url('${FONT_URLS[f] ?? f}')`),
  )
  .join('\n');

export const TOKENS_CSS: string = [atscada, FONT_FACES].join('\n');

const installed = new WeakSet<Document>();

export function installTokens(doc: Document = document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in doc) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(TOKENS_CSS);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return;
    }
  } catch {
    /* rơi xuống <style> */
  }
  const style = doc.createElement('style');
  style.setAttribute('data-mat-tokens', '');
  style.textContent = TOKENS_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
