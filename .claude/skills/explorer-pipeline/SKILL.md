---
name: explorer-pipeline
description: Messaging Explorer task orchestration. Always use this skill BEFORE writing or editing any code in this repo - for bug fixes ("fix", "broken", "error", "wrong value", "doesn't work"), features ("add", "implement", "create", "new provider", "new endpoint", "new screen"), refactors ("clean up", "restructure", "rename", "extract"), and diagnostics ("why", "investigate", "debug", "what causes"). Use even when the user gives a plain one-line request with no command. When in doubt whether a code task is being requested, use this skill.
---

# Messaging Explorer task pipeline

This file is the single source of the pipeline. Root `CLAUDE.md` and the context point here; a
disagreement between them and this file is fixed here, in the same change that found it. Repo facts
live in the context (`context/index.md`); the team rules A to J live in root `CLAUDE.md`; who runs on
which model is on `context/pages/conventions/tooling.md`.

Scope: an open-source desktop tool that reads and changes messages on production brokers through a
local API. The manager (the session thread) classifies, reads the context, states the plan, dispatches
`explorer-implementer` with it and checks the result against the plan line by line, reporting any
departure to the owner instead of patching it silently.

## 0. The tree right now

Classification starts from the real diff, not from memory of what was touched: run
`git status --porcelain` and `git diff HEAD --stat` first and classify from what they list. As an
instruction, never as a dynamic shell block (an exclamation mark before a backticked command) in
this file: a skill that shells out while loading fails to load wherever Bash is denied, and then
nothing below this line is read.

## 1. Classify and announce

Classify **Feature / Bug / Refactor / Investigate**, then pick the shape:

| | Shape | Handling |
|---|---|---|
| **Fast path** | Any one of: (a) doc/comment-only; (b) an inert file only: Markdown (`.md`), plain text (`.txt`) or a raster image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`); any other extension is full pipeline; (c) a single-line `.cs`, `.ts`, `.html` or `.scss` with no logic, signature, route, binding or DI impact - and no touched file is on the never-list. | Manager edits inline -> `explorer-mechanic` build gate (`dotnet build ServiceBusExplorer.slnx` at 0 warnings for `.cs`; `npm run build` in `web-app/` for web files) -> commit message proposed. No other dispatch. |
| **Full pipeline** | Everything else, however small the diff looks. | Context, six-part plan, `explorer-implementer`, conformance check, every hard gate below. |

- **Never fast path, whatever the extension:** `ServiceBusExplorer.slnx`, `*.csproj`,
  `.github/workflows/**`, `appsettings*.json`, `config.json`, `.claude/**`, `scripts/**`,
  `web-app/package.json`, `web-app/package-lock.json`, `web-app/angular.json`,
  `web-app/tsconfig*.json`, `web-app/electron/**`,
  `src/ServiceBusExplorer.Api/Program.cs`.
- **Never trivial:** anything that adds or changes an endpoint, a middleware, CORS, host filtering
  or the Kestrel binding; an Electron IPC channel or the way the API process is started; a secret
  field, masking, export or import of connections; a bulk message operation (delete, resubmit,
  move, purge) or anything that receives, completes or abandons a message; a provider, a provider
  capability or DI registration.

State classification + one-line reason + **skills in play** before the first edit. Skills in play
is one line naming every installed skill that applies and whether you use it, or saying plainly
that none do; skill matching is otherwise silent. Usual candidates beyond `explorer-pipeline` and
`ponytail`: `superpowers:brainstorming` and `product-management:write-spec` (discovery for an owner
request with no spec), `wiki-crystallize` / `wiki-lint` (gate 7), the `dotnet-test:*` skills
(`AGENTS.md`). Naming one you then skip is fine; skipping it unnamed is not.

## 1b. Climb the ladder before writing anything

Invoke **`ponytail`** after the context reading and before the first edit, on every non-trivial lane
(Rule C with a procedure). The order is fixed: **context first, ladder second, edit third.** Two
reconciliations: Rule B beats ponytail's "one runnable check, no frameworks" (the check here is an
xUnit test in the project's test project, or a `*.spec.ts` beside the file, run by `ng test`),
and a documented convention (the provider abstraction, masking, send before complete) is never
over-engineering; if one looks like bloat, that is a superseding ADR, not a shortcut.

## 2. Read the lane file

Read exactly one from this directory: `feature.md` | `bugfix.md` | `refactor.md` | `diagnose.md`.

## Plan shape (state it before dispatching, on every non-trivial lane)

No narrative, no options survey, no restating the request. Exactly six parts; the plan travels
verbatim into the `explorer-implementer` dispatch and the conformance check is against it:

1. **Files** - exact `EDIT` and `CONTEXT` paths, including the context pages the implementer writes
   (project page, ADR amendment, roadmap entry).
2. **Steps** - ordered in Rule B shape, naming the test class or spec each step touches. On the bug
   and refactor lanes step one is the failing or pinning test.
3. **Invariants at risk** - context pages and the tests that pin them. A step that would violate an
   invariant is not a step: stop, a superseding ADR first.
4. **Acceptance** - literal build and test commands.
5. **Out of scope** - adjacent work this change must not touch. The "Known gaps" of the project
   page are out of scope unless the request names one.
6. **Requirement-to-test map** - every requirement in the user's words, the exact test path and
   test name that prove it, and its kind: `new behaviour` (new or changed behaviour; must fail when
   the behaviour is removed), `behaviour lock` (behaviour-preserving refactor; green before and
   after - red before means reclassify as a feature or fix) or `mutation proof` (a brand-new
   provider or feature where nothing compiles without the change). Every test asserts the
   requirement, never registration, mapping or a call happening. The map travels unchanged into
   gate 5, the review dispatch and the PR body.

Three things the plan always states outright: whether the change touches the **API surface**
(endpoint, middleware, IPC; or none), whether it touches a **secret** (which field, where it is
masked; or none), and whether it **receives, completes or sends a message** (which operation and
in which order; or none). A plan thin enough that implementing it means re-grepping the repo was
stated too fast: fix the plan.

## 3. Hard gates (every non-trivial code lane)

1. **Context first** - `context/pages/services/<project>.md` + every invariant it links, BEFORE editing.

   **Capability check.** The project page carries no rules for a capability you are about to *add*:

   | The change... | Read first | The trap |
   |---|---|---|
   | adds or changes an **endpoint, a middleware, CORS, host filtering, the binding or an IPC channel** | [[pages/invariants/local-authenticated-api]] + Rule A | a route mapped before the key middleware; an origin or a host added "for dev"; an error body that returns the exception message |
   | touches a **connection string, password, client secret, the API secret, export or import** | [[pages/invariants/secrets-masked-at-the-api-boundary]] + Rule G | a new secret field missing from `MaskConnection` or from the sentinel merge; a response built from the unmasked object; a secret in a log line |
   | **receives, completes, abandons, sends, moves or purges messages** | [[pages/invariants/bulk-operations-are-at-least-once]] + Rule H | complete before send; a silent resend after a failed complete; a scan with no bound; a token not forwarded |
   | adds or changes a **provider, a capability, or a vendor SDK call** | [[pages/invariants/provider-boundaries]] + Rule F, `docs/ADDING_PROVIDERS.md` (check it against `pages/services/web-app` first, parts of it are stale) | an `Azure.*` or `RabbitMQ.Client` type in a controller, a model or an abstraction; a member one provider silently does not implement |
   | adds or changes a call across an **external boundary** (broker SDK, HTTP management API, Azure Monitor, filesystem, subprocess) | `pages/conventions/testing.md` "One failing-call test per external boundary" + Rule I | the happy path is tested and the timeout, 5xx or broker exception path is not |
   | touches **`web-app/**`** | `pages/services/web-app`, `pages/services/electron-shell` | an HTTP call that bypasses `ApiService` and so carries no key; running plain `npx vitest`, which has no Angular compiler and fails on tests that are sound |
   | changes a **screen**: a template, a component's styles, a dialog | `pages/conventions/ui.md` | a new Bootstrap class, Font Awesome icon or literal colour; a destructive action beside a routine one; an icon button with no name; an error shown as an empty list |
   | adds a **guard**, a validation or a new error path | [[pages/invariants/a-guard-must-be-able-to-fire]] | a check the lines before it make unreachable, or a failure answered as success; write the test whose input makes the guard fire with it |
   | answers a finding as **intended behaviour** | [[pages/conventions/decisions-that-look-like-defects]] | the same finding is reported again by the next review; add the entry in the change that answers it |

2. **Rule B per edit** - edit -> test -> validate build.
3. **Build.** `dotnet build ServiceBusExplorer.slnx` with `0 Warning(s)` and `0 Error(s)` on the
   summary line (the build does not fail on a warning; the gate is the line), and for `web-app/**`
   `npm run build` in `web-app/`. This repo has no format or analyzer gate yet
   (`context/pages/roadmap/followups.md`); do not claim one ran.
4. **Full test surface green.** A filter is allowed for a named subset when a proof or a batch
   needs it; the full surface below then runs once **without** a filter before the commit message.
   Require `N passed` per project and a Skipped count of 0:

   | The diff touches... | The surface is |
   |---|---|
   | `src/ServiceBusExplorer.Core` | `dotnet test src/ServiceBusExplorer.Core.Tests` **and** `dotnet test src/ServiceBusExplorer.Api.Tests` (the Api references Core, and `FileWorkspaceManager` is only exercised through the Api tests) |
   | `src/ServiceBusExplorer.Api` | `dotnet test src/ServiceBusExplorer.Api.Tests` |
   | a JSON contract the Angular app reads (a controller route, a DTO, an enum) | the row above plus the `web-app/**` row |
   | `web-app/src/**`, `web-app/electron/**` | in `web-app/`: `npm test -- --watch=false` (`ng test`, every spec file) and `npm run build` |
   | `.claude/hooks/**` | every `.claude/hooks/*.test.sh` (seven; each must print `ALL CASES PASS`) |
   | `.claude/workflows/explorer-review.js` | `.claude/workflows/explorer-review.test.sh` (`ALL CASES PASS`) |
   | `scripts/*.sh` | the script's `.test.sh` (`ALL CASES PASS`) and a run of the script itself on the real tree |
   | contract/config/doc text only (`context/**`, `*.md`, and `.claude/**` paths no row above matches) | no executable surface - record gates 3-4 as N/A and say why |
   | `src/ServiceBusExplorer.Core/Providers/**` or any broker, management-API or emulator call | add `dotnet test src/ServiceBusExplorer.IntegrationTests` (Docker); only then |
   | `web-app/**` with a visible change | add `npx playwright test -c e2e` in `web-app/`, once, at the end |

   The surface runs **once, at the end** of the lane and again only after a fix that touched code;
   never after each edit. The 8 skips in `metrics.service.spec.ts` are the only skips allowed; a
   new one fails the gate. Test counts are not written into the context; CI shows them.
5. **Prove the requirement, in proportion to the risk.** The implementer proves the map inside its
   own run and reports the evidence; the manager checks it. A **mutation proof is required only**
   for an entry under Rules A, F, G, H or I, or a new guard ([[pages/invariants/a-guard-must-be-able-to-fire]]):
   the API boundary, provider boundaries, secrets, message safety, an external call. Any other new
   behaviour (screens, layout, wiring, labels, documentation) needs only a failing-first spec that
   asserts what the user sees; a visual refactor needs only the behaviour lock (the existing specs
   and the end-to-end flows green before and after).
   - **`new behaviour`:** for each entry, back up the production file, apply one targeted mutation
     (or revert the rule) that removes exactly the behaviour under test - complete before send,
     return the raw secret, skip the key check, drop a guard - run the mapped test, and quote its
     failure: the test name and the **assertion** message. A compile failure is never proof.
     Restore the file from the backup copy (never `git checkout`, which wipes uncommitted work) and
     rebuild clean.
   - **`mutation proof`:** the same procedure for a brand-new provider or feature; stubbing a whole
     slice proves nothing.
   - **`behaviour lock`:** the named test green before the change and green after it.
   - **`explorer-mechanic`** takes the long runs the implementer should not block on.
   - A missing or incomplete result for any entry blocks the PR.

   The implementer also runs `dotnet-test:test-anti-patterns` and `dotnet-test:assertion-quality`
   over the mapped .NET tests of an A, F, G, H or I entry and quotes both results in its report. The gate output holds the
   unchanged map, each mutation with its quoted failure and restore, the behaviour-lock runs, both
   skill results, and the verdict.
6. **Review gate: one workflow run, the lenses the diff names.** Lenses: `api-surface`, `secrets`,
   `message-safety`, `boundaries`, `invariants`, `performance`. `invariants` always runs;
   `performance` means dispatching `explorer-optimizer` in the same message, mandatory when the diff
   touches a bulk message operation, a peek/search/scan loop, the monitoring background service,
   the RabbitMQ management client, the metrics service or an Angular polling or large-list path.
   The other four come from this table; the manager may add a lens, never drop one the table names:

   | The diff... | adds lens |
   |---|---|
   | adds or changes an endpoint, a middleware, CORS, host filtering, the binding, `Program.cs`, an Electron IPC channel or how the API process is started | `api-surface` |
   | touches a connection string, password, client secret, the API secret, masking, export, import, `workspace.json` handling or a log line near any of them | `secrets` |
   | touches anything that receives, completes, abandons, sends, moves, resubmits or purges messages, in a provider, a controller or the Angular bulk flow | `message-safety` |
   | touches a provider, `IMessagingProvider`, `IProviderCapabilities`, `ProviderFactory`, the Angular provider registry, or any type crossing those abstractions | `boundaries` |

   - **`explorer-reviewer`** (opus on `api-surface`, `secrets` and `message-safety`; sonnet on
     `invariants` and `boundaries`) - run the saved workflow **once per logical change**:
     `Workflow({ name: "explorer-review", args: { module: "<project>", lenses: [<the lenses
     above>], dispatch: "<the reviewer template below, filled>" } })`. It dispatches one
     `explorer-reviewer` per lens in parallel, then has an independent reviewer try to refute every
     finding, and returns `{ confirmed, refuted, unresolved, unresolvedLenses, checked, uncited }`;
     a finding whose refuter returned nothing is `unresolved`, never counted as refuted, and blocks
     like a confirmed one until the manager verifies it; a lens whose review returned nothing is
     named in `unresolvedLenses` and blocks until that lens is run again and returns. The reviewer
     checks the evidence the dispatch carries; it never rebuilds the map or reruns the proofs. If
     the Workflow tool is unavailable, dispatch `explorer-reviewer` directly with the same
     template. **Budget: one fix-and-review round**; a second only for a confirmed P1, and a third
     means the change is not understood - stop and hand the rest to the owner.
   - **`/code-review`** runs only when the diff touches `Program.cs`, `IMessagingProvider` or the
     owner asks; always `medium`, never `--fix`.
   - **Receiving a batch:** before applying any finding, verify it against the code the way
     `superpowers:receiving-code-review` prescribes. Apply the `confirmed` findings, verify every
     `unresolved` one yourself and apply it unless the code refutes it, record the `refuted` ones
     with the reason in the dispatch report, then re-gate.
7. **Crystallize.** The implementer has written the context pages the plan named; the manager reviews
   that context diff, owns `index.md`, `log.md`, the conventions and process ADRs, and uses
   `wiki-crystallize` for anything the session found beyond the plan. A change that closes a
   "Known gaps" entry removes it from the project page and from `pages/roadmap/followups.md` in the
   same commit. **7b.** Run `wiki-lint` when the context changed; it does not check code
   citations, so also run `bash scripts/check-context-refs.sh` on every lane that touched `src/`,
   `web-app/` or `context/` and fix every ref it reports. Then read every ref you rewrote. A page
   over 300 lines that is not a tracker fails the gate.
8. **The PR body** uses `.github/PULL_REQUEST_TEMPLATE.md`, ticks the three safety boxes (API
   surface, secrets, message safety) only after the matching lens (or the plan's statement that the
   change touches none) says so, and carries the line `Review: applied N, rejected M` (findings of
   gate 6, after verification).
9. **STOP at the commit message** - one conventional commit message in a code block. Rule E: never
   commit unless the owner asked; when asked, commits go on a `feat/ fix/ chore/ docs/` branch and
   land on `main` only through a PR; never an AI attribution line in a commit or a PR.

## Dispatch templates

Implementer dispatch (copy, fill, send verbatim):

```text
Project: <ServiceBusExplorer.Core | ServiceBusExplorer.Api | web-app | electron-shell>   Worktree: <path>   Lane: feature | bugfix | refactor
1. Files      EDIT: <paths, incl. context pages>   CONTEXT: <paths>
2. Steps      <ordered, Rule B shape, test class or spec per step>
3. Invariants <context page -> pinning test>
   API surface: <none | endpoint/middleware/IPC>   Secret: <none | field, masked where>   Messages: <none | operation, order>
4. Acceptance <literal commands>
5. Out of scope <...>
6. Map        <requirement (user's words)> -> <test path::name> [new behaviour | behaviour lock | mutation proof]
Report: files + reason, map with landed test, gate output verbatim, per entry the mutation, quoted
failure, restore and rebuild (or green before/after), departures from the plan, open questions.
```

Reviewer dispatch (the `dispatch` arg of the `explorer-review` workflow):

```text
Project: <project>   Diff: working tree of <worktree> (or <range>)
Lenses: invariants[, api-surface][, secrets][, message-safety][, boundaries]   (from the gate 6 table; name the row)
Map: <entries with kind>
Gate 5 evidence: <per entry: mutation, quoted failure, restore; behaviour-lock runs>
Skill results (from the implementer's report): test-anti-patterns <...>; assertion-quality <...>
Check this evidence; do not rebuild it. Findings: CONFIRMED with file:line and the rule or page.
```

## Token rules

- The cheapest tokens are the ones a smaller diff never spends - step 1b is the biggest lever.
- Don't re-run a gate on an unchanged diff; reuse session findings.
- Surveys past a handful of targeted reads go to `Explore`. Long runs go to `explorer-mechanic`
  with literal commands; it never fixes.
- The manager edits only context, docs, `.claude/**` and fast-path one-liners; simple well-specified
  changes go to a `sonnet` agent instead of `explorer-implementer`.
- At most two heavy lanes at once (a lane that starts Docker brokers or the end-to-end suite): more
  overloads the owner's machine and every suite slows down or times out.
- Code is cited by name in the context (`path#Member`), never by line number, so an edit does not
  send anyone back to re-point citations.
