// Injection screen (brief §5, CLAUDE.md non-negotiable 11). Ported from opsagent
// src/opsagent/screen.py by way of triagelib.SCREEN_RULES (D-31): same eight patterns in
// the same order, one hit per rule (first match), where opsagent returns one per distinct text.
// A hit never changes a label; decide() turns it into needs_human and INJECTION_SUSPECTED.
// Honest scope: written with the fixture injection set in view, so recall on it is an upper bound.
//
// ponytail: JS `\b` is ASCII-only, Python's is Unicode. Every `\b` here sits beside an ASCII
// keyword letter, so JS fires on a superset (e.g. "ésystem:"), never a subset. Agrees with the
// oracle on all 1,200 fixture tickets (tests/screen.test.ts); lookaround boundaries if that changes.

export type ScreenRule =
  | 'role_marker' | 'fake_tool_output' | 'addressed_to_agent' | 'override'
  | 'approval_claim' | 'label_directive' | 'harness_name' | 'exfiltration';

export const SCREEN_RULES: readonly (readonly [ScreenRule, RegExp])[] = [
  ['role_marker', /\b(?:system|assistant|developer)\s*:|\[\s*(?:system|admin|assistant)\b/iu],
  ['fake_tool_output', /<\/?\s*tool_(?:result|use|call)\b|\[\/?\s*tool_result/iu],
  ['addressed_to_agent', /\bnote to (?:the )?(?:ai|assistant|agent|bot|model|triage bot|classifier)\b|\b(?:ai|agent) reviewer\b/iu],
  ['override', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}?\b(?:instructions?|rules?|template|policy|prompt|guidelines?|classification)\b/iu],
  ['approval_claim', /\bpre-?(?:approved|reviewed)\b|\balready (?:been )?(?:approved|reviewed)\b|\bno (?:human )?review (?:needed|required)\b|\bskip (?:the )?(?:human )?review\b/iu],
  ['label_directive', /\b(?:classify|label|mark|tag|set|output|respond)\b[^.\n]{0,40}?\b(?:as|to|with|only)?\s*[^.\n]{0,20}?\b(?:SPAM|P[1-4]|needs_human|priority|category|route|confidence|BILLING|ACCOUNT_ACCESS|BUG|HOW_TO|FEATURE_REQUEST|INTEGRATION|PRIVACY_DATA|OUTAGE|OTHER)\b/iu],
  ['harness_name', /\b(?:needs_human|category_confidence_bps|priority_confidence_bps|secondary_category|output_config|json_schema)\b|\badmin override\b/iu],
  ['exfiltration', /\b(?:include|reveal|print|repeat|show)\b[^.\n]{0,30}?\b(?:system prompt|your instructions|the prompt)\b/iu],
];

export interface ScreenHit { rule: ScreenRule; match: string }

/** Every rule that fires on `text`, in rule order, with its first matched text. */
export function screen(text: string): ScreenHit[] {
  const hits: ScreenHit[] = [];
  for (const [rule, rx] of SCREEN_RULES) {
    const m = rx.exec(text);
    if (m) hits.push({ rule, match: m[0].trim() });
  }
  return hits;
}

/** The text the pipeline screens: subject, newline, body (as reference_pipeline.py). */
export const screenText = (t: { subject: string; body: string }): string => t.subject + '\n' + t.body;
