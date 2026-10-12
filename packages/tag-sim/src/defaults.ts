// Mặc định cho Tag ngoài chưa có `sim`, trong Mô phỏng của Studio (contract value-tables-simulation §2.3, FR-052).
import { fnv1a32 } from './hash.ts';
import type { SimConfig, TagDataType } from './generators.ts';

export interface DefaultSimTag {
  id: string;
  type: TagDataType;
  min?: number;
  max?: number;
}

export function defaultSim(tag: DefaultSimTag): SimConfig {
  if (tag.type === 'BOOL') return { kind: 'square', periodMs: 10000, duty: 0.5 };
  if (tag.type === 'STRING') return { kind: 'const', value: '' };
  const hasRange = tag.min !== undefined && tag.max !== undefined && tag.min < tag.max;
  return {
    kind: 'random',
    min: hasRange ? tag.min! : 0,
    max: hasRange ? tag.max! : 100,
    periodMs: 2000,
    seed: fnv1a32(tag.id),
  };
}
