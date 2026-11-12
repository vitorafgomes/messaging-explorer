---
title: "<Short descriptive title>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial incident writeup"
page_type: incident
status: active           # active | archived after 1 year
description: "<One-sentence summary>"
source:
  - raw/incidents/<filename>
reliability: high
---

# <Short descriptive title>

> One-sentence summary. Severity + impact + duration.

## Summary

- **Severity:** SEV-N
- **Start:** YYYY-MM-DD HH:MM UTC
- **Detected:** YYYY-MM-DD HH:MM UTC (by whom / what)
- **Resolved:** YYYY-MM-DD HH:MM UTC
- **Duration:** Xh Ym
- **Impact:** <users affected, revenue, etc.>
- **Services affected:** [[pages/services/...]], [[pages/services/...]]

## Timeline

Bulleted, with timestamps. One line per event.

- HH:MM — first symptom observed
- HH:MM — paging alert fired
- HH:MM — incident commander assigned
- HH:MM — root cause hypothesized
- HH:MM — mitigation applied
- HH:MM — monitoring confirms recovery
- HH:MM — incident closed

## Root cause

What actually broke. Not just the trigger — the underlying condition that made the trigger dangerous.

## Contributing factors

Things that made it worse or made detection slower. Not blame — conditions.

## Resolution

What was done to recover. Link the PR / commit / config change.

## Invariants added

If this incident motivates a new invariant, link the new page:

- [[pages/invariants/...]] — *one-line statement*

If the incident revealed a violated invariant that wasn't being enforced, flag that:

- [[pages/invariants/...]] was not actually enforced at `src/<path>.cs:LINE`. Enforcement added in <PR link>.

## Follow-ups

Action items with owners and target dates. Link the tracker item.

- [ ] <action> — owner, target date
- [ ] <action> — owner, target date

## Related

- ADRs: [[pages/decisions/...]]
- Services: [[pages/services/...]]
- Similar past incidents: [[pages/incidents/...]]
- Postmortem doc in `raw/incidents/`: `raw/incidents/<filename>`

## Lessons

One paragraph of what the team learned. Keep it honest; this is the part people re-read.
