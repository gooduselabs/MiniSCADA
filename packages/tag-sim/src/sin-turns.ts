// sinTurns(f), f thuộc [0, 1): sin(2 pi f), tất định (contract value-tables-simulation §2.1).
// Không gọi Math.sin: hai bản (TS, C++) phải giống nhau từng bit. Hệ số của fdlibm __kernel_sin và
// __kernel_cos (Sun Microsystems, cho phép dùng tự do). Mọi phép theo đúng thứ tự, không gộp nhân-cộng.
const HALF_PI = 1.5707963267948966;
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number): number {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(x: number): number {
  const z = x * x;
  return 1 - (0.5 * z - z * (z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))));
}

export function sinTurns(f: number): number {
  const f4 = f * 4; // nhân với 4 chính xác
  const q = Math.floor(f4);
  let r = f4 - q; // [0, 1), chính xác
  let other = false;
  if (r > 0.5) {
    r = 1 - r; // chính xác
    other = true; // đổi cặp sin <-> cos
  }
  const x = r * HALF_PI;
  // q chẵn dùng S (cặp trái) hoặc C (cặp phải); q lẻ ngược lại
  const useSin = (q % 2 === 0) !== other;
  const v = useSin ? kernelSin(x) : kernelCos(x);
  return q >= 2 ? -v : v;
}
