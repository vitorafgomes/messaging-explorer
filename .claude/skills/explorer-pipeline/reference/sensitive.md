# What makes a change sensitive

A change is **Sensitive** when it matches any row. Read the pages of that row before the plan, and
give the review the lenses it names.

| The change | Read first | Lenses | The trap |
|---|---|---|---|
| Adds or changes an endpoint, a middleware, CORS, host filtering, the binding, `Program.cs`, an Electron IPC channel, or how the API process is started | `context/pages/invariants/local-authenticated-api.md` | `api-surface` | A route mapped before the key middleware; an origin or a host added "for dev"; an error body that returns the exception message |
| Touches a connection string, a password, a client secret, the API secret, masking, export, import, `workspace.json` handling, or a log line near any of them | `context/pages/invariants/secrets-masked-at-the-api-boundary.md` | `secrets` | A new secret field missing from `MaskConnection` or from the merge on save; a response built from the unmasked object; a secret in a log line |
| Touches anything that receives, completes, abandons, sends, moves, resubmits or purges messages, in a provider, a controller or the Angular bulk flow | `context/pages/invariants/bulk-operations-are-at-least-once.md` | `message-safety` | Complete before send; a silent resend after a failed complete; a scan with no bound; a token not passed on |
| Touches a provider, `IMessagingProvider`, `IProviderCapabilities`, `ProviderFactory`, the Angular provider registry, or a type crossing those abstractions | `context/pages/invariants/provider-boundaries.md`, and `docs/ADDING_PROVIDERS.md` checked against `context/pages/services/web-app/providers-and-shared.md`, because parts of it are stale | `boundaries` | An `Azure.*` or `RabbitMQ.Client` type in a controller, a model or an abstraction; a member one provider silently does not implement |
| Adds or changes a call to a broker SDK, the RabbitMQ management API, Azure Monitor, the filesystem or a subprocess | `context/pages/conventions/testing.md` | `boundaries` | The happy path is tested and the timeout, 5xx or broker exception is not |

`invariants` always runs. Add `explorer-optimizer` when the diff touches a bulk message operation,
a peek, search or scan loop, the monitoring background service, the RabbitMQ management client,
the metrics service, or an Angular polling or large-list path. You may add a lens; you may not
drop one a row names. Add `/code-review` at `medium`, without `--fix`,
when the diff touches `Program.cs`, `IMessagingProvider` or the owner asks.

## Rows that are not sensitive but still need a page read

| The change | Read first | The trap |
|---|---|---|
| Touches `web-app/**` | `context/pages/services/web-app/how-the-rules-are-kept.md`, `context/pages/services/web-app/tests.md`, `context/pages/services/electron-shell.md` | An HTTP call that bypasses `ApiService` and so carries no key; plain `npx vitest`, which has no Angular compiler and fails sound tests |
| Changes a screen: a template, a component's styles, a dialog | `context/pages/conventions/ui.md` | A new Bootstrap class, Font Awesome icon or literal colour; a destructive action beside a routine one; an icon button with no name; an error shown as an empty list |
| Adds a guard, a validation or an error path | `context/pages/invariants/a-guard-must-be-able-to-fire.md` | A check the lines before it make unreachable; write the test whose input makes it fire |
| Answers a finding as intended behaviour | `context/pages/conventions/decisions-that-look-like-defects.md` | The next review reports it again; add the entry in the same change |

## Never fast path, whatever the extension

`ServiceBusExplorer.slnx`, `*.csproj`, `.github/workflows/**`, `appsettings*.json`, `config.json`,
`.claude/**`, `tools/**`, `web-app/package.json`, `web-app/package-lock.json`,
`web-app/angular.json`, `web-app/tsconfig*.json`, `web-app/electron/**`.

## A broker is someone's production

Never run an operation that removes or moves messages (receive, purge, delete, move, resubmit)
against a broker the owner did not name for that purpose. No real namespace, host, connection
string or id from the owner's environment goes into code, tests, the context folder or a commit.
