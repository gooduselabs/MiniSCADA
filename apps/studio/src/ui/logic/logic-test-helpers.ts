// Tiện ích cho test giao diện Logic (feature 011, T132). Không vào bản build: chỉ file *.test.ts import.
// Project 1.0 của bộ vector chung (v10-valid-full) cộng Tag của trạm bơm và logic.json mẫu (model/logic-fixtures.ts).
import { resolve } from 'node:path';
import type { LogicDoc } from '@mat/project-schema';
import { StudioApp } from '../../app/app.ts';
import { LOGIC_TAGS, pumpLogic } from '../../model/logic-fixtures.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../../platform/mock.ts';
import { newOnlineApp, type OnlineEnv } from '../online-test-helpers.ts';

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** Bộ file project 1.0 có logic (hoặc không, khi `logic` là null). */
export function logicProjectFiles(logic: LogicDoc | null = pumpLogic()): Record<string, string> {
  const files = readProjectDir(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  const tags = JSON.parse(files['tags.json']!) as { tags: Array<{ id: string }> };
  const have = new Set(tags.tags.map((t) => t.id));
  for (const t of LOGIC_TAGS) if (!have.has(t.id)) tags.tags.push(t as unknown as { id: string });
  files['tags.json'] = json(tags);
  const project = JSON.parse(files['project.json']!) as Record<string, unknown>;
  if (logic) {
    files['logic.json'] = json(logic);
    project.logic = 'logic.json';
  } else {
    delete files['logic.json'];
    delete project.logic;
  }
  files['project.json'] = json(project);
  return files;
}

export async function newLogicApp(
  logic: LogicDoc | null = pumpLogic(),
): Promise<{ app: StudioApp; platform: MockPlatform }> {
  const platform = createMockPlatform();
  platform.control.useProject(logicProjectFiles(logic), 'D:/Projects/tram-bom');
  const app = new StudioApp({ platform, storage: null, windowWidth: 1400, versionGate: false });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  return { app, platform };
}

/** App có thiết bị giả runtime 1.0 (system/info.logic) và project có logic, chưa Online. */
export async function newLogicOnlineApp(
  writes: 'off' | 'on' | 'stopped' = 'on',
): Promise<OnlineEnv> {
  const env = await newOnlineApp({ files: logicProjectFiles() });
  env.dev.control.setRuntime('BL335-01', '1.0.0');
  env.dev.control.setLogic('BL335-01', {
    writes,
    blocks: [
      {
        id: 'pump_low_level',
        kind: 'rule',
        state: 'OK',
        lastFired: '2026-10-16T08:12:03+07:00',
        fired: 14,
        reason: null,
      },
      { id: 'pump_high_level', kind: 'rule', state: 'THROTTLED', fired: 15, reason: null },
      { id: 't_start', kind: 'timer', state: 'OK', outputs: { 'LOGIC.T_START.Q': true } },
    ],
  });
  return env;
}
