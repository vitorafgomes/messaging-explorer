---
title: "<Task / procedure name>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial runbook"
page_type: runbook
status: active
description: "<One-sentence purpose>"
source:
  - <source paths>
reliability: high
---

# <Task / procedure name>

> One-sentence purpose. "Run this when X."

## When to run this

Concrete triggers. Not "when something's wrong" — what specific symptom, alert, or request calls for this procedure.

## Preconditions

Things that must be true before starting. If any are false, stop and link the runbook that sets them up.

- [ ] <precondition> — verify via <command / dashboard>
- [ ] <precondition>

## Required access

- <Role / tool / credential>
- <Role / tool / credential>

## Steps

Numbered, verifiable. Each step includes the command and the expected result.

1. **<Step summary>**
   ```bash
   <command>
   ```
   Expected: <what you should see>

2. **<Step summary>**
   ```bash
   <command>
   ```
   Expected: <what you should see>

3. **<Step summary>** — *(destructive — confirm with on-call before running)*
   ```bash
   <command>
   ```
   Expected: <what you should see>

## Verification

How to confirm the procedure worked. Not just "no error" — a positive signal.

- <dashboard link> should show <metric> at <value>
- <health endpoint> should return <status>

## Rollback

If the procedure goes wrong at any step, how to undo it.

1. <rollback step>
2. <rollback step>

If rollback isn't possible from a given step, mark it: *"Step N is not reversible — do not proceed unless <condition>."*

## Escalation

If the procedure fails or produces unexpected results:

- Primary: <person / team>
- Secondary: <person / team>
- See [[pages/overview/stakeholders]] for current on-call.

## Related

- Services: [[pages/services/...]]
- ADRs: [[pages/decisions/...]]
- Similar runbooks: [[pages/runbooks/...]]
