// Ways around the src/pipeline/ float and division lint (src/io/lint.ts sourceErrors) that the
// first version let through. Each case here passed lint before this file existed.
import { describe, expect, it } from 'vitest';
import { sourceErrors } from '../src/io/lint.js';

describe('policy:lint evasions', () => {
  it('exempts exactly src/pipeline/num.ts from the division rule, not every *num.ts', () => {
    expect(sourceErrors('src/pipeline/num.ts', 'const q = 2n / 3n;')).toEqual([]);
    for (const f of ['src/pipeline/enum.ts', 'src/pipeline/foonum.ts', 'src/pipeline/sub/num.ts']) {
      expect(sourceErrors(f, 'const q = a / b;'), f).toEqual([`${f}:1 division outside num.ts`]);
    }
  });

  it('flags Math rounding written with spaces or as an element access', () => {
    expect(sourceErrors('src/pipeline/x.ts', 'const a = Math . round(x);')).toEqual(['src/pipeline/x.ts:1 float op Math.round']);
    expect(sourceErrors('src/pipeline/x.ts', "const a = Math['floor'](x);")).toEqual(['src/pipeline/x.ts:1 float op Math.floor']);
    expect(sourceErrors('src/pipeline/x.ts', 'const a = Math[`ceil`](x);')).toEqual(['src/pipeline/x.ts:1 float op Math.ceil']);
  });

  it('flags toFixed and parseFloat reached by element access', () => {
    expect(sourceErrors('src/pipeline/x.ts', "const a = x['toFixed'](2);")).toEqual(['src/pipeline/x.ts:1 float op x.toFixed']);
    expect(sourceErrors('src/pipeline/x.ts', "const a = Number['parseFloat'](s);")).toEqual(['src/pipeline/x.ts:1 float op Number.parseFloat']);
  });

  it('leaves integer-safe Math and ordinary element access alone', () => {
    expect(sourceErrors('src/pipeline/x.ts', "const a = Math.min(x, y); const b = o['round']; const c = m['k'];")).toEqual([]);
  });

  it('flags every forbidden name on a line, whatever the quote style of the import', () => {
    expect(sourceErrors('src/pipeline/x.ts', 'import fs from "fs";')).toEqual(['src/pipeline/x.ts:1 forbidden "fs"']);
    expect(sourceErrors('src/pipeline/x.ts', "import { readFile } from 'node:fs/promises';")).toEqual(["src/pipeline/x.ts:1 forbidden 'node:fs/promises'"]);
    expect(sourceErrors('src/pipeline/x.ts', "import A from '@anthropic-ai/sdk';")).toEqual(['src/pipeline/x.ts:1 forbidden anthropic']);
    expect(sourceErrors('src/pipeline/x.ts', 'const k = process.env.KEY; const r = Math.random();')).toEqual([
      'src/pipeline/x.ts:1 forbidden process.env',
      'src/pipeline/x.ts:1 forbidden Math.random',
    ]);
  });
});
