// policy:lint checks (task 1.4, D-30). Each returns its problems as strings; [] is clean.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { DRIFT_SCHEMA, POLICY_SCHEMA, PRICES_SCHEMA } from '../pipeline/contracts.js';
import { schemaErrors, validate, type Schema } from '../pipeline/validate.js';
import { recordedHashes, sha256File } from './hash.js';

const DATA: [string, Schema][] = [
  ['routing/policy.v1.json', POLICY_SCHEMA],
  ['monitoring/drift.v1.json', DRIFT_SCHEMA],
  ['pricing/prices.v1.json', PRICES_SCHEMA],
];

/** The three policy files against their contracts, and schemas/triage.v1.json against the validator's subset. */
export function dataErrors(root = '.'): string[] {
  const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
  return [
    ...DATA.flatMap(([p, s]) => validate(read(p), s).map((e) => `${p} ${e}`)),
    ...schemaErrors(read('schemas/triage.v1.json')).map((e) => `schemas/triage.v1.json ${e}`),
  ];
}

/** Each file's sha256 against the D-26 row. */
export function hashErrors(root = '.'): string[] {
  return Object.entries(recordedHashes(join(root, 'docs/decisions.md'))).flatMap(([p, want]) => {
    const got = sha256File(join(root, p));
    return got === want ? [] : [`${p} sha256 ${got} != D-26 ${want}`];
  });
}

const FORBIDDEN = /\bfetch\b|anthropic|Date\.now|Math\.random|process\.env|['"](node:)?fs(\/promises)?['"]/gi;
// The one file allowed to divide, matched exactly: a suffix test also exempted enum.ts, foonum.ts, sub/num.ts.
const NUM_TS = 'src/pipeline/num.ts';
const FLOAT_CALLS = new Set(['Math.round', 'Math.floor', 'Math.ceil', 'Math.trunc', 'toFixed', 'parseFloat']);

/** Purity and float lint for one src/pipeline/ file (non-negotiables 2 and 6, D-29 Q4). */
export function sourceErrors(name: string, text: string): string[] {
  const errs: string[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(FORBIDDEN)) errs.push(`${name}:${i + 1} forbidden ${m[0]}`); // every hit, not the first per line
  });
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
  const at = (n: ts.Node, what: string) => errs.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${what}`);
  const walk = (n: ts.Node): void => {
    if (ts.isNumericLiteral(n) && /^(?!0[xX]).*[.eE]/.test(n.getText())) at(n, `float literal ${n.getText()}`);
    if (ts.isBinaryExpression(n) && name !== NUM_TS
      && (n.operatorToken.kind === ts.SyntaxKind.SlashToken || n.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken)) at(n, 'division outside num.ts');
    // Whitespace-insensitive (`Math . round`), and `Math['round']` counts as the same call.
    const op = ts.isPropertyAccessExpression(n) || ts.isIdentifier(n) ? n.getText().replace(/\s+/g, '')
      : ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) ? `${n.expression.getText()}.${n.argumentExpression.text}` : '';
    if (FLOAT_CALLS.has(op) || FLOAT_CALLS.has(op.slice(op.lastIndexOf('.') + 1)) && ts.isElementAccessExpression(n)) at(n, `float op ${op}`);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return errs;
}

export function pipelineErrors(root = '.'): string[] {
  const dir = join(root, 'src/pipeline');
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
    .flatMap((f) => sourceErrors(`src/pipeline/${f}`, readFileSync(join(dir, f), 'utf8')));
}
