---
title: "Conventions"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the entries of this area moved out of the context index"
page_type: index
status: active
description: "The pages of the conventions area, one line each."
source:
  - context/index.md
reliability: high
---

# Conventions

Tooling, testing, the user interface, and decisions that look like defects.

- [[pages/conventions/tooling|Tooling]] - Model routing, the agents, the pipeline skill, the rules files, the review workflow, what the build does not enforce.
- [[pages/conventions/hooks-and-checks|Hooks and checks]] - What each hook does, the scripts under `tools/`, and what the harness job of CI runs.
- [[pages/conventions/ui|User interface]] - One design system: Material components and theme tokens, one icon set, named destructive actions, three distinct states, a name on every control; and where the app stands against that today.
- [[pages/conventions/testing|Testing]] - The stacks, the commands, the state at the founding, why web tests run only through `ng test`, what has no test.
- [[pages/conventions/decisions-that-look-like-defects|Decisions that look like defects]] - Intended behaviour that reads as a bug, with the test that locks it.
