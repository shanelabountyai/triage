// The one rounding module (src/pipeline/num.ts) against the oracle (tools/triagelib.py round_half_up,
// bps, pico_to_cents) over exhaustive small grids and the edges: ties, large bigints, unsafe numbers.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { bps, picoToCents, roundHalfUp } from '../src/pipeline/num.js';

const oracle = (body: string): unknown => JSON.parse(execFileSync('python3', ['-c', `import json,sys
from fractions import Fraction
sys.path.insert(0,'tools')
from triagelib import round_half_up, bps, pico_to_cents
${body}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

describe('num.ts agrees with triagelib', () => {
  it('roundHalfUp on every num 0..400, den 1..40', () => {
    const want = oracle('print(json.dumps([[round_half_up(Fraction(n,d)) for n in range(401)] for d in range(1,41)]))') as number[][];
    const got = Array.from({ length: 40 }, (_, d) => Array.from({ length: 401 }, (_, n) => Number(roundHalfUp(BigInt(n), BigInt(d + 1)))));
    expect(got).toEqual(want);
  });

  it('bps on every num 0..den, den 0..300', () => {
    const want = oracle('print(json.dumps([[bps(n,d) for n in range(d+1)] for d in range(301)]))') as number[][];
    const got = Array.from({ length: 301 }, (_, d) => Array.from({ length: d + 1 }, (_, n) => bps(n, d)));
    expect(got).toEqual(want);
  });

  it('picoToCents around every half-cent boundary for 0..50 cents', () => {
    const half = 5_000_000_000n;
    const pts = Array.from({ length: 101 }, (_, i) => BigInt(i) * half).flatMap((p) => (p === 0n ? [p, p + 1n] : [p - 1n, p, p + 1n]));
    const want = oracle(`print(json.dumps([pico_to_cents(int(p)) for p in json.loads('${JSON.stringify(pts.map(String))}')]))`) as number[];
    expect(pts.map(picoToCents)).toEqual(want);
  });
});

describe('num.ts edges', () => {
  it('ties always go up, never to even', () => {
    for (let k = 0n; k < 20n; k++) expect(roundHalfUp(2n * k + 1n, 2n)).toBe(k + 1n);
  });

  it('is exact past 2^53: bigint in, bigint out', () => {
    const big = 2n ** 80n;
    expect(roundHalfUp(big * 10n + 5n, 10n)).toBe(big + 1n);
    expect(roundHalfUp(big * 10n + 4n, 10n)).toBe(big);
  });

  it('bps refuses unsafe or non-integer inputs and a negative denominator', () => {
    expect(() => bps(Number.MAX_SAFE_INTEGER + 1, 3)).toThrow(RangeError);
    expect(() => bps(1, 2.5)).toThrow(RangeError);
    expect(() => bps(Number.NaN, 3)).toThrow(RangeError);
    expect(() => bps(1, -3)).toThrow(RangeError);
    expect(() => bps(-1, 3)).toThrow(RangeError);
  });

  it('bps of a whole is 10,000 and stays within 0..10,000 for 0 <= num <= den', () => {
    expect(bps(7, 7)).toBe(10_000);
    expect(bps(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(10_000);
  });

  it('picoToCents refuses a result that is not a safe integer', () => {
    expect(() => picoToCents(10_000_000_000n * 2n ** 60n)).toThrow(RangeError);
    expect(picoToCents(10_000_000_000n * BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
