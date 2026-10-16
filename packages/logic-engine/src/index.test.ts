import { describe, expect, it } from 'vitest';
import { LOGIC_ENGINE_VERSION } from './index.ts';

describe('@mat/logic-engine', () => {
  it('phiên bản theo package.json', () => {
    expect(LOGIC_ENGINE_VERSION).toBe('1.0.0-rc.1');
  });
});
