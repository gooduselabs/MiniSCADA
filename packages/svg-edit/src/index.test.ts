import { describe, expect, it } from 'vitest';
import { SVG_EDIT_VERSION } from './index.ts';

describe('@mat/svg-edit', () => {
  it('phiên bản theo package.json', () => {
    expect(SVG_EDIT_VERSION).toBe('1.0.0-rc.1');
  });
});
