---
title: "ADR 0004 - The in-repo documentation folder is named context"
version: "1.0"
date: 2026-11-13
changes: "Initial decision"
page_type: adr
status: accepted
description: "The folder that holds the project's documentation, the agent operation contract and the prototype is named context/, not vault/; the decision of ADR 0001 to keep that documentation in the repository is unchanged."
updated: 2026-11-13
source:
  - "chat: the owner's request of 2026-11-13"
  - "[[pages/decisions/0001-in-repo-vault-and-agent-harness]]"
reliability: high
---

# ADR 0004 - The in-repo documentation folder is named context

## Status

Accepted by the owner on 2026-11-13. Amends the folder name chosen by [[pages/decisions/0001-in-repo-vault-and-agent-harness]]; everything else that ADR decided stands.

## Context

ADR 0001 put the documentation and the agent harness in the repository, in a folder named `vault/`. The owner asked on 2026-11-13 for the folder to be named `context/`: it is the context every session, agent and contributor reads before touching the code, and "vault" is also the name of the owner's private Obsidian notes, which stay outside this public repository.

## Decision

- The folder is `context/`. Its layout (`pages/`, `index.md`, `log.md`, `CLAUDE.md`, `prototypes/`, `templates/`, `raw/`, `ingested/`, `archive/`) is unchanged.
- The citation checker is `tools/checks/check-context-refs.sh`, with its self-test `tools/checks/check-context-refs.test.sh`.
- Root `CLAUDE.md`, `AGENTS.md`, the README, the harness under `.claude/`, CI and `.gitattributes` point at `context/`.
- Records keep their words: the entries of `context/log.md` written before the rename, the file name and text of ADR 0001, and `ingested/`, `archive/` and `raw/` still say `vault`. A citation inside them may name the old path.
- The generic wiki skills under `.claude/skills/wiki-*` keep the word "vault" where it means any notes folder; only their paths changed.

## Consequences

- An open branch that edits files under `vault/` merges into `context/` through git's rename detection; a file it adds under `vault/` must be moved by hand.
- Wikilinks are relative to the folder (`[[pages/...]]`) and did not change.
