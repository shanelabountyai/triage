// Routing policy (task 1.7, brief §6, D-12..D-16), applied from routing/policy.v1.json. Ported from
// triagelib.escalate / route_for / decide: same rule order, same reason and flag strings, so the
// decisions CSV columns come out byte-equal. Labels come from a tier; the policy never invents one.
import type { Parsed, TierResult } from './parse.js';
import { screen } from './screen.js';

/** The fields of routing/policy.v1.json the policy reads (shape checked by POLICY_SCHEMA in lint). */
export interface Policy {
  tiers: Record<'A' | 'B', { model: string }>;
  supported_languages: string[];
  escalate_to_tier_b_when: { min_confidence_bps_below: number; category_in: string[]; tier_a_failed: boolean };
  needs_human_when: {
    model_says_needs_human: boolean; priority_in: string[]; category_in: string[]; final_min_confidence_bps_below: number;
    screen_flagged: boolean; language_not_supported: boolean; final_tier_failed: boolean;
  };
  route_by_category: Record<string, string>;
  route_overrides: { when: { category?: string; priority?: string }; route: string }[];
  spam_floor: { category: string; priority: string };
  audit_sample_bps: number;
}

export interface Decision {
  ticketId: string;
  path: string; // A | A>B | A>H | A>B>H
  finalTier: 'A' | 'B' | '';
  category: string;
  priority: string;
  route: string;
  needsHuman: boolean;
  language: string;
  minBps: number;
  flags: string[];
  reasons: string[];
}

export const minBps = (p: Parsed): number => Math.min(p.categoryBps, p.priorityBps, p.needsHumanBps);

export function escalate(a: TierResult, policy: Policy): { escalate: boolean; why: string } {
  const rule = policy.escalate_to_tier_b_when;
  if (!a.parsed) return { escalate: rule.tier_a_failed, why: `TIER_A_FAILED:${a.failure}` };
  const p = a.parsed;
  if (rule.category_in.includes(p.category)) return { escalate: true, why: `CATEGORY_ALWAYS_B:${p.category}` };
  const m = minBps(p);
  if (m < rule.min_confidence_bps_below) return { escalate: true, why: `LOW_CONFIDENCE:${m}<${rule.min_confidence_bps_below}` };
  return { escalate: false, why: '' };
}

export function routeFor(category: string, priority: string, policy: Policy): string {
  for (const o of policy.route_overrides) {
    if ((o.when.category ?? category) === category && (o.when.priority ?? priority) === priority) return o.route;
  }
  const r = policy.route_by_category[category];
  if (r === undefined) throw new Error(`no route for category ${category}`);
  return r;
}

/** `b` is given exactly when escalate(a) is true; `text` is screenText(ticket). */
export function decide(ticketId: string, text: string, a: TierResult, b: TierResult | null, policy: Policy): Decision {
  const flags: string[] = [];
  const reasons: string[] = [];
  const hits = screen(text);
  if (hits.length) {
    flags.push('INJECTION_SUSPECTED');
    reasons.push('screen:' + [...new Set(hits.map((h) => h.rule))].sort().join(','));
  }
  const esc = escalate(a, policy);
  if (esc.escalate !== (b !== null)) throw new Error(`${ticketId}: escalation ${esc.escalate} but tier B ${b ? 'given' : 'missing'}`);
  const final = b ?? a;
  let path = b ? 'A>B' : 'A';
  if (b) reasons.push('escalate:' + esc.why);
  if (!a.parsed) flags.push(`TIER_A_FAILED:${a.failure}`);

  const nh = policy.needs_human_when;
  let needsHuman = false;
  let category = 'OTHER', priority = 'P3', language = '', min = 0;
  if (!final.parsed) {
    // OTHER/P3 is queue placement only; the eval counts this ticket as a failure, never as a label.
    flags.push(`FINAL_TIER_FAILED:${final.failure}`);
    if (nh.final_tier_failed) {
      needsHuman = true;
      reasons.push('human:final_tier_failed');
    }
  } else {
    const p = final.parsed;
    ({ category, priority, language } = p);
    min = minBps(p);
    if (category === policy.spam_floor.category) priority = policy.spam_floor.priority;
    const human = (why: string) => { needsHuman = true; reasons.push(`human:${why}`); };
    if (nh.model_says_needs_human && p.needsHuman) human('model_says');
    if (nh.priority_in.includes(priority)) human(`priority_${priority}`);
    if (nh.category_in.includes(category)) human(`category_${category}`);
    if (min < nh.final_min_confidence_bps_below) human(`low_confidence_${min}`);
    if (nh.language_not_supported && !policy.supported_languages.includes(language)) {
      flags.push(`UNSUPPORTED_LANGUAGE:${language}`);
      human(`language_${language}`);
    }
    if (p.secondaryCategory !== 'NONE') flags.push(`SECONDARY:${p.secondaryCategory}`);
  }
  if (nh.screen_flagged && hits.length) {
    needsHuman = true;
    reasons.push('human:screen_flagged');
  }
  const route = routeFor(category, priority, policy); // a flagged SPAM ticket routes NONE and still sits in the human queue
  if (needsHuman) path += '>H';
  return { ticketId, path, finalTier: final.parsed ? (b ? 'B' : 'A') : '', category, priority, route, needsHuman, language, minBps: min, flags, reasons };
}
