---
title: "ADR 0001 - In-repo vault and agent harness"
version: "1.0"
date: 2026-11-12
changes: "Initial ADR"
page_type: adr
status: accepted
description: "The technical documentation of Messaging Explorer lives in vault/ inside the repo, and Claude works here through a harness of agents, hooks, a pipeline skill and a review workflow under .claude/."
updated: 2026-11-12
source:
  - "chat"
  - ".claude/"
  - "vault/"
reliability: high
---

# ADR 0001 - In-repo vault and agent harness

## Status

Accepted, 2026-11-12 (owner request: create the whole agent structure, vault and Claude agents).

## Context

Until this date the repo had no `CLAUDE.md`, no `.claude/` and no documentation beyond `README.md`, `CHANGELOG.md` and `docs/ADDING_PROVIDERS.md`. The owner's notes on the project sit in a private Obsidian folder, written in April to July 2026, partly in Portuguese, and not re-verified against the code since. The tool is pointed at production brokers: a mistake in a bulk operation loses someone's messages, and a mistake at the API boundary exposes their credentials. An agent working here needs the rules and the known breaches in front of it before the first edit.

## Decision

1. **The vault is in the repo**, at `vault/`, with the operation contract `vault/CLAUDE.md`, the schema, the templates and the five wiki skills. It covers the whole repo. Pages are English, cite `path:line`, and `scripts/check-vault-refs.sh` resolves those citations in CI.
2. **The harness is in the repo**, under `.claude/`: four agents (`explorer-implementer`, `explorer-mechanic`, `explorer-reviewer`, `explorer-optimizer`), seven fail-open hooks with self-tests, the `explorer-pipeline` skill with four lanes, the `explorer-review` workflow. [[pages/conventions/tooling]] describes each.
3. **Ten team rules, A to J, in root `CLAUDE.md`.** B to E and J are general working rules. A (local, authenticated API), F (provider boundaries), G (secrets masked), H (bulk operations at-least-once) and I (one failing-call test per boundary) were derived on the founding day from what the code and the 2.3.0 changelog already enforce; each has an invariant page or a section of [[pages/conventions/testing]] with its enforcement points, its tests and its known exceptions.
4. **Known breaches are written down, not fixed, at the founding.** The founding survey read the code and recorded what it found under "Known gaps" on each service page and in [[pages/roadmap/followups]]. The standard is: a change never adds a gap and never widens one.
5. **The review lenses are this repo's risks**: `api-surface`, `secrets`, `message-safety`, `boundaries`, `invariants`, and `performance` through the optimizer. The first three run on opus.
6. **The owner's private notes stay private.** Nothing from the Obsidian folder was copied; the vault was founded from the code only.

## Consequences

- Positive: an agent starts from verified pages and named risks; a review has pages to cite; the citations cannot rot silently.
- Negative: the vault is one more thing a change must keep true (gate 7), and the harness one more thing CI runs.
- The gates are only as strict as the repo: there is no warnings-as-errors, no format or lint gate, no web tests in CI, and the web suite is red. The pipeline states this instead of pretending; raising the bar is tracked work.
- A rule among A, F, G, H and I that the owner disagrees with is changed in root `CLAUDE.md` and its invariant page in one change, with a line in `vault/log.md`.

## Alternatives considered

- **Documentation in the Obsidian vault only**, the owner's default for repos without an in-repo vault: rejected for this repo because it is public and open to contributors, who cannot read a private folder, and because citations there cannot be checked against the tree in CI.
- **Stricter gates from day one** (a diagnostics script, architecture tests, a format gate): rejected at the founding because they rest on build settings this repo lacks; adopting the settings is a change to the product build and goes through the pipeline on its own.
