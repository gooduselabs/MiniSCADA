// @mat/tag-sim: bộ sinh mô phỏng tất định (ADR-015, FR-022). Cùng vector với drivers/simulation (C++).
export { sinTurns } from './sin-turns.ts';
export { hashU, fnv1a32 } from './hash.ts';
export { simValue, toTagType } from './generators.ts';
export type { SimConfig, SimKind, SimValue, TagDataType } from './generators.ts';
export { defaultSim } from './defaults.ts';
export type { DefaultSimTag } from './defaults.ts';
