# AGENTS.md - .NET skills & agents routing (Messaging Explorer)

Referenced from `CLAUDE.md`. This file maps **tasks to the official [`dotnet/skills`](https://github.com/dotnet/skills) plugins** (marketplace `dotnet-agent-skills`, .NET Team at Microsoft). It does **not** change the context-first workflow: the context is the source of truth for *what this codebase is and why*; these skills are the source of truth for *how to do a .NET task well*.

> **Verified 2026-11-12 against the skills listed in a session on the owner's machine.** Installed: **`dotnet`**, **`dotnet-test`**, **`dotnet-diag`**. Every row below is tagged **[installed]** or **[needs install]**; a `[needs install]` skill cannot be invoked until someone runs `/plugin install <plugin>@dotnet-agent-skills`, and reasoning from pretraining because "the table said so" is exactly the failure Rule D exists for. Re-check with `jq -r '.plugins | keys[] | select(test("dotnet"))' ~/.claude/plugins/installed_plugins.json`.

## Order of operations

1. **Context first.** `context/index.md`, then `context/pages/services/<project>.md`, then the linked `context/pages/invariants/*`, `decisions/*`, `conventions/*`.
2. **Then a skill/agent from the table below** for the .NET mechanics; invoke by name, do not reason from pretraining when a skill covers the task.
3. **Then grep source** only if context + skill leave a gap.
4. **Crystallize** new findings back with `/wiki-crystallize`.

This file is consulted from inside the `explorer-pipeline` skill: it is what "scans (diff-gated)" in each lane resolves against. A scan whose surface the diff does not touch does not run. How tests prove the requirement is gate 5 of `.claude/skills/explorer-pipeline/SKILL.md`; the review lenses are gate 6.

## How to invoke

- **Skill**: `Skill` tool with `skill: "<plugin>:<skill>"`, e.g. `dotnet-test:run-tests`.
- **Agent**: `Agent` tool with `subagent_type: "<plugin>:<agent>"`, e.g. `dotnet-test:test-quality-auditor`. Agents are multi-step orchestrators; use them for large sweeps, not single-file edits.
- **LSP (Roslyn)**: the installed `dotnet` plugin registers a C# language server for `.cs`. Prefer LSP find-refs over blind grep for symbol work. This repo has no `global.json`; the SDK on PATH must be .NET 10.

## Tier 1 - Primary (use routinely on this repo)

| Task | Skill / Agent | Notes for Messaging Explorer |
|---|---|---|
| Navigate/rename/diagnose C# across the solution | `dotnet` **LSP** (auto) **[installed]** | Solution is `ServiceBusExplorer.slnx`. |
| Run / filter .NET tests, read pass-fail | `dotnet-test:run-tests` **[installed]** | Respects Rule B. Surface per `explorer-pipeline` SKILL.md gate 4: a Core edit runs both test projects. Report the skipped count per project. |
| Write tests for untested code | `dotnet-test:code-testing-agent` **[installed]** | Most controllers and the RabbitMQ provider have none; `context/pages/conventions/testing.md`. xUnit + Moq, plain `Assert`. |
| Which sources have no tests | `dotnet-test:find-untested-sources` **[installed]** | |
| Coverage plateau / where to add tests | `dotnet-test:coverage-analysis`, `dotnet-test:test-gap-analysis` **[installed]** | `coverlet.collector` is referenced by both test projects. |
| Test-quality smells / weak asserts / over-mocking | `dotnet-test:test-anti-patterns`, `dotnet-test:test-smell-detection`, `dotnet-test:assertion-quality`, `dotnet-test:grade-tests` **[installed]** | Gate 5 runs the first and third over every mapped test path. |
| Risk score for complex code under test | `dotnet-test:crap-score` **[installed]** | The Azure provider is the first candidate. |
| Broad test-suite health audit | Agent `dotnet-test:test-quality-auditor` **[installed]** | |
| Make code testable (static state, `TimeProvider`, `IFileSystem`) | Agent `dotnet-test:testability-migration`, `dotnet-test:testability-obstacle` **[installed]** | The static provider slot in `ConnectionsController` is the known obstacle. |
| Behaviour-preserving C# refactor | `dotnet:csharp-refactoring` **[installed]** | Inside the refactor lane only. |
| Hot-path perf, allocations, async traps; benchmarks | `dotnet-diag:analyzing-dotnet-performance`, `dotnet-diag:microbenchmarking`, agent `dotnet-diag:optimizing-dotnet-performance` **[installed]** | The `performance` lens: `explorer-optimizer` runs `analyzing-dotnet-performance` over the changed files first. |
| Hang / leak / crash triage | `dotnet-diag:dotnet-trace-collect`, `dotnet-diag:dump-collect` **[installed]** | |
| Build fails opaquely | `dotnet:msbuild` **[installed]** | |
| Pin/install a .NET SDK locally | `dotnet:setup-local-sdk` **[installed]** | |

## Not applicable to this repo

- `dotnet-blazor:*`, `dotnet-maui:*`: the UI is Angular + Electron under `web-app/`, driven by npm.
- `dotnet-data:*`: no EF Core or database; storage is one JSON file.
- `dotnet-test:writing-mstest-tests`, `dotnet-test:mtp-hot-reload`: the test projects are xUnit on VSTest.
