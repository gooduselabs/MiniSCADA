// Dữ liệu mẫu cho test của Studio (feature 006): đọc một thư mục project thật trên đĩa thành bộ file theo đường dẫn
// tương đối. Không vào bản build: chỉ file *.test.ts import.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(__dirname, '../../../..');
/** Project 0.2 đầy đủ của bộ vector chung: kết nối TCP và RTU, 13 Tag đủ loại, bảng giá trị, bảng theo dõi, màn hình. */
export const FULL_02 = resolve(REPO, 'tests/project-vectors/v02-valid-full');
export const TANK_DEMO = resolve(REPO, 'projects/tank-demo');

/** Mọi file `.json` và `.svg` của thư mục, khóa theo đường dẫn tương đối dùng `/`. */
export function readProjectDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (sub: string) => {
    for (const name of readdirSync(join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else if (/\.(json|svg)$/.test(name) && name !== 'expected.json')
        out[rel] = readFileSync(join(dir, rel), 'utf8');
    }
  };
  walk('');
  return out;
}

export const full02 = (): Record<string, string> => readProjectDir(FULL_02);
export const tankDemo = (): Record<string, string> => readProjectDir(TANK_DEMO);

/** Project mẫu dashboard-demo (nay 1.0.0, feature 011 T175). */
export const DASHBOARD_DEMO = resolve(REPO, 'projects/dashboard-demo');
/**
 * Project 0.3 mẫu (feature 007): 4 màn hình, đủ 15 loại widget, một item `svg`. Là bản 0.3 đóng băng của dashboard-demo
 * (tests/fixtures/dashboard-demo-0.3) vì project mẫu đã lên 1.0 (T175); các test ở đây cần một project 0.3 thật.
 */
export const DASHBOARD_DEMO_03 = resolve(REPO, 'tests/fixtures/dashboard-demo-0.3');
export const dashboardDemo = (): Record<string, string> => readProjectDir(DASHBOARD_DEMO_03);
