---
paths:
  - "**/*.cs"
  - "**/*.csproj"
  - "ServiceBusExplorer.slnx"
---

# .NET skills for this repo

The `dotnet/skills` plugins (marketplace `dotnet-agent-skills`) say how to do a .NET task well.
When one covers the task, use it by name. This repo uses three of them: `dotnet`, `dotnet-test`
and `dotnet-diag`. A plugin may not be installed on this machine: check with
`jq -r '.plugins | keys[] | select(test("dotnet"))' ~/.claude/plugins/installed_plugins.json`.

| Task | Skill or agent | In this repo |
|---|---|---|
| Navigate/rename/diagnose C# across the solution | The C# language server the `dotnet` plugin registers | Solution is `ServiceBusExplorer.slnx`. |
| Run / filter .NET tests, read pass-fail | `dotnet-test:run-tests` | Through `tools/checks/in-docker.sh`. A Core edit runs both test projects (`reference/test-surface.md` of the pipeline skill). Report the skipped count per project. |
| Write tests for untested code | `dotnet-test:code-testing-agent` | Most controllers and the RabbitMQ provider have none; `context/pages/conventions/testing.md`. xUnit + Moq, plain `Assert`. |
| Which sources have no tests | `dotnet-test:find-untested-sources` |  |
| Coverage plateau / where to add tests | `dotnet-test:coverage-analysis`, `dotnet-test:test-gap-analysis` | `coverlet.collector` is referenced by both test projects. |
| Test-quality smells / weak asserts / over-mocking | `dotnet-test:test-anti-patterns`, `dotnet-test:test-smell-detection`, `dotnet-test:assertion-quality`, `dotnet-test:grade-tests` | The implementer runs the first and third on every test of the requirement table. |
| Risk score for complex code under test | `dotnet-test:crap-score` | The Azure provider is the first candidate. |
| Broad test-suite health audit | Agent `dotnet-test:test-quality-auditor` |  |
| Make code testable (static state, `TimeProvider`, `IFileSystem`) | Agent `dotnet-test:testability-migration`, `dotnet-test:testability-obstacle` | The static provider slot in `ConnectionsController` is the known obstacle. |
| Behaviour-preserving C# refactor | `dotnet:csharp-refactoring` | Inside the refactor lane only. |
| Hot-path perf, allocations, async traps; benchmarks | `dotnet-diag:analyzing-dotnet-performance`, `dotnet-diag:microbenchmarking`, agent `dotnet-diag:optimizing-dotnet-performance` | `explorer-optimizer` runs `analyzing-dotnet-performance` on the changed files first. |
| Hang / leak / crash triage | `dotnet-diag:dotnet-trace-collect`, `dotnet-diag:dump-collect` |  |
| Build fails opaquely | `dotnet:msbuild` |  |
| Pin/install a .NET SDK locally | `dotnet:setup-local-sdk` |  |

Tests here are xUnit with Moq and plain `Assert`. There is no `global.json`: the SDK on the path
must be .NET 10. A skill or an agent is for the mechanics; what this codebase is and why is in
`context/`.

Not for this repo: `dotnet-blazor`, `dotnet-maui` (the UI is Angular and Electron under
`web-app/`, driven by npm); `dotnet-data` (no database: storage is one JSON file);
`dotnet-test:writing-mstest-tests` and `dotnet-test:mtp-hot-reload` (the tests are xUnit on VSTest).
