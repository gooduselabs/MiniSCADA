// Logic v2 của feature 011 (ADR-037): engine TS dùng chung vector (tests/logic-vectors) với core/logic (C++).
// Mô phỏng trong Studio dùng bản này (Constitution II). Không eval, không Function, không Date.now().
export const LOGIC_ENGINE_VERSION = '1.0.0-rc.1';
export * from './types.ts';
export { LogicEngine } from './engine.ts';
export { LogicHarness } from './harness.ts';
export type { HarnessOptions, HarnessValue } from './harness.ts';
export { logicOrder, logicOutputs } from './order.ts';
export { scheduleAt, civilFromDays, isoWeekday } from './schedule.ts';
export { INT64_MAX } from './counters.ts';
export { DEFAULT_MAX_GAP_MS } from './totalizer.ts';
