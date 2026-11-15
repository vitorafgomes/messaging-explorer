<!-- Fill every section and delete none. One that does not apply says so in words: "Nothing", "None", "Not touched". -->

## :clipboard: Checklist

<!-- Tick what is true. A box left empty is explained under "Not done, and why". -->
- [ ] Commits are atomic and focused
- [ ] This description names every request
- [ ] Tests added or updated; each fails without the change
- [ ] `dotnet build ServiceBusExplorer.slnx` at 0 warnings
- [ ] `dotnet test` green per test project
- [ ] `npm test -- --watch=false` and `npm run build` in `web-app/` (web changes)
- [ ] Code and comments are in English
- [ ] No real namespaces, hosts or credentials committed
- [ ] Context pages updated in the same change (`context/pages/services/`, an ADR for a change to an invariant)

## :gear: What kind of change is this?

<!-- Tick the main kind. -->
- [ ] Bugfix
- [ ] Feature
- [ ] Code style
- [ ] Refactoring, no functional change
- [ ] Build
- [ ] Documentation
- [ ] Tests
- [ ] Other (describe)

## :dart: What was asked

<!-- One line per request: its number, what was asked, and where it was asked (an issue, a review, a message). -->
<!-- "Fixes #<number>" on a line closes that issue when this is merged. -->
- **R1**

## :hammer_and_wrench: What was done

<!-- One line per request, then its main files. -->
- **R1**
  - Main files:

## :construction: Not done, and why

<!-- A request left out and the reason, or "Nothing". -->
-

## :heavy_plus_sign: Done beyond what was asked, and why

<!-- Anything in the diff that no request asked for, or "Nothing". -->
-

## :test_tube: Tests implemented

<!-- One row per test. Say whether it was seen failing before the change. -->
| Request | Test | File | What it proves | Seen failing before the change |
|---|---|---|---|---|
| | | | | |

## :raised_hand: Tests to run by hand to prove it

<!-- What the tests do not cover, as steps a person can follow. The reviewer ticks them. -->
<!-- Each case: its number, a title, and the request it proves. Name no real broker: a local or emulated one. -->
- [ ] **1.**
  - Set up:
  - Steps:
  - Expected:

## :books: Documentation

<!-- "None" is an answer. -->
- Updated:
- Decision record followed:
- Deliberately not documented:

## :rocket: How to run it

<!-- The commands, one per line. -->
```text

```

## :warning: Risk and impact

<!-- "Not touched" and "None" are answers. -->
| Item | Answer |
|---|---|
| API routes and what the web app sends and reads | |
| Messages and entities on a broker: what is created, moved, deleted or purged | |
| Provider boundary and declared capabilities | |
| Stored connections, workspace and settings | |
| Dependencies | |
| Installers and automatic update | |
| How to roll back | |

### Safety

<!-- Messaging Explorer is pointed at production brokers. context/pages/invariants/ -->

- [ ] **API surface:** nothing in this PR is reachable without the API key other than `/health`, and nothing widens the binding, CORS or host filtering (or: this PR does not touch the API surface).
- [ ] **Secrets:** no connection string, password, client secret or API secret leaves the backend unmasked or reaches a log (or: this PR does not touch a secret).
- [ ] **Message safety:** no path can lose a message silently; send comes before complete and failures are reported per message (or: this PR does not receive, send, complete or purge messages).

## :eyes: For the reviewer

<!-- Where to start and where to look hardest. Fill N and M from the review of this change. -->
- Start reading at:
- Look hardest at:
- Out of scope:
- Known weak points:
- Review: applied N, rejected M
