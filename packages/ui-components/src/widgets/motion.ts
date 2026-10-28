// Feature 037 (review hiệu năng BL335): một nơi quyết định widget có được chuyển động không.
// - Thiết lập project "Chuyển động: Tắt" (`project.json` `motion: off`): trang vận hành gọi `setMotion(document, false)`.
// - Widget ngoài vùng nhìn: một IntersectionObserver dùng chung cho mọi widget (không mỗi widget một observer).
// Widget không được chuyển động thì có thuộc tính `still` trên phần tử chủ; CSS chung (widget-styles) tắt mọi
// `animation` bên trong, nên trình duyệt không vẽ lại khung hình nào cho quay, sóng, nhấp nháy, nháy số.
const ATTR = 'matMotion';
const listeners = new Set<() => void>();

export function setMotion(doc: Document, on: boolean): void {
  const v = on ? 'on' : 'off';
  if (doc.documentElement.dataset[ATTR] === v) return;
  doc.documentElement.dataset[ATTR] = v;
  for (const l of [...listeners]) l();
}

export const motionOn = (doc: Document): boolean => doc.documentElement.dataset[ATTR] !== 'off';

export function onMotionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type VisFn = (visible: boolean) => void;
const watchers = new WeakMap<Element, VisFn>();
let io: IntersectionObserver | null | undefined;

function shared(): IntersectionObserver | null {
  if (io !== undefined) return io;
  io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          for (const e of entries) watchers.get(e.target)?.(e.isIntersecting);
        })
      : null; // môi trường không có (jsdom): coi như luôn thấy
  return io;
}

/** Theo dõi phần tử có trong vùng nhìn; trả hàm hủy. */
export function watchVisible(el: Element, fn: VisFn): () => void {
  const o = shared();
  if (!o) return () => {};
  watchers.set(el, fn);
  o.observe(el);
  return () => {
    o.unobserve(el);
    watchers.delete(el);
  };
}
