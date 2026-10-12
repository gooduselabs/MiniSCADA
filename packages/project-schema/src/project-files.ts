// Tập file của project (specs/005-device-online/data-model.md §8): những file Studio đóng gói, và digest nội
// dung tính trên đó. Bản C++ là LoadedProject::files() (core/project-manager); cùng kết quả trên trường
// `files` của vector hợp lệ trong tests/project-vectors.
import { compareUtf8 } from './package-digest.ts';
import type { Project, Screen } from './types.ts';

/** Phần của project đã nạp mà tập file cần. `LoadedProject` của `validateProject` thỏa kiểu này. */
export interface ProjectFileRefs {
  project: Pick<Project, 'tagFile' | 'loggingFile' | 'screens'>;
  screens: Readonly<Record<string, { screen: Pick<Screen, 'bindingFile' | 'svgFile'> }>>;
}

/**
 * `project.json`, `tagFile`, `loggingFile` (nếu có), và mỗi màn hình: `screens/<id>.screen.json`,
 * `bindingFile`, `svgFile`. Không trùng (hai màn hình dùng chung một SVG), sắp theo byte UTF-8 như
 * `files[]` của manifest. File khác trong thư mục project không thuộc tập này.
 */
export function projectFiles(p: ProjectFileRefs): string[] {
  const files = new Set<string>(['project.json', p.project.tagFile]);
  if (p.project.loggingFile !== undefined) files.add(p.project.loggingFile);
  for (const id of p.project.screens) {
    files.add(`screens/${id}.screen.json`);
    if (!Object.prototype.hasOwnProperty.call(p.screens, id)) continue;
    const { screen } = p.screens[id];
    files.add(screen.bindingFile);
    files.add(screen.svgFile);
  }
  return [...files].sort(compareUtf8);
}
