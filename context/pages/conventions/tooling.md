---
title: "Tooling"
version: "2.0"
date: 2026-11-12
changes: "v2.0: the pipeline by size and step; hooks and checks on their own page"
page_type: convention
status: active
description: "Who runs on which model and writes what, the pipeline skill, the rules files, the review workflow and what the build does not enforce; hooks and scripts are on their own page."
updated: 2026-11-13
source:
  - ".claude/"
  - "tools/"
  - ".github/workflows/ci.yml"
reliability: high
---

# Tooling

The harness was founded on 2026-11-12: sh + jq hooks with case-matrix self-tests, one pipeline skill, a review workflow, an in-repo context ([[pages/decisions/0001-in-repo-vault-and-agent-harness]]). What it deliberately does not have yet is at the end of this page. The hooks and the scripts under `tools/` are on [[pages/conventions/hooks-and-checks]]. Root `CLAUDE.md` names this page; the `explorer-pipeline` skill dispatches by it.

## Model routing

The session model does every survey, plan and check; Opus implements and reviews what can hurt a user (who reaches the API, credentials, message loss); Sonnet reviews the rest and does the simple work; Haiku runs the `.prove-red`.

| Who | Model, effort | Writes code? |
|---|---|---|
| **The session** (the main thread): runs the pipeline. It looks at the tree and sizes the change by risk, reads the context, writes the six-part plan, implements a Fast path change and a Standard change that edits one project, checks an implementer's result against the plan line by line, runs the review workflow, and owns `context/index.md` and the area indexes, `context/log.md`, the conventions and the process ADRs. | session model | Context, docs, `.claude/**`; code on the Fast path and in a Standard change that edits one project. |
| **`explorer-implementer`**: builds from the plan a Standard change that edits two or more projects and every Sensitive change, a test per edit, and gives each requirement row the proof the Prove step asks: for a row under the rules on the API, providers, secrets, message safety or an external call, a targeted mutation with the failure quoted, the file restored from a backup copy and rebuilt; behaviour locks green before and after. | opus, high | **Yes**: `src/**` and `web-app/**` of the named project(s), plus the context pages the plan names. Never git history. |
| Any simple, mechanical, well-specified task (`general-purpose` on `model: sonnet`). | sonnet, medium | **Yes**, the named files only. |
| **`explorer-mechanic`**: the `.prove-red` when the session asks for one: the base commit extracted, the tests of the requirement table copied in, the run reported with exact counts; never fixes. An ordinary build or test run is one command through `tools/checks/in-docker.sh`. | haiku, low | Only inside `.prove-red`. |
| **`explorer-reviewer`**: the Review step, sent by the `explorer-review` workflow one instance per lens (`api-surface`, `secrets`, `message-safety`, `boundaries`, `invariants`); checks the proof the dispatch carries; each finding then faces a refute pass. | opus, high on `api-surface`, `secrets` and `message-safety`; sonnet, high on `invariants` and `boundaries`; refute pass: sonnet, high | No. |
| **`explorer-optimizer`**: the `performance` lens, added when the diff touches a bulk message operation, a peek, search or scan loop, the monitoring background service, the RabbitMQ management client, the metrics service, or an Angular polling or large-list path. | opus, high | No. |
| **`explorer-meter`**: where a session spent its tokens and what would lower that. | sonnet, medium | No. |
| Review, generic lens (`/code-review`) | Built-in skill, `medium`, never `--fix`; only when the diff touches `Program.cs`, `IMessagingProvider`, or the owner asks. | No. |
| Surveys past a handful of targeted reads | `Explore` subagent. | No. |

## `.claude/skills/explorer-pipeline`

The single source of the pipeline. `SKILL.md` holds the order of work and three sizes of process,
chosen by risk from what `git status` and `git diff` list:

| Size | The change | What runs |
|---|---|---|
| **Fast path** | Only comments or documentation, only an inert file, or one line of `.cs` or `.ts` with no effect on logic, a signature, a query or registration | The session edits; build and diagnostics for the touched project; no agent |
| **Standard** | Neither fast path nor sensitive | A plan; the session implements when the plan edits one project, `explorer-implementer` when it edits two or more; checks, proof, one review with the `invariants` lens |
| **Sensitive** | A row of `reference/sensitive.md` matches | A plan, `explorer-implementer`, checks, proof, a review with every lens that row names, `explorer-optimizer` when it names it |

A file on the never-fast-path list of `reference/sensitive.md` is at least Standard. The steps, by
name: **Look at the tree, then classify**, **Read the lane** (`feature.md`, `bugfix.md`, `refactor.md` or
`diagnose.md`), **Plan** (six parts and the requirement table), **Build**, **Check** (build at 0
warnings, `check-diagnostics.sh`, the test surface), **Prove** (in proportion to the risk,
[[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]]), **Review**, and
**Record, then stop** (the pages of `reference/records.md`, then one proposed commit message).
What makes a change sensitive, which tests it runs, what it records, how to build what an artboard
draws, the dispatch forms and which superpowers skills apply live in `reference/`, read when the
step needs them; the widest test-surface rule is also in `SKILL.md`, because the evals read only
that file.

## `.claude/rules/`

Loaded by Claude Code when a file of the matching paths is opened, and by a subagent that opens
one: `core.md`, `api.md`, `integration-tests.md`, `web-app.md` (with the tools for Angular work:
the Angular CLI's own server, registered read-only in `.mcp.json`), `electron-shell.md` and
`dotnet-skills.md`. Each holds the part's responsibility, the rules it keeps, what to read before
changing it, its commands, and a table from what a change touches to the topic page to read. The
full account is the service map and its topic pages; each rule in full is on the project's
`how-the-rules-are-kept` page.

## `.claude/workflows/explorer-review.js`

The Review step as a `Workflow` script: `Workflow({ name: "explorer-review", args: { module, lenses, dispatch, range? } })`. `invariants` always runs and also owns the project's rules, correctness, the comment rule and the proof of each requirement; the other lenses come from the rows of `reference/sensitive.md`, each on its own `explorer-reviewer`. A lens reports at most five findings and an empty list on a sound diff is the right answer. Every finding then goes to an independent `explorer-reviewer` on sonnet whose only job is to refute it. The result is `{ confirmed, refuted, unresolved, unresolvedLenses, checked, uncited }`. A `confirmed` finding is applied, the checks run again and the new diff goes back to review. A finding whose refuter returned nothing, or could not locate it in the reviewed tree, goes to `unresolved`: the session verifies it, and it blocks like a confirmed one until it has (the step fails closed). A `refuted` finding is recorded with the reason. A lens whose review returned nothing is named in `unresolvedLenses` and blocks until it is run again. One round of fix and review; a second only for a confirmed P1; a third means the change is not understood, and the rest goes to the owner. `.claude/workflows/explorer-review.test.sh` runs the real script under node with stub agents and checks the three lists, a silent lens, and the model each lens runs on. Without the Workflow tool the fallback is the direct `explorer-reviewer` dispatch, once per lens.

## `.claude/skills/wiki-*`

The five wiki skills (`wiki-crystallize`, `wiki-ingest`, `wiki-integrate`, `wiki-lint`, `wiki-query`) and their shared references. They read `context/wiki-config.md` and `context/wiki-schema.md`; the operation contract is `context/CLAUDE.md`. Where they say `index.md`, a new page goes to the index of its area, and a service topic page to its map.

`stryker-project` mutation-tests a whole project on the owner's request; it is never a required step.

## Permissions

`.claude/settings.json` allows without a prompt the read-only commands the checks need: `dotnet build|test`, `npm test -- --watch=false`, read-only git, `tools/checks/check-context-refs.sh` and every self-test. Every git, GitHub or publish command that `pre-git-guard` asks about stays a permission ask whatever the allow list says.

## What the build does not enforce

Stated so no step claims more than runs:

- No `Directory.Build.props`, no `TreatWarningsAsErrors`, no analyzers beyond the SDK defaults, no `.editorconfig`, no `dotnet format` gate, no `global.json`. The solution builds at 0 warnings on 2026-11-12 and the pipeline holds that line by reading the summary.
- No lint or format script in `web-app/package.json`.

Each is an entry in [[pages/roadmap/followups]].

## Not part of the harness yet

- An architecture-test project: it rests on build strictness this repo does not have yet.
- Release-version scripts and knowledge-graph git hooks: this repo tags by hand and has no knowledge graph.
- Whole-project mutation testing as a required step: the Prove step's targeted mutation is the proof, and `stryker-project` runs only on request.
- `evals/` for the pipeline skill, and project slash commands.

## Related

- [[pages/conventions/hooks-and-checks]]
- [[pages/conventions/testing]]
- [[pages/architecture/project-map]]
- Root `CLAUDE.md`, `AGENTS.md`, `.claude/skills/explorer-pipeline/SKILL.md`
