---
# Wiki Page Schema v1.0 — Engineering Variant
# Read by all wiki skills on boot to know what fields pages use.

schema_version: "1.0"

# Mandatory fields - every wiki page must have these
mandatory_fields:
  title: string
  version: string
  date: date          # YYYY-MM-DD
  changes: string     # quoted, <80 chars, no paths
  page_type: enum     # see enums below

# Conditional fields - written when context applies
conditional_fields:
  updated: date                    # any skill touch, YYYY-MM-DD
  status: enum                     # default: active
  description: string              # ~200 chars, quoted
  crystallize_count: integer       # wiki-crystallize only, starts at 1
  source: list                     # always a list, even for single origin
  reliability: enum                # only meaningful when source present
  supersedes: string               # ADR / decision ID this page replaces
  superseded_by: string            # ADR / decision ID that replaces this page
  enforced_by: list                # file:line references (invariant pages)
  verified_by: list                # test file:line references (invariant pages)

# Valid enum values
enums:
  page_type:
    # Personal-wiki defaults (retained for compatibility)
    - knowledge        # synthesised knowledge page
    - reference        # factual reference material
    - survey           # overview/survey of a topic area
    - research-note    # in-progress investigation
    - domain-home      # domain anchor page
    - overview         # multi-topic overview
    - home             # top-level hub
    - log              # append-only operational log
    - index            # catalogue/index page
    - config           # configuration document
    - longform         # linear authored document; spec, architecture, design brief
    - established-patterns  # memory record; decisions, what worked, anti-patterns
    # Engineering-variant extensions
    - service          # pages/services/*.md — one per service or bounded context
    - adr              # pages/decisions/NNNN-*.md — accepted architecture decision
    - invariant        # pages/invariants/*.md — rule the code MUST preserve
    - incident         # pages/incidents/*.md — per-incident note
    - runbook          # pages/runbooks/*.md — operational procedure
    - roadmap          # pages/roadmap/*.md — initiative or backlog
    - convention       # pages/conventions/*.md — coding/testing/db rule
  status:
    - active           # current, canonical
    - stub             # placeholder, needs expansion
    - artefact         # kept as historical record
    - archived         # superseded but retained
    - snapshot         # point-in-time capture
    # ADR-specific statuses
    - proposed         # ADR drafted but not accepted
    - accepted         # ADR agreed and in force
    - deprecated       # ADR superseded but retained for context
  reliability:
    - high             # primary source or well-established
    - medium           # secondary source or partial confidence
    - low              # speculative, hearsay, or unverified
---

# Wiki Schema — Engineering Variant

Skills read this file on boot alongside `wiki-config.md`. It defines the frontmatter structure all wiki pages follow.

## Extensions over the personal-wiki default

This schema extends the personal-wiki default (upstream: vanillaflava/llm-wiki-skills v0.5.0) with fields and enum values tuned for software projects:

**New `page_type` values:** `service`, `adr`, `invariant`, `incident`, `runbook`, `roadmap`, `convention`. Two upstream defaults this vault also uses on purpose: `longform` (specs and architecture briefs) and `established-patterns` (the decisions-and-rejections memory record).

**New `status` values:** `proposed`, `accepted`, `deprecated` — used by ADR pages.

**New conditional fields:**
- `supersedes: string` — ID of a page this page replaces (ADRs, decisions).
- `superseded_by: string` — inverse of above.
- `enforced_by: list` — file:line references where an invariant is enforced (for `invariant` pages).
- `verified_by: list` — file:line references to tests that verify an invariant.

All personal-wiki default values are retained for compatibility. If a page needs a type the engineering variant doesn't cover, fall back to `knowledge`.

## How skills use this

When writing any page, skills consult this schema to know:
- Which fields are mandatory
- Which conditional fields apply given context
- Which enum values are valid for constrained fields

Skills that write `page_type` choose the appropriate enum value based on what the page is for, and ask the user when unclear.

## Field semantics

### Mandatory fields

Every page a skill writes must include all five:

| Field | Rule |
|---|---|
| `title:` | Must match the H1 heading exactly. Quote if the value contains a colon. |
| `version:` | Start at 1.0. Increment minor (1.1) for additions, major (2.0) for structural rewrites. On a list-shaped tracker (`pages/roadmap/followups/*`) bump only when the shape changes, never per entry; entries carry their own date. |
| `date:` | Creation date. Set once; never modified by skills on later writes. YYYY-MM-DD only. |
| `changes:` | One sentence. Never a file path. Never an em-dash. Always quoted. On a tracker it names the last structural change. |
| `page_type:` | Controls how skills handle the page. Use values from the `page_type` enum above. |

### Conditional fields (engineering additions)

| Field | Applied to | Rule |
|---|---|---|
| `supersedes:` | ADR, decision | String ID of the replaced ADR, e.g. `"0002-edit-test-validate-cycle"`. On a superseding ADR. |
| `superseded_by:` | ADR, decision | Inverse. Set automatically on the old page when a new ADR supersedes it. |
| `enforced_by:` | invariant | List of `"path/to/file.ext:LINE"` references pointing at the code that enforces the invariant. |
| `verified_by:` | invariant | List of `"path/to/test.ext:LINE"` references pointing at tests that verify it. |

### Conditional fields (personal-wiki defaults, retained)

| Field | Written by | When | Key rules |
|---|---|---|---|
| `updated:` | Any wiki skill on touch | Every skill write | YYYY-MM-DD; last skill contact date. Equals `date:` on creation. |
| `status:` | wiki-ingest on create; any skill on state change | Every page | Default `active`; write `stub` if body is minimal. ADRs progress `proposed → accepted → deprecated`. |
| `description:` | wiki-ingest, wiki-crystallize | Every page | ~200 chars, quoted. |
| `crystallize_count:` | wiki-crystallize only | Every crystallize write | Integer; increments. |
| `source:` | wiki-ingest on create | When page has an ingested origin | Always a list. Example: `["ingested/designs/foo.md"]`. |
| `reliability:` | wiki-ingest on create | Only when `source:` is present | Minimum value across contributing sources. |

### Write discipline

**Frontmatter is skill territory.** Skills overwrite known fields without asking. Humans who edit these values should expect them to be overwritten on the next skill touch.

**Body is human territory.** Skills append and add sections; they never delete human-written prose. Unrecognised frontmatter fields are preserved.

### Anti-patterns

| Anti-pattern | Fix |
|---|---|
| `changes: key: value` (colon-space unquoted) | Quote the `changes:` value |
| Em-dash (`—`) in any field value or title | Use ` - ` (space-hyphen-space) |
| File path in `changes:` | Put paths in body `## Sources` section; `changes:` is short description only |
| `enforced_by:` on a non-invariant page | Move the refs into body; don't reuse invariant-only fields elsewhere |
