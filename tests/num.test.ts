import { describe, expect, it } from 'vitest';
import { bps, picoToCents, roundHalfUp } from '../src/pipeline/num.js';

describe('roundHalfUp', () => {
  it('rounds ties up and the rest to nearest', () => {
    expect(roundHalfUp(5n, 10n)).toBe(1n);
    expect(roundHalfUp(4n, 10n)).toBe(0n);
    expect(roundHalfUp(15n, 10n)).toBe(2n);
    expect(roundHalfUp(14n, 10n)).toBe(1n);
    expect(roundHalfUp(0n, 7n)).toBe(0n);
  });
  it('refuses a negative or a non-positive denominator', () => {
    expect(() => roundHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('bps', () => {
  it('matches triagelib.bps', () => {
    expect(bps(1, 3)).toBe(3333);
    expect(bps(2, 3)).toBe(6667);
    expect(bps(1, 6)).toBe(1667); // GD-03
    expect(bps(13, 1300)).toBe(100);
    expect(bps(0, 0)).toBe(0);
  });
  it('refuses a float', () => {
    expect(() => bps(0.5, 1)).toThrow(RangeError);
  });
});

describe('picoToCents (GC-06..GC-08)', () => {
  it('GC-06 1,000 × GC-02 = 3.15 cents → 3', () => expect(picoToCents(31_500_000n * 1000n)).toBe(3));
  it('GC-07 1,000 × GC-01 = 6.3 cents → 6', () => expect(picoToCents(63_000_000n * 1000n)).toBe(6));
  it('GC-08 exactly half a cent → 1', () => expect(picoToCents(5n * 10n ** 9n)).toBe(1));
});
