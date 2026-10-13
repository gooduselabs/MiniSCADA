// Tính phép co của khung màn hình theo fitMode (ADR-013 điểm 4, FR-014). Thuần, kiểm bằng fit.test.ts.
import type { FitMode03 } from '@mat/project-schema';

export interface Fit {
  /** Hệ số co (với stretch: kx). */
  k: number;
  kx: number;
  ky: number;
  /** Dịch khung trong vùng chứa (điểm ảnh CSS). */
  x: number;
  y: number;
  overflowX: boolean;
  overflowY: boolean;
  /** Vùng chứa chưa có cỡ: k = 1, chờ lần đo sau. */
  empty: boolean;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeFit(
  size: { width: number; height: number },
  fitMode: FitMode03 | undefined,
  viewport: { width: number; height: number },
): Fit {
  const w = Math.max(size.width, 1);
  const h = Math.max(size.height, 1);
  const W = viewport.width;
  const H = viewport.height;
  const mode = fitMode ?? 'contain';
  if (!(W > 0) || !(H > 0))
    return { k: 1, kx: 1, ky: 1, x: 0, y: 0, overflowX: false, overflowY: false, empty: true };

  const make = (kx: number, ky: number, center: boolean): Fit => {
    const k1 = r4(kx);
    const k2 = r4(ky);
    return {
      k: k1,
      kx: k1,
      ky: k2,
      x: center ? r2((W - w * kx) / 2) + 0 : 0,
      y: center ? r2((H - h * ky) / 2) + 0 : 0,
      overflowX: !center && w * k1 > W + 0.5,
      overflowY: !center && h * k2 > H + 0.5,
      empty: false,
    };
  };

  switch (mode) {
    case 'contain': {
      const k = Math.min(W / w, H / h);
      return make(k, k, true);
    }
    case 'cover': {
      const k = Math.max(W / w, H / h);
      return make(k, k, true);
    }
    case 'stretch':
      return make(W / w, H / h, false);
    case 'fit-width': {
      const k = W / w;
      return make(k, k, false);
    }
    case 'none':
      return make(1, 1, false);
  }
}
