// Tiện ích test cho giao diện feature 010 (Lưu trữ, Báo cáo): mở project mẫu `projects/history-demo` (định dạng 0.6) trên
// lớp platform giả. Không vào bản build: chỉ file *.test.ts import.
import type { LoggingConfig, ReportsConfig } from '@mat/project-schema';
import { resolve } from 'node:path';
import { StudioApp } from '../app/app.ts';
import { readProjectDir, REPO } from '../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';

export const historyDemoFiles = (): Record<string, string> =>
  readProjectDir(resolve(REPO, 'projects/history-demo'));

export async function newHistoryApp(
  opts: {
    width?: number;
    files?: Record<string, string>;
    session?: ConstructorParameters<typeof StudioApp>[0]['session'];
  } = {},
): Promise<{ app: StudioApp; platform: MockPlatform }> {
  const platform = createMockPlatform();
  platform.control.useProject(opts.files ?? historyDemoFiles(), 'D:/Projects/history-demo');
  const app = new StudioApp({
    platform,
    storage: null,
    windowWidth: opts.width ?? 1400,
    versionGate: false,
    ...(opts.session ? { session: opts.session } : {}),
  });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  return { app, platform };
}

/** Cấu hình lưu trữ đang sửa. */
export const loggingOf = (app: StudioApp): LoggingConfig => app.store.state.outline.logging!;
export const reportsOf = (app: StudioApp): ReportsConfig => app.store.state.outline.reports!;

/**
 * Đổi chu kỳ (nhóm chu kỳ) hoặc khoảng tối thiểu (nhóm khác, bỏ `expectedRowsPerDay`) của MỌI nhóm thành `ms` trong một sửa
 * đổi. Với history-demo: 1 ms cực lớn (W_LOG_WRITE_EXTREME), 20 ms vượt ngân sách, 1000 ms trong ngân sách.
 */
export function overBudget(app: StudioApp, ms: number): void {
  const cfg = loggingOf(app);
  app.store.edit([
    {
      kind: 'logging',
      value: {
        ...cfg,
        groups: cfg.groups.map((g) => {
          if (g.mode === 'cyclic') return { ...g, periodMs: ms };
          const { expectedRowsPerDay: _drop, ...rest } = g;
          void _drop;
          return { ...rest, minIntervalMs: ms };
        }),
      },
    },
  ]);
}
