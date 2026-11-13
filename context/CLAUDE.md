# Context Operation Schema

This file is the operation contract for Claude when working on this wiki. It is **project-agnostic** — it defines HOW Claude operates on the context, not WHAT this project is. Project-specific content lives in `pages/`.

Read this file at session start (or rely on the root-repo `CLAUDE.md` to auto-include it). Follow it verbatim unless the user overrides.

---

## Three-layer model

```
raw/          immutable user-curated sources (Claude reads, never edits)
pages/        LLM-maintained wiki (Claude writes, user reviews)
wiki-*.md     skill config + schema (Claude obeys, user rarely edits)
index.md      content catalog (Claude maintains)
log.md        append-only chronological log (Claude appends)
```

## Session start protocol

On every session, before any code grep or file read:

1. Read `index.md`.
2. Classify the user's task:
   - **Feature** — net-new capability or endpoint.
   - **Bug fix** — correcting existing behavior.
   - **Refactor** — restructuring without behavior change.
   - **Investigation** — answering a question about the codebase.
   - **Lint** — health-checking the context itself.
3. Route via the table below.
4. Read every routed page before proposing or coding anything.
5. Only after the context is exhausted, grep source.

## Task routing

| Task | Pages Claude reads first | Follow-up |
|---|---|---|
| **Feature** | `pages/services/<affected>.md` → linked `pages/invariants/*` → `pages/decisions/*` related → `pages/conventions/*` | Propose design; cross-check against invariants; draft tests referenced in service page; then `/wiki-integrate` the new page |
| **Bug fix** | `pages/services/<affected>.md` → `pages/invariants/*` touching the bug surface → `pages/incidents/*` for similar past issues | Check if bug violates a documented invariant — if so, that's the fix target |
| **Refactor** | `pages/services/<affected>.md` → `pages/decisions/*` that established the current shape → `pages/conventions/*` | If the refactor contradicts an ADR, draft a superseding ADR first |
| **Investigation** | `pages/overview/*` → `index.md` → targeted pages | Answer with citations `[[pages/...]]` |
| **Lint** | all of `pages/`, `index.md`, `log.md` | Run `/wiki-lint` skill |
| **New ADR** | relevant `pages/services/*` and `pages/invariants/*` | Copy `templates/_adr.md`, increment ADR number, link to superseded ADR if any; then `/wiki-integrate` the new page |
| **New invariant** | affected `pages/services/*` | Copy `templates/_invariant.md`, cite the enforcement points and tests by name (`path#Member`); then `/wiki-integrate` the new page |

## Page conventions

All pages use the schema in `wiki-schema.md`. Mandatory frontmatter: `title`, `version`, `date`, `changes`, `page_type`.

**Version on list-shaped trackers.** On a tracker (the pages under `pages/roadmap/`) `version` is bumped only when the page's *shape* changes (a section added, split or removed), never when an entry is added, edited or moved; `changes` names the last structural change, and each entry carries its own date. A per-entry bump made every concurrent branch conflict on the same frontmatter line.

**Where a page goes.** A service page states how the project works now; what changed when goes to `pages/history/<project>.md`. Follow-ups go to a tracker page under `pages/roadmap/` (create `pages/roadmap/followups.md` from `templates/_roadmap-initiative.md` on first use).

Two personal-wiki defaults this context uses beyond `knowledge`:
- `longform` — a linear authored document (spec, architecture brief, design doc), typically under `pages/architecture/`.
- `established-patterns` — a memory record of what was decided, what worked and what was rejected, under `pages/conventions/`.

Extended `page_type` values (engineering additions):
- `service` — a page under `pages/services/`, one per project of `pages/architecture/project-map`: the two `src/` projects, the Angular app and the Electron shell.
- `adr` — an Architecture Decision Record under `pages/decisions/`. Filename format `NNNN-<slug>.md`.
- `invariant` — a rule the code must preserve, under `pages/invariants/`.
- `incident` — a per-incident page under `pages/incidents/`.
- `runbook` — an operational procedure under `pages/runbooks/`.
- `roadmap` — an initiative or backlog page under `pages/roadmap/`.
- `convention` — a coding/testing/db convention under `pages/conventions/`.

## Operations

### Ingest

Trigger: user drops a file directly in `raw/` and invokes `/wiki-ingest`. The skill scans `raw/` flat and does not look inside its subdirectories; the `raw/<kind>/` folders exist as a manual sorting aid only.

Claude:
1. Reads the source.
2. Classifies it into one of the `ingested_subdirs` and identifies affected pages (create or update).
3. Writes/updates pages. Adds `source: [ingested/<kind>/...]` frontmatter on created pages; a source link never points into `raw/`.
4. Updates `index.md` with any new pages.
5. Moves the source from `raw/` to `ingested/<kind>/` atomically.
6. Appends a log entry: `## [YYYY-MM-DD] ingest | <title>`.

A `knowledge`, `research-note` or `survey` page created from a single medium- or low-reliability source carries a `## Pending Review` section until a stronger source is ingested; it is a quality signal, not a cleanup item. Engineering page types never get that section; their `reliability:` field is the only trust signal.

A single source typically touches 5–15 pages.

### Query

Trigger: user asks a question about the project.

Claude:
1. Reads `index.md`.
2. Reads any directly-named pages + wikilinked pages up to 2 hops.
3. Synthesizes answer with `[[page]]` citations.
4. If the answer is valuable (novel synthesis, comparison, decision rationale), offers to file it via `/wiki-crystallize`.
5. Appends a log entry: `## [YYYY-MM-DD] query | <short question>`.

### Integrate

Trigger: user invokes `/wiki-integrate <page>` after a page is created or substantially rewritten. Mandatory for every new page under `pages/`.

Claude:
1. Reads the target page and checks it is not in a blacklisted folder.
2. Adds or updates the page's entry in `index.md`.
3. Finds related pages and adds backlinks from them to the target.
4. Appends a log entry: `## [YYYY-MM-DD] integrate | <page title>`.

### Lint

Trigger: user invokes `/wiki-lint` or periodically.

Claude checks:
- **Broken wikilinks** — `[[page]]` references that resolve to nothing.
- **Orphans** — pages under `pages/` with no inbound links.
- **Stale claims** — pages last `updated:` >90 days ago that reference files/lines; verify paths still exist.
- **Missing cross-references** — a service page mentions a concept that has its own domain page but doesn't link it.
- **Frontmatter violations** — missing mandatory fields, invalid enum values.
- **Drift** — `path#Member` code citations whose file or name no longer exists (`scripts/check-context-refs.sh`).

Report findings; don't auto-fix without confirmation.

### Crystallize

Trigger: user invokes `/wiki-crystallize` at the end of a working session.

Claude:
1. Reviews the session transcript.
2. Identifies new facts, decisions, invariants, or surprises worth persisting.
3. Proposes new pages or updates to existing ones.
4. On confirmation, writes with `source: [chat]` or `source: [raw/...]` as appropriate.
5. Increments `crystallize_count` frontmatter.

## Rules for Claude

0. **This context covers the whole repo.** Messaging Explorer is one repo: the .NET API and Core
   library under `src/`, the Angular app and the Electron shell under `web-app/`, the site under
   `docs/`. Pages here cover all of it. The owner's private notes (plans, handoffs, sessions,
   audits) live in the Obsidian vault outside this repo and are never copied here, because this
   repo is public.
1. **Never write to `raw/`.** Claude reads raw, writes pages, moves raw → ingested during ingest.
2. **Every page has `source:` frontmatter** pointing to where its content came from (raw file, chat, or another page).
3. **Cite code by name, never by line number, and never invent a citation.** A citation is `path#anchor`, where the anchor is a member, a type, a test title or a key that occurs in the file. If Claude can't verify it, it says so; it does not guess.
4. **Invariants are load-bearing.** Before proposing any code change, cross-check against `pages/invariants/*` linked from the affected service page. A change that violates an invariant needs either the change to be revised OR a superseding ADR that removes the invariant.
5. **One page per topic.** If a page exceeds ~300 lines, split it. **Exemption:** list-shaped trackers and manifests under `pages/roadmap/` may exceed the limit — splitting a single prioritized list destroys its value; prune closed entries instead.
6. **Wikilinks over "see also" lists.** Inline links build the graph; bottom-of-page link dumps decay.
7. **Frontmatter is skill territory, body is human territory.** Skills overwrite known frontmatter fields; they never delete human prose.
8. **Append-only `log.md`.** New entries at the top. Format: `## [YYYY-MM-DD] <op> | <title>`. `log.md` carries `merge=union` in `.gitattributes`, so concurrent branches merge without conflicts; never reorder or dedupe entries by hand during a merge, and every entry needs a body line (an empty heading is a lint failure).

## When in doubt

- **The wiki doesn't have an answer to a user question** → say so, grep source, then `/wiki-crystallize` the findings at the end.
- **Two pages contradict each other** → surface the contradiction, ask the user to arbitrate, file an ADR for the resolution.
- **A user asks a question that crosses many pages** → answer by citing the pages; then offer to file the synthesis as a new page.
- **A proposed change would touch 10+ pages** → propose the change set as a dry-run first; apply after confirmation.

## Do not

- Do not write project content without a source. The first sentence of any page must be backable by a citation.
- Do not deep-link to code as the only form of evidence; link to the invariant/ADR/convention page that governs the code.
- Do not rewrite history. Supersede; don't edit-over.
- Do not add skills or tools without documenting them in `pages/conventions/tooling.md`.
