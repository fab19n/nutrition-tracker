import { ZERO_MACROS } from '@/domain/types';

describe('toolchain', () => {
  it('resolves the @ alias and runs tests', () => {
    expect(ZERO_MACROS.kcal).toBe(0);
  });

  it('has IndexedDB available in tests', () => {
    expect(typeof indexedDB).toBe('object');
  });
});
