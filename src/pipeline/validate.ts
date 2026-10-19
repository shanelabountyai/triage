// Hand-written validator for a closed JSON-Schema subset (task 1.4; no library, CLAUDE.md working rules).
// Keywords: type (object|string|integer|boolean|array), properties, required, additionalProperties
// (false, or a schema every extra value must match), items, enum (strings). description and $comment
// are annotations. Any other keyword is a schema error, so no schema can ask for a check this file
// does not make. schemas/triage.v1.json is written in this subset; task 1.6 validates model output with it.

export type Schema = {
  type: 'object' | 'string' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: false | Schema;
  items?: Schema;
  enum?: readonly string[];
  description?: string;
  $comment?: string;
};

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', '$comment']);
const TYPES = new Set(['object', 'string', 'integer', 'boolean', 'array']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Problems with a schema itself; [] when it uses only the closed vocabulary. */
export function schemaErrors(s: unknown, path = '#'): string[] {
  if (!isObj(s)) return [`${path}: schema is not an object`];
  const errs = Object.keys(s).filter((k) => !KEYWORDS.has(k)).map((k) => `${path}: unsupported keyword ${k}`);
  if (!TYPES.has(s.type as string)) errs.push(`${path}: type must be one of ${[...TYPES].join('|')}`);
  if (s.enum !== undefined && !isStrs(s.enum)) errs.push(`${path}: enum must be an array of strings`);
  if (s.properties !== undefined) {
    if (!isObj(s.properties)) errs.push(`${path}: properties must be an object`);
    else for (const [k, p] of Object.entries(s.properties)) errs.push(...schemaErrors(p, `${path}.properties.${k}`));
  }
  if (s.required !== undefined) {
    if (!isStrs(s.required)) errs.push(`${path}: required must be an array of strings`);
    else for (const k of s.required) if (!isObj(s.properties) || !Object.hasOwn(s.properties, k)) errs.push(`${path}: required ${k} has no property`);
  }
  if (s.items !== undefined) errs.push(...schemaErrors(s.items, `${path}.items`));
  if (s.additionalProperties !== undefined && s.additionalProperties !== false) {
    errs.push(...schemaErrors(s.additionalProperties, `${path}.additionalProperties`));
  }
  return errs;
}

/** Every way `v` misses `s`, as `$.path: problem`; [] when it matches. */
export function validate(v: unknown, s: Schema, path = '$'): string[] {
  switch (s.type) {
    case 'string': if (typeof v !== 'string') return [`${path}: expected string`]; break;
    case 'integer': if (!Number.isSafeInteger(v)) return [`${path}: expected integer, got ${JSON.stringify(v)}`]; break;
    case 'boolean': if (typeof v !== 'boolean') return [`${path}: expected boolean`]; break;
    case 'array': {
      if (!Array.isArray(v)) return [`${path}: expected array`];
      const items = s.items;
      return items ? v.flatMap((x, i) => validate(x, items, `${path}[${i}]`)) : [];
    }
    case 'object': {
      if (!isObj(v)) return [`${path}: expected object`];
      const errs = (s.required ?? []).filter((k) => !Object.hasOwn(v, k)).map((k) => `${path}.${k}: required`);
      for (const [k, x] of Object.entries(v)) {
        const p = s.properties?.[k] ?? s.additionalProperties;
        if (p === false) errs.push(`${path}.${k}: not allowed`);
        else if (p) errs.push(...validate(x, p, `${path}.${k}`));
      }
      return errs;
    }
  }
  if (s.enum && !s.enum.includes(v as string)) return [`${path}: ${JSON.stringify(v)} not in [${s.enum.join(', ')}]`];
  return [];
}
