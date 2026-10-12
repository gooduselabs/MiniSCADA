// Mẫu vi phạm: chèn HTML thô bằng directive của Lit (Constitution V, ADR-009).
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export const render = (s: string) => unsafeHTML(s);
