// Dựng một màn hình SVG trong Shadow DOM riêng (ADR-007: class/id của các file SVG không đụng
// nhau) và lập bản đồ elementUid → phần tử theo data-mat-uid (ADR-003). Dùng chung cho runtime web
// và Studio Preview (Constitution II).
import { parseSvg, sanitizeSvg, type SanitizeReport } from './sanitize.ts';

export interface ScreenLayout {
  viewBox: [number, number, number, number];
  fitMode: 'contain' | 'cover' | 'stretch';
  background?: string;
  elements: Array<{ elementUid: string }>;
}

export interface MountedScreen {
  root: ShadowRoot;
  svg: SVGSVGElement;
  elements: Map<string, Element>;
  /** elementUid khai báo trong screen nhưng không có trong SVG. */
  missingUids: string[];
  report: SanitizeReport;
  unmount(): void;
}

const ASPECT: Record<ScreenLayout['fitMode'], string> = {
  contain: 'xMidYMid meet',
  cover: 'xMidYMid slice',
  stretch: 'none',
};

export function mountScreen(
  host: HTMLElement,
  svgText: string,
  layout: ScreenLayout,
): MountedScreen {
  const parsed = parseSvg(svgText);
  const report = sanitizeSvg(parsed);
  const svg = host.ownerDocument.importNode(parsed, true) as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', layout.viewBox.join(' '));
  svg.setAttribute('preserveAspectRatio', ASPECT[layout.fitMode]);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.cssText += ';display:block;width:100%;height:100%';

  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const style = host.ownerDocument.createElement('style');
  const bg = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(layout.background ?? '')
    ? layout.background
    : 'transparent';
  style.textContent = `:host{display:block;position:relative;overflow:hidden;background:${bg}}`;
  root.replaceChildren(style, svg);

  const declared = new Set(layout.elements.map((e) => e.elementUid));
  const elements = new Map<string, Element>();
  svg.querySelectorAll('[data-mat-uid]').forEach((el) => {
    const uid = el.getAttribute('data-mat-uid')!;
    if (declared.has(uid) && !elements.has(uid)) elements.set(uid, el);
  });
  const missingUids = [...declared].filter((u) => !elements.has(u));
  return {
    root,
    svg,
    elements,
    missingUids,
    report,
    unmount: () => {
      root.replaceChildren();
      elements.clear();
    },
  };
}
