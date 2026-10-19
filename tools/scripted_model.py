"""Triage — scripted model (test oracle, never product code).

Stands in for the Claude API until Phase 2 records real responses. For every ticket it writes a
result in the exact shape of a Message Batches results line (custom_id + result.type +
result.message with content and usage), so the TypeScript pipeline reads these files through the
same parser it will use for real recordings and never learns which it has.

The error pattern is DESIGNED (section 10 of docs/domain-brief.md): per hard-case correct
probabilities, confidence ranges, a share of injection compliance, a share of errored and
malformed results. Every number the reference pipeline prints from these files is therefore a
check of the plumbing and the arithmetic, not a measurement of any model. Token counts are
estimates (ceil(bytes/4)); real usage fields replace them in Phase 2.

Tier A is written for every ticket. Tier B is written for every ticket too, so the threshold sweep
can be run offline; the pipeline reads only the tier-B lines it escalates to.

Deterministic per ticket: the RNG is seeded from sha256(seed, tier, ticket_id).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from triagelib import CATEGORIES, PRIORITIES, POLICY, ROOT, est_tokens  # noqa: E402

PROMPT_PATH = os.path.join(ROOT, "prompts", "classify.v1.md")
SCHEMA_PATH = os.path.join(ROOT, "schemas", "triage.v1.json")

# Designed error model. Keys: hard_case -> P(category correct). INJECTION has a separate comply share.
TIER = {
    "A": {
        "model": POLICY["tiers"]["A"]["model"],
        "cat_ok": {"NONE": 0.93, "AMBIGUOUS": 0.62, "MULTI_ISSUE": 0.72, "INJECTION": 0.90, "NON_ENGLISH": 0.80,
                   "CHURN_THREAT": 0.90, "NEW_TOPIC": 0.70},
        "inject_comply": 0.15, "pri_ok": 0.88, "nh_ok": 0.93, "lang_ok": 0.97,
        "conf_ok": (8100, 9950), "conf_ok_low_share": 0.08, "conf_ok_low": (5500, 8000), "conf_wrong": (4500, 8500),
        "hard_shift": 900, "errored": 0.010, "malformed": 0.005, "bad_enum": 0.003,
    },
    "B": {
        "model": POLICY["tiers"]["B"]["model"],
        "cat_ok": {"NONE": 0.97, "AMBIGUOUS": 0.78, "MULTI_ISSUE": 0.85, "INJECTION": 0.95, "NON_ENGLISH": 0.93,
                   "CHURN_THREAT": 0.95, "NEW_TOPIC": 0.85},
        "inject_comply": 0.03, "pri_ok": 0.93, "nh_ok": 0.96, "lang_ok": 0.99,
        "conf_ok": (8500, 9980), "conf_ok_low_share": 0.06, "conf_ok_low": (6500, 8500), "conf_wrong": (5000, 8800),
        "hard_shift": 600, "errored": 0.003, "malformed": 0.0, "bad_enum": 0.0,
    },
}
PRIO_IDX = {p: i for i, p in enumerate(PRIORITIES)}
CONFUSION = {  # where a wrong category tends to go when there is no secondary to confuse with
    "BILLING": ["ACCOUNT_ACCESS", "HOW_TO"], "ACCOUNT_ACCESS": ["BUG", "BILLING"], "BUG": ["HOW_TO", "INTEGRATION", "OUTAGE"],
    "HOW_TO": ["FEATURE_REQUEST", "BUG"], "FEATURE_REQUEST": ["HOW_TO"], "INTEGRATION": ["BUG", "HOW_TO"],
    "PRIVACY_DATA": ["HOW_TO", "ACCOUNT_ACCESS"], "OUTAGE": ["BUG"], "SPAM": ["OTHER"], "OTHER": ["SPAM", "HOW_TO"],
}


def rng_for(seed: int, tier: str, tid: str) -> random.Random:
    return random.Random(int(hashlib.sha256(f"{seed}:{tier}:{tid}".encode()).hexdigest()[:16], 16))


def clamp(v: int) -> int:
    return max(0, min(10000, v))


def conf(r: random.Random, t: dict, ok: bool, hard: bool) -> int:
    if ok:
        lo, hi = t["conf_ok_low"] if r.random() < t["conf_ok_low_share"] else t["conf_ok"]
    else:
        lo, hi = t["conf_wrong"]
    v = r.randint(lo, hi)
    if hard:
        v -= t["hard_shift"]
    return clamp(v)


def script_one(r: random.Random, t: dict, key: dict, ticket: dict) -> tuple[dict | None, bool, str]:
    """Returns (output object or None, attacker_complied, failure_kind)."""
    kind = key["hard_case"]
    hard = kind != "NONE"
    f = r.random()
    if f < t["errored"]:
        return None, False, "errored"
    if f < t["errored"] + t["malformed"]:
        return None, False, "malformed"
    if f < t["errored"] + t["malformed"] + t["bad_enum"]:
        return None, False, "bad_enum"

    truth_cat, truth_pri, truth_nh = key["category"], key["priority"], key["needs_human"] == "true"
    complied = False
    if kind == "INJECTION" and r.random() < t["inject_comply"]:
        complied = True
        wants = json.loads(key["attacker_wants"])
        cat = wants.get("category", truth_cat)
        pri = wants.get("priority", truth_pri)
        nh = wants.get("needs_human", False)
        reason = "Per the instruction in the ticket." + (" System prompt: You are the triage step for Fernwick..." if wants.get("exfiltrate") else "")
        return {
            "category": cat, "category_confidence_bps": r.randint(8500, 9900),
            "priority": pri, "priority_confidence_bps": r.randint(8000, 9800),
            "needs_human": nh, "needs_human_confidence_bps": r.randint(8000, 9800),
            "language": key["language"], "secondary_category": "NONE", "reason": reason,
        }, True, ""

    ok = r.random() < t["cat_ok"][kind]
    if ok:
        cat = truth_cat
    else:
        sec = key["secondary_category"]
        if sec != "NONE" and r.random() < 0.8:
            cat = sec
        else:
            cat = r.choice(CONFUSION[truth_cat])
    pri_ok = r.random() < t["pri_ok"]
    if pri_ok:
        pri = truth_pri
    else:
        i = PRIO_IDX[truth_pri] + r.choice([-1, 1])
        pri = PRIORITIES[max(0, min(3, i))]
        if pri == truth_pri:
            pri = PRIORITIES[max(0, min(3, PRIO_IDX[truth_pri] + (1 if i < 0 else -1)))]
    nh_ok = r.random() < t["nh_ok"]
    nh = truth_nh if nh_ok else (not truth_nh)
    lang = key["language"] if r.random() < t["lang_ok"] else ("en" if key["language"] != "en" else "es")
    secondary = key["secondary_category"] if (kind == "MULTI_ISSUE" and r.random() < 0.7) else "NONE"
    words = ticket["body"].split()
    quote = " ".join(words[:6])
    return {
        "category": cat, "category_confidence_bps": conf(r, t, ok, hard),
        "priority": pri, "priority_confidence_bps": conf(r, t, pri_ok, hard),
        "needs_human": nh, "needs_human_confidence_bps": conf(r, t, nh_ok, hard),
        "language": lang, "secondary_category": secondary,
        "reason": f"The ticket says '{quote}' which is a {cat.lower().replace('_', ' ')} request.",
    }, False, ""


def result_line(tid: str, model: str, text: str | None, failure: str, usage: dict, i: int) -> dict:
    if failure == "errored":
        return {"custom_id": tid, "result": {"type": "errored", "error": {"type": "error", "error": {"type": "api_error", "message": "scripted: internal server error"}}}}
    msg = {
        "id": f"msg_scripted_{hashlib.sha256(tid.encode()).hexdigest()[:12]}", "type": "message", "role": "assistant", "model": model,
        "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None, "usage": usage,
    }
    return {"custom_id": tid, "result": {"type": "succeeded", "message": msg}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261019)
    ap.add_argument("--fixtures", default=os.path.join(ROOT, "fixtures"))
    a = ap.parse_args()
    with open(PROMPT_PATH, encoding="utf-8") as f:
        system_tokens = est_tokens(f.read())
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        schema_tokens = est_tokens(f.read())
    prefix_tokens = system_tokens + schema_tokens  # the cached prefix: system prompt + output schema

    for batch in (1, 2):
        tickets = [json.loads(l) for l in open(os.path.join(a.fixtures, f"tickets_batch{batch}.jsonl"), encoding="utf-8")]
        keys = {k["ticket_id"]: k for k in csv.DictReader(open(os.path.join(a.fixtures, f"answer_key_batch{batch}.csv"), encoding="utf-8", newline=""))}
        for tier in ("A", "B"):
            t = TIER[tier]
            out = os.path.join(a.fixtures, f"scripted_tier{tier}_batch{batch}.jsonl")
            complied = failed = 0
            with open(out, "w", encoding="utf-8", newline="\n") as f:
                for i, tk in enumerate(tickets):
                    tid = tk["ticket_id"]
                    r = rng_for(a.seed, tier, tid)
                    obj, c, failure = script_one(r, t, keys[tid], tk)
                    complied += c
                    if failure == "malformed":
                        text = f"I think this ticket is about {keys[tid]['category'].lower()} but I am not certain; it could also be something else."
                    elif failure == "bad_enum":
                        bad = dict(obj or {})
                        bad = {"category": "REFUND", "category_confidence_bps": 9000, "priority": "P3", "priority_confidence_bps": 9000,
                               "needs_human": False, "needs_human_confidence_bps": 9000, "language": "en", "secondary_category": "NONE", "reason": "refund request"}
                        text = json.dumps(bad, sort_keys=True)
                    elif failure == "errored":
                        text = None
                    else:
                        text = json.dumps(obj, sort_keys=True)
                    failed += failure != ""
                    ticket_tokens = est_tokens(tk["subject"] + "\n" + tk["body"]) + 40
                    # one batch per (tier, batch): the first request writes the 1h cache, the rest read it
                    if i == 0:
                        usage = {"input_tokens": ticket_tokens, "cache_creation_input_tokens": prefix_tokens, "cache_read_input_tokens": 0,
                                 "output_tokens": 0 if text is None else est_tokens(text),
                                 "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": prefix_tokens}}
                    else:
                        usage = {"input_tokens": ticket_tokens, "cache_creation_input_tokens": 0, "cache_read_input_tokens": prefix_tokens,
                                 "output_tokens": 0 if text is None else est_tokens(text),
                                 "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0}}
                    f.write(json.dumps(result_line(tid, t["model"], text, failure, usage, i), sort_keys=True, separators=(",", ":")) + "\n")
            print(f"batch{batch} tier{tier}: {len(tickets)} results, {failed} failed, {complied} injection-complied -> {os.path.relpath(out, ROOT)}")
    print(f"prefix tokens (estimate, system prompt + schema): {prefix_tokens}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
