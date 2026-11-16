"""Triage — the spec made executable (test oracle, never product code).

Every rule in docs/domain-brief.md sections 5-9 is implemented here once, read from the JSON
under routing/, monitoring/, pricing/ and schemas/, so the oracle and the TypeScript pipeline
apply the same data. The TypeScript pipeline is written from the brief, not ported from this
file, and must agree with it on every ticket (tools/reference_pipeline.py prints the numbers it
must reproduce).

Integers only: confidence and shares are basis points, money is pico-USD. One rounding rule
(half up) in one function. Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _load(rel: str) -> dict:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


POLICY = _load("routing/policy.v1.json")
DRIFT = _load("monitoring/drift.v1.json")
PRICES = _load("pricing/prices.v1.json")
SCHEMA = _load("schemas/triage.v1.json")

CATEGORIES = POLICY["labels"]["category"]
PRIORITIES = POLICY["labels"]["priority"]
ROUTES = POLICY["labels"]["route"]
BPS = 10000


def content_hash(rel: str) -> str:
    """sha256 of the file bytes; recorded in docs/decisions.md for each data file."""
    with open(os.path.join(ROOT, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# ---------------------------------------------------------------- rounding (one rule, one place)

def round_half_up(x: Fraction) -> int:
    """The only rounding in the project. Exact rational in, integer out, ties away from zero."""
    if x >= 0:
        return int((x * 2 + 1) // 2)
    return -int((-x * 2 + 1) // 2)


def bps(num: int, den: int) -> int:
    """num/den as integer basis points, rounded half up. den == 0 -> 0 (reported, never divided)."""
    if den == 0:
        return 0
    return round_half_up(Fraction(num * BPS, den))


# ---------------------------------------------------------------- injection screen (ported from opsagent screen.py)

I = re.IGNORECASE
SCREEN_RULES: dict[str, re.Pattern[str]] = {
    # opsagent src/opsagent/screen.py rules, kept where a support ticket has the same surface
    "role_marker": re.compile(r"\b(?:system|assistant|developer)\s*:|\[\s*(?:system|admin|assistant)\b", I),
    "fake_tool_output": re.compile(r"</?\s*tool_(?:result|use|call)\b|\[/?\s*tool_result", I),
    "addressed_to_agent": re.compile(r"\bnote to (?:the )?(?:ai|assistant|agent|bot|model|triage bot|classifier)\b|\b(?:ai|agent) reviewer\b", I),
    "override": re.compile(r"\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}?\b(?:instructions?|rules?|template|policy|prompt|guidelines?|classification)\b", I),
    "approval_claim": re.compile(r"\bpre-?(?:approved|reviewed)\b|\balready (?:been )?(?:approved|reviewed)\b|\bno (?:human )?review (?:needed|required)\b|\bskip (?:the )?(?:human )?review\b", I),
    # new here: directives aimed at this pipeline's labels and fields
    "label_directive": re.compile(r"\b(?:classify|label|mark|tag|set|output|respond)\b[^.\n]{0,40}?\b(?:as|to|with|only)?\s*[^.\n]{0,20}?\b(?:SPAM|P[1-4]|needs_human|priority|category|route|confidence|BILLING|ACCOUNT_ACCESS|BUG|HOW_TO|FEATURE_REQUEST|INTEGRATION|PRIVACY_DATA|OUTAGE|OTHER)\b", I),
    "harness_name": re.compile(r"\b(?:needs_human|category_confidence_bps|priority_confidence_bps|secondary_category|output_config|json_schema)\b|\badmin override\b", I),
    "exfiltration": re.compile(r"\b(?:include|reveal|print|repeat|show)\b[^.\n]{0,30}?\b(?:system prompt|your instructions|the prompt)\b", I),
}


def screen(text: str) -> list[tuple[str, str]]:
    """(rule, first matched text) for every rule that fires, in rule order.
    A hit never changes a label by itself; the policy turns it into needs_human=true and a flag.
    Honest scope: written with the fixture injection set in view, so its flag rate on that set is
    an upper bound on recall, not an estimate."""
    hits: list[tuple[str, str]] = []
    for rule, rx in SCREEN_RULES.items():
        m = rx.search(text)
        if m:
            hits.append((rule, m.group(0).strip()))
    return hits


# ---------------------------------------------------------------- model result parsing (what the pipeline accepts)

REQUIRED = SCHEMA["required"]


@dataclass
class Parsed:
    category: str
    category_bps: int
    priority: str
    priority_bps: int
    needs_human: bool
    needs_human_bps: int
    language: str
    secondary_category: str
    reason: str

    @property
    def min_bps(self) -> int:
        return min(self.category_bps, self.priority_bps, self.needs_human_bps)


def parse_result(message_text: str) -> tuple[Parsed | None, str]:
    """Parse a model's text block against schemas/triage.v1.json. Returns (Parsed, "") or
    (None, failure_code). A failure is typed; the policy maps it to a path, never to a default label."""
    try:
        obj = json.loads(message_text)
    except (json.JSONDecodeError, TypeError):
        return None, "PARSE_JSON"
    if not isinstance(obj, dict):
        return None, "PARSE_SHAPE"
    for k in REQUIRED:
        if k not in obj:
            return None, f"PARSE_MISSING:{k}"
    if set(obj) - set(REQUIRED):
        return None, "PARSE_EXTRA_KEY"

    def enum(v, allowed, code):
        if not isinstance(v, str):
            return None, code
        u = v.upper()
        return (u, "") if u in allowed else (None, code)

    cat, e = enum(obj["category"], CATEGORIES, "PARSE_ENUM:category")
    if e:
        return None, e
    pri, e = enum(obj["priority"], PRIORITIES, "PARSE_ENUM:priority")
    if e:
        return None, e
    sec, e = enum(obj["secondary_category"], ["NONE"] + CATEGORIES, "PARSE_ENUM:secondary_category")
    if e:
        return None, e
    for k in ("category_confidence_bps", "priority_confidence_bps", "needs_human_confidence_bps"):
        v = obj[k]
        if not isinstance(v, int) or isinstance(v, bool) or v < 0 or v > BPS:
            return None, f"PARSE_RANGE:{k}"
    if not isinstance(obj["needs_human"], bool):
        return None, "PARSE_TYPE:needs_human"
    if not isinstance(obj["language"], str) or not re.fullmatch(r"[a-z]{2}", obj["language"].lower()):
        return None, "PARSE_TYPE:language"
    if not isinstance(obj["reason"], str):
        return None, "PARSE_TYPE:reason"
    return Parsed(cat, obj["category_confidence_bps"], pri, obj["priority_confidence_bps"],
                  obj["needs_human"], obj["needs_human_confidence_bps"], obj["language"].lower(), sec, obj["reason"]), ""


# ---------------------------------------------------------------- routing policy (brief section 6)

@dataclass
class TierResult:
    """One model call's outcome as the pipeline sees it: a parsed result or a typed failure."""
    tier: str
    model: str
    parsed: Parsed | None
    failure: str  # "" when parsed; else API result type (errored/expired/canceled) or PARSE_*
    usage: dict = field(default_factory=dict)  # input_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation_1h_input_tokens, output_tokens


@dataclass
class Decision:
    ticket_id: str
    path: str  # A | A>B | A>H | A>B>H
    final_tier: str  # A or B or "" when neither parsed
    category: str
    priority: str
    route: str
    needs_human: bool
    language: str
    min_bps: int
    flags: list[str]
    reasons: list[str]


def escalate(a: TierResult) -> tuple[bool, str]:
    rule = POLICY["escalate_to_tier_b_when"]
    if a.parsed is None:
        return (rule["tier_a_failed"], f"TIER_A_FAILED:{a.failure}")
    p = a.parsed
    if p.category in rule["category_in"]:
        return True, f"CATEGORY_ALWAYS_B:{p.category}"
    if p.min_bps < rule["min_confidence_bps_below"]:
        return True, f"LOW_CONFIDENCE:{p.min_bps}<{rule['min_confidence_bps_below']}"
    return False, ""


def route_for(category: str, priority: str) -> str:
    for o in POLICY["route_overrides"]:
        w = o["when"]
        if w.get("category", category) == category and w.get("priority", priority) == priority:
            return o["route"]
    return POLICY["route_by_category"][category]


def decide(ticket_id: str, text: str, a: TierResult, b: TierResult | None) -> Decision:
    """Apply routing/policy.v1.json to a ticket, its tier-A result and (if escalated) tier-B result.
    b must be given exactly when escalate(a) is true."""
    flags: list[str] = []
    reasons: list[str] = []
    hits = screen(text)
    if hits:
        flags.append("INJECTION_SUSPECTED")
        reasons.append("screen:" + ",".join(sorted({r for r, _ in hits})))

    esc, why = escalate(a)
    assert esc == (b is not None), f"{ticket_id}: escalation {esc} but tier B {'given' if b else 'missing'}"
    final = b if esc else a
    path = "A>B" if esc else "A"
    if esc:
        reasons.append("escalate:" + why)
    if a.parsed is None:
        flags.append(f"TIER_A_FAILED:{a.failure}")

    nh = POLICY["needs_human_when"]
    needs_human = False
    if final.parsed is None:
        # Neither usable result: nothing is labelled by a default. The ticket goes to a person as OTHER/P3
        # for queue placement only, flagged, and the eval counts it as a failure, never as a label.
        flags.append(f"FINAL_TIER_FAILED:{final.failure}")
        if nh["final_tier_failed"]:
            needs_human = True
            reasons.append("human:final_tier_failed")
        cat, pri, lang, min_bps = "OTHER", "P3", "", 0
    else:
        p = final.parsed
        cat, pri, lang, min_bps = p.category, p.priority, p.language, p.min_bps
        if p.category == "SPAM":
            sf = POLICY["spam_floor"]
            pri = sf["priority"]
        if nh["model_says_needs_human"] and p.needs_human:
            needs_human = True
            reasons.append("human:model_says")
        if pri in nh["priority_in"]:
            needs_human = True
            reasons.append(f"human:priority_{pri}")
        if cat in nh["category_in"]:
            needs_human = True
            reasons.append(f"human:category_{cat}")
        if min_bps < nh["final_min_confidence_bps_below"]:
            needs_human = True
            reasons.append(f"human:low_confidence_{min_bps}")
        if nh["language_not_supported"] and lang not in POLICY["supported_languages"]:
            needs_human = True
            flags.append(f"UNSUPPORTED_LANGUAGE:{lang}")
            reasons.append(f"human:language_{lang}")
        if p.secondary_category != "NONE":
            flags.append(f"SECONDARY:{p.secondary_category}")
            # D-51: a how-to or feature question that straddles a second category is the AMBIGUOUS shape
            # both tiers auto-handle (AMB-05, AMB-07); a person reads it.
            if cat in nh["secondary_with_category_in"]:
                needs_human = True
                reasons.append(f"human:secondary_{p.secondary_category}")
    if nh["screen_flagged"] and hits:
        needs_human = True
        reasons.append("human:screen_flagged")
    route = route_for(cat, pri)  # SPAM -> NONE by the table; a flagged spam ticket still sits in the human queue
    if needs_human:
        path += ">H"
    return Decision(ticket_id, path, final.tier if final.parsed else "", cat, pri, route, needs_human, lang, min_bps, flags, reasons)


# ---------------------------------------------------------------- cost (brief section 9)

def price_row(model: str, total_input_tokens: int) -> dict:
    rows = PRICES["models"]
    if model not in rows:
        raise KeyError(f"no price for model {model!r}; never guess")
    row = rows[model]
    if "prompt_tokens_max" in row and total_input_tokens > row["prompt_tokens_max"]:
        return rows[model + ":long"]
    return row


def cost_pico(model: str, usage: dict, batch: bool) -> int:
    """pico-USD for one response's usage fields. Unknown model raises."""
    inp = usage.get("input_tokens", 0)
    rd = usage.get("cache_read_input_tokens", 0)
    w5 = usage.get("cache_creation_input_tokens", 0) - usage.get("cache_creation_1h_input_tokens", 0)
    w1 = usage.get("cache_creation_1h_input_tokens", 0)
    out = usage.get("output_tokens", 0)
    row = price_row(model, inp + rd + w5 + w1)
    total = inp * row["input"] + rd * row["cache_read"] + w5 * row["cache_write_5m"] + w1 * row["cache_write_1h"] + out * row["output"]
    if batch:
        m = PRICES["batch_multiplier"]
        total = round_half_up(Fraction(total * m["num"], m["den"]))
    return total


def pico_to_cents(p: int) -> int:
    """pico-USD -> integer cents, rounded half up (1 cent = 10^10 pico-USD)."""
    return round_half_up(Fraction(p, 10**10))


def est_tokens(text: str) -> int:
    """Estimate used only where no usage field exists (the scripted model and the pre-run cap check):
    ceil(utf-8 bytes / 4). Labelled 'estimate' wherever it is printed."""
    n = len(text.encode("utf-8"))
    return (n + 3) // 4


# ---------------------------------------------------------------- drift (brief section 8)

def tvd_bps(counts_a: dict[str, int], counts_b: dict[str, int]) -> int:
    """Total variation distance between two label mixes, in bps, exact then rounded once:
    round_half_up( 10000 * sum_i |a_i/n_a - b_i/n_b| / 2 )."""
    na, nb = sum(counts_a.values()), sum(counts_b.values())
    if na == 0 or nb == 0:
        return 0
    keys = set(counts_a) | set(counts_b)
    s = sum(abs(Fraction(counts_a.get(k, 0), na) - Fraction(counts_b.get(k, 0), nb)) for k in keys)
    return round_half_up(s * BPS / 2)


def audit_sampled(ticket_id: str, seed: int) -> bool:
    """Reproducible audit sample: sha256(f"{seed}:audit:{ticket_id}") first 8 hex as an int, mod 10000 < audit_sample_bps."""
    h = int(hashlib.sha256(f"{seed}:audit:{ticket_id}".encode()).hexdigest()[:8], 16)
    return h % BPS < POLICY["audit_sample_bps"]


@dataclass
class WindowStats:
    n: int
    category_counts: dict[str, int]
    priority_counts: dict[str, int]
    escalated: int
    human_queue: int
    low_conf_a: int
    unsupported_lang: int
    results_total: int
    results_failed: int
    human_touched: int
    overridden: int

    def shares(self) -> dict[str, int]:
        return {
            "escalation_share_bps": bps(self.escalated, self.n),
            "human_queue_share_bps": bps(self.human_queue, self.n),
            "low_confidence_share_bps": bps(self.low_conf_a, self.n),
            "unsupported_language_share_bps": bps(self.unsupported_lang, self.n),
            "parse_failure_rate_bps": bps(self.results_failed, self.results_total),
            "override_rate_bps": bps(self.overridden, self.human_touched),
        }


def drift_signals(baseline: WindowStats, window: WindowStats) -> list[dict]:
    """One row per signal in monitoring/drift.v1.json: id, value_bps, threshold_bps, fired."""
    bs, ws = baseline.shares(), window.shares()
    out = []
    for sig in DRIFT["signals"]:
        sid = sig["id"]
        if sig["kind"] == "distance":
            f = sig["field"]
            v = tvd_bps(getattr(baseline, f + "_counts"), getattr(window, f + "_counts"))
        elif sig["kind"] == "delta":
            key = {"OVERRIDE_RATE_DELTA": "override_rate_bps", "ESCALATION_SHARE_DELTA": "escalation_share_bps",
                   "HUMAN_QUEUE_SHARE_DELTA": "human_queue_share_bps", "LOW_CONFIDENCE_SHARE_DELTA": "low_confidence_share_bps",
                   "UNSUPPORTED_LANGUAGE_SHARE_DELTA": "unsupported_language_share_bps"}[sid]
            v = ws[key] - bs[key]
        else:
            v = ws["parse_failure_rate_bps"]
        fired = window.n >= DRIFT["min_window_items"] and v >= sig["threshold_bps"]
        out.append({"id": sid, "value_bps": v, "threshold_bps": sig["threshold_bps"], "fired": fired})
    return out


# ---------------------------------------------------------------- eval helpers (brief section 9)

def prf(tp: int, fp: int, fn: int) -> tuple[int, int, int]:
    """precision, recall, f1 in bps. Undefined (0/0) reported as 0 and the count columns say why."""
    p = bps(tp, tp + fp)
    r = bps(tp, tp + fn)
    f = bps(2 * tp, 2 * tp + fp + fn)
    return p, r, f


def ece_bps(pairs: list[tuple[int, bool]], bins: int = 10) -> int:
    """Expected calibration error over (confidence_bps, correct) pairs with equal-width bins:
    sum_b (n_b/n) * |acc_b - conf_b|, exact then rounded once to bps."""
    n = len(pairs)
    if n == 0:
        return 0
    width = Fraction(BPS, bins)
    tot = Fraction(0)
    for b in range(bins):
        lo, hi = width * b, width * (b + 1)
        inb = [(c, ok) for c, ok in pairs if (lo <= c < hi) or (b == bins - 1 and c == BPS)]
        if not inb:
            continue
        acc = Fraction(sum(1 for _, ok in inb if ok), len(inb))
        conf = Fraction(sum(c for c, _ in inb), len(inb) * BPS)
        tot += Fraction(len(inb), n) * abs(acc - conf)
    return round_half_up(tot * BPS)
