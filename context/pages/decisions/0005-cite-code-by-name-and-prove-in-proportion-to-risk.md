---
title: "ADR 0005 - Cite code by name, prove in proportion to the risk"
version: "1.0"
date: 2026-11-13
changes: "Initial decision"
page_type: adr
status: accepted
description: "Code is cited from the context by name (path#Member), never by line number; mutation proofs, the integration suite, the end-to-end suite and review rounds are spent where a message, a secret or the API boundary is at risk, and the suites run once per lane."
updated: 2026-11-13
source:
  - "chat: the owner's request of 2026-11-13"
  - "[[pages/decisions/0001-in-repo-vault-and-agent-harness]]"
reliability: high
---

# ADR 0005 - Cite code by name, prove in proportion to the risk

## Status

Accepted by the owner on 2026-11-13, who found the delivery of a screen as slow as a person's and asked what was wrong.

## Context

Measured on 2026-11-13:
- The context held 1,844 code citations by line number. Every edit above a cited line moved it, so each change spent time re-pointing them, and every pull request touched 7 to 18 context pages for it (one of them +157/-124 lines of renumbering). Every merge conflict of the day (five pull requests) was in those pages.
- Every change, a layout change included, carried a failing test plus a mutation proof per requirement (10 to 15 rebuilds and runs), the integration suite with Docker (2.5 to 6.5 minutes) several times, and two to three review rounds.
- Four or five lanes ran at once, each starting its own brokers; the machine (24 cores) reached a load of 100 to 145, suites timed out and ran again.
- A table of test counts in `testing.md` was edited by every lane and conflicted at every merge.

## Decision

- **Cite by name.** A code citation is `path#anchor`: a member, a type, a test title or a key that occurs in the file. `scripts/check-context-refs.sh` checks that the file exists and holds the anchor, and refuses a citation by line number. The existing citations were converted on 2026-11-13.
- **Prove in proportion to the risk.** A mutation proof is required for an entry under Rules A, F, G, H or I, or a new guard. Other new behaviour needs a failing-first spec of what the user sees; a visual refactor needs the behaviour lock (existing specs and end-to-end flows green before and after).
- **Run the suites once per lane.** The integration suite runs only when broker code changes; the end-to-end suite once at the end of a lane that changes the screen.
- **One review round,** a second only for a confirmed P1.
- **At most two heavy lanes at once** (Docker brokers or the end-to-end suite).
- **No test counts in the context;** CI shows them.

## Consequences

- A citation no longer points at one line inside a member; the reader finds the line in the member. A renamed member still breaks its citations, which the checker reports.
- Rule B stands: every edit ships with a test that fails without it. What changed is how much proof each test carries, and where.
- The explorer-pipeline skill (gates 4 to 6 and the token rules), `context/CLAUDE.md`, the schema and the templates carry the new rules.
