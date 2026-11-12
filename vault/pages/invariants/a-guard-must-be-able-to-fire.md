---
title: "A guard must be able to fire"
version: "1.0"
date: 2026-11-12
changes: "Founded from the code on 2026-11-12"
page_type: invariant
status: active
description: "Every check that rejects an input has an input that reaches it and a test that supplies one; a check the code before it makes unreachable is a defect, and a failed operation never answers as if it worked."
updated: 2026-11-12
enforced_by:
  - ".claude/agents/explorer-reviewer.md"
verified_by:
  - "src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs:12"
source:
  - chat
  - ".claude/agents/explorer-reviewer.md"
reliability: medium
---

# A guard must be able to fire

> Every check that rejects an input has an input that reaches it and a test that supplies one. A check the surrounding code makes unreachable is worse than no check: it reads as protection, it passes review, and the case it was written for takes the unhandled path. The sibling rule: an operation that failed never answers as if it worked.

## Why this exists

The founding survey of 2026-11-12 found both shapes in this repo, in code that reads as careful:

- **A fallback that could not fire.** The Electron shell sent SIGTERM to the API and scheduled a SIGKILL guarded by `!apiProcess.killed`, which is already true once the first signal was sent. Fixed on 2026-11-12: the guard now asks whether the child has exited (`web-app/electron/shell-helpers.js:58`), and a test supplies a child that has not. Whether the timer survives a real quit is still open ([[pages/services/electron-shell]]).
- **Guards nobody has seen fire.** The `API_SECRET` fail-fast, the Host filter and the loopback binding have no test whose input reaches them ([[pages/invariants/local-authenticated-api]]).
- **A failure answered as success.** Until 2026-11-12 an unreadable `workspace.json` was read as an empty workspace, and the next save overwrote it; it now throws (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:246`), and `clear-all` is the way back: a test puts a corrupt file on disk and checks the reset answers 200 (`src/ServiceBusExplorer.Api.Tests/ClearAllTests.cs:13`). Still open: the single-message resubmit returns normally when it cannot find the original again; a RabbitMQ search returns an empty result where the provider cannot search ([[pages/services/core]]).

## Scope

- **Applies to:** every validation, precondition and error branch in `src/**` and `web-app/**`; every review of a diff by `explorer-reviewer`.
- **Does not cover:** a defensive check for a case the types already prevent. That is work that buys nothing; the fix is to remove it, not to test it.

## The rule

1. A new guard ships with the test whose input makes it fire and that asserts the outcome the guard promises (`src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs:12` is the shape: no key, 401).
2. Whether a guard can fire is settled by that test, not by reading the guard.
3. A method that could not do what it was asked throws or returns a result that says so. An empty list, a `false` or a silent return is allowed only when the caller can tell it apart from "nothing to do".
4. Behaviour that looks like a breach and is intended goes to [[pages/conventions/decisions-that-look-like-defects]] with the test that locks it.

## Where it's enforced

- `.claude/agents/explorer-reviewer.md` - the `invariants` lens names this page; a new guard with no firing test is a finding.

## Change protocol

None; this rule has no exception to supersede. A guard that cannot be tested is the finding.
