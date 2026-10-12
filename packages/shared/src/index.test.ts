import { describe, expect, it } from 'vitest';
import { SHARED_VERSION } from './index';

describe('shared package', () => {
  it('exposes a version', () => {
    expect(SHARED_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
