# CLAUDE.md - Messaging Explorer

Loaded into every session in this repo, for me, for every subagent I spawn, and for anyone pairing with Claude here. One source per rule: this file carries the snapshot, the standard, the ten team rules and pointers. It never restates what the pipeline skill, the tooling page or the vault already say.

## Read first

- **Vault:** [`vault/index.md`](./vault/index.md), then `vault/pages/services/<project>.md`, the invariants it links, the relevant ADRs. Vault first, source last. Operation contract: @vault/CLAUDE.md
- **Pipeline:** every code task, however small, routes through the `explorer-pipeline` skill before the first edit. It classifies the task, takes the fast path for trivial edits, and walks the gates (plan, Rule B, build, test surface, prove the requirement, review, crystallize, PR body, stop at the commit message).
- **Who does what, on which model, with which tools:** `vault/pages/conventions/tooling.md` (routing table, agents under `.claude/agents/`, hooks, scripts, the review workflow).
- **.NET mechanics:** [`AGENTS.md`](./AGENTS.md) maps tasks to the installed `dotnet/skills` plugins.

## Project snapshot

- **What:** open-source (MIT) desktop and web tool to explore and manage messaging brokers: Azure Service Bus and RabbitMQ. It lists and creates queues, topics, subscriptions and exchanges, peeks, sends, receives, resubmits, moves, deletes and purges messages, including dead-letter queues, on brokers that are usually someone's production.
- **Stack:** .NET 10 (`ServiceBusExplorer.slnx`), ASP.NET Core API, `Azure.Messaging.ServiceBus`, `Azure.Identity`, `RabbitMQ.Client`; Angular 21 with Angular Material and ng-bootstrap; Electron 41 with `electron-builder` and `electron-updater`; npm.
- **Projects:** `src/ServiceBusExplorer.Core` (provider abstraction, the two providers, workspace storage, metrics), `src/ServiceBusExplorer.Api` (controllers, key middleware, monitoring), their test projects `src/ServiceBusExplorer.Core.Tests` and `src/ServiceBusExplorer.Api.Tests` (under `src/`, not `tests/`), `web-app/` (Angular app, `web-app/electron/` shell), `docs/` (the GitHub Pages site). `vault/pages/architecture/project-map.md`.
- **Runtime shape:** the Electron main process generates an API secret per launch, starts the API as a child process on loopback and hands the secret to the renderer over IPC; every HTTP call carries it as `X-Api-Key`. One active broker connection per API process.
- **Storage:** connections and groups in one `workspace.json` under the data path, secrets in plain text on disk; `vault/pages/services/core.md`.
- **Tests:** xUnit with Moq and plain `Assert`; `dotnet test` per test project. Web: vitest through the Angular builder, `npm test -- --watch=false` in `web-app/` (never plain `npx vitest`, which has no Angular compiler). `vault/pages/conventions/testing.md`.
- **CI:** `.github/workflows/ci.yml` (harness self-tests, .NET build and test, web build; no web tests, no lint) and `release.yml` (tag-driven packaging for three OSes, unsigned).

## The standard

Correct, tested, clean, and **safe to point at a production broker**. Three things are never "harden later": nobody but the local user reaches the API (Rule A), a secret never leaves the backend unmasked or reaches a log (Rule G), and a bulk operation never loses a message silently (Rule H). The code does not meet all three everywhere today; each known breach is written down with its citation under "Known gaps" on the service pages and in `vault/pages/roadmap/followups.md`. A change may leave a recorded gap as it found it; it may never add one, and it may never widen one.

## Team rules

The letters are stable; hooks, skills and the vault reference them by letter. B to E and J are general working rules; A and F to I are specific to this product.

- **A - Local, authenticated API.** The API listens on loopback only, filters the Host header, restricts CORS to the configured front end, and refuses every request without the per-launch `X-Api-Key` compared in fixed time; `/health` is the one exemption. The Angular app reaches it only through `ApiService`. `vault/pages/invariants/local-authenticated-api.md`.
- **B - Edit, test, validate, per edit.** Every edit ships with a test that fails without it and asserts the requirement in the words the request used; a refactor names behaviour-lock tests green before and after. Then `dotnet build ServiceBusExplorer.slnx` at 0 warnings (read the summary line; nothing fails the build on a warning), the test surface of the pipeline's gate 4, and for `web-app/**` `npm test -- --watch=false` and `npm run build`. `vault/pages/conventions/testing.md`.
- **C - No premature abstraction.** One concrete user means no generic, base class or helper; three similar lines beat a speculative abstraction. A documented abstraction (the provider interface, capabilities, the factory) is not premature.
- **D - Verify before citing.** Read the file, class or convention before recommending it; nothing here is stable enough to quote from memory. `docs/ADDING_PROVIDERS.md` describes a flow the code does not fully run; the service pages say which parts.
- **E - Claude never commits by default.** No history-writing git, no `gh pr`, no release, no publish, unless the owner asks for that action; a batch authorisation in words covers one session's commits and PRs on a `feat/ fix/ chore/ docs/` branch and never a push to `main`. Every change lands on `main` through a PR. **Never an AI attribution line** (`Co-Authored-By`, "Generated with") in a commit, a PR or a source file. The `pre-git-guard` hook turns these into a permission ask.
- **F - Provider boundaries.** A broker is reached through `IMessagingProvider`; what a provider cannot do is declared in `IProviderCapabilities`, never a silent no-op. `Azure.*` and `RabbitMQ.Client` types stay inside `src/ServiceBusExplorer.Core/Providers/<Provider>/`; controllers, models, abstractions and the Angular app never name one. `vault/pages/invariants/provider-boundaries.md`.
- **G - Secrets masked, never logged.** A connection string, a password, a client secret and the API secret leave the backend only as the mask, except on an export the user asked for with secrets; the mask never overwrites a stored secret; nothing logs or echoes one. A new secret field is added to the mask, to the merge on save and import, and to a masking test, in one change. `vault/pages/invariants/secrets-masked-at-the-api-boundary.md`.
- **H - A bulk operation never loses a message silently.** Send first, complete after; a message that was sent and could not be removed from its source is reported as a possible duplicate, never resent in silence; every failure is reported per sequence number; scans are bounded; the caller's `CancellationToken` stops the batch. Operations are at-least-once, and the UI says so. `vault/pages/invariants/bulk-operations-are-at-least-once.md`.
- **I - One failing-call test per external boundary.** A change that adds or alters a call to a broker SDK, the RabbitMQ management API, Azure Monitor, the filesystem or a subprocess ships one test where that call fails (timeout, 5xx, a broker exception) and asserts what the caller does. `vault/pages/conventions/testing.md`.
- **J - Documentation lives in the vault.** English only, no emojis, no AI-attribution comments or headers. A `<summary>` on a public type or member is fine; no narration inside a member, no reference to an ADR, a page or an issue in code; the one exception is a `ponytail:` deferral line. `README.md` stays at install, run, test and a link.

Also mandatory: identifiers and comments in English; never run a destructive operation (receive, purge, delete, move, resubmit) against a broker the owner did not name for that purpose; no real namespaces, hosts, connection strings or ids from the owner's environment in code, tests, vault or commits.

## When working here

- Announce classification and the skills in play before the first edit; the `explorer-pipeline` skill says how.
- One git worktree per concurrent piece of work; an agent never edits the owner's checkout while the owner has uncommitted work in the same files.
- After a session with new findings: `/wiki-crystallize`, and one line at the top of `vault/log.md`.
- Prefer editing an existing file over creating one; no planning or analysis markdown outside the vault. The owner's private notes stay in the Obsidian vault at `~/WorkSpace/obsidian-vault/explorer-messages/`; nothing from there is copied here without the owner's word, because this repo is public.
