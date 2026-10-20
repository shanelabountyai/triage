// Routing policy (brief §6, D-12..D-15), applied from routing/policy.v1.json. Pure: a ticket's
// screen hits and tier results in, one decision out. Reasons are listed in the order brief §6
// gives the rules; screen rule names are a sorted set.
import { minBps } from './parse.js';
import type { ScreenHit } from './screen.js';
import type { Policy, TierResult } from './types.js';

export interface Decision {
  ticket_id: string;
  /** A | A>B | A>H | A>B>H (H = human queue) */
  path: string;
  /** The tier whose labels were used; "" when the final tier failed and nothing was labelled. */
  final_tier: 'A' | 'B' | '';
  category: string;
  priority: string;
  route: string;
  needs_human: boolean;
  /** "" when the final tier failed. */
  language: string;
  /** Final tier's minimum confidence; 0 when it failed. */
  min_bps: number;
  flags: string[];
  reasons: string[];
}

/** Whether tier A's result sends the ticket to tier B, and the reason string (D-12). */
export function escalate(policy: Policy, a: TierResult): { escalate: boolean; why: string } {
  const rule = policy.escalate_to_tier_b_when;
  if (a.parsed === null) return { escalate: rule.tier_a_failed, why: `TIER_A_FAILED:${a.failure}` };
  if (rule.category_in.includes(a.parsed.category)) return { escalate: true, why: `CATEGORY_ALWAYS_B:${a.parsed.category}` };
  const m = minBps(a.parsed);
  if (m < rule.min_confidence_bps_below) return { escalate: true, why: `LOW_CONFIDENCE:${m}<${rule.min_confidence_bps_below}` };
  return { escalate: false, why: '' };
}

/** Route from the table; the first override row whose given keys all match wins (D-13). */
export function routeFor(policy: Policy, category: string, priority: string): string {
  for (const o of policy.route_overrides) {
    if ((o.when.category ?? category) === category && (o.when.priority ?? priority) === priority) return o.route;
  }
  const r = policy.route_by_category[category];
  if (r === undefined) throw new Error(`no route for category ${category}`);
  return r;
}

/**
 * Apply the policy to one ticket. `b` must be given exactly when escalate(a) is true; anything
 * else is a caller bug and throws rather than deciding on the wrong evidence.
 */
export function decide(policy: Policy, ticketId: string, hits: readonly ScreenHit[], a: TierResult, b: TierResult | null): Decision {
  const flags: string[] = [];
  const reasons: string[] = [];
  if (hits.length) {
    flags.push('INJECTION_SUSPECTED');
    reasons.push('screen:' + [...new Set(hits.map((h) => h.rule))].sort().join(','));
  }
  const esc = escalate(policy, a);
  if (esc.escalate !== (b !== null)) throw new Error(`${ticketId}: escalation ${esc.escalate} but tier B ${b ? 'given' : 'missing'}`);
  const final = b ?? a;
  let path = esc.escalate ? 'A>B' : 'A';
  if (esc.escalate) reasons.push('escalate:' + esc.why);
  if (a.parsed === null) flags.push(`TIER_A_FAILED:${a.failure}`);

  const nh = policy.needs_human_when;
  let needsHuman = false;
  let category: string, priority: string, language: string, min: number;
  if (final.parsed === null) {
    // Nothing usable from either tier: no label is invented. OTHER/P3 places the ticket in a
    // queue only; it is flagged and the eval counts it as a failure, never as a label (D-8).
    flags.push(`FINAL_TIER_FAILED:${final.failure}`);
    if (nh.final_tier_failed) {
      needsHuman = true;
      reasons.push('human:final_tier_failed');
    }
    [category, priority, language, min] = ['OTHER', 'P3', '', 0];
  } else {
    const p = final.parsed;
    [category, priority, language, min] = [p.category, p.priority, p.language, minBps(p)];
    if (category === policy.spam_floor.category) priority = policy.spam_floor.priority;
    if (nh.model_says_needs_human && p.needs_human) {
      needsHuman = true;
      reasons.push('human:model_says');
    }
    if (nh.priority_in.includes(priority)) {
      needsHuman = true;
      reasons.push(`human:priority_${priority}`);
    }
    if (nh.category_in.includes(category)) {
      needsHuman = true;
      reasons.push(`human:category_${category}`);
    }
    if (min < nh.final_min_confidence_bps_below) {
      needsHuman = true;
      reasons.push(`human:low_confidence_${min}`);
    }
    if (nh.language_not_supported && !policy.supported_languages.includes(language)) {
      needsHuman = true;
      flags.push(`UNSUPPORTED_LANGUAGE:${language}`);
      reasons.push(`human:language_${language}`);
    }
    if (p.secondary_category !== 'NONE') flags.push(`SECONDARY:${p.secondary_category}`);
  }
  if (nh.screen_flagged && hits.length) {
    needsHuman = true;
    reasons.push('human:screen_flagged');
  }
  // SPAM routes to NONE by the table; a flagged spam ticket still sits in the human queue.
  const route = routeFor(policy, category, priority);
  if (needsHuman) path += '>H';
  return {
    ticket_id: ticketId, path, final_tier: final.parsed ? final.tier : '', category, priority, route,
    needs_human: needsHuman, language, min_bps: min, flags, reasons,
  };
}
