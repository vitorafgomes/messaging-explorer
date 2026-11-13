# Messaging Explorer

An open-source (MIT) desktop and web tool to explore and manage messaging brokers: Azure Service
Bus and RabbitMQ. It lists and creates queues, topics, subscriptions and exchanges, and peeks,
sends, receives, resubmits, moves, deletes and purges messages, on brokers that are usually
someone's production. .NET 10 API and core under `src/` (test projects sit beside them under
`src/`, not `tests/`), Angular app under `web-app/`, Electron shell under `web-app/electron/`.
The stack: `Azure.Messaging.ServiceBus`, `Azure.Identity` and `RabbitMQ.Client` behind the provider
interface; Angular 21 with Angular Material and ng-bootstrap; Electron with `electron-builder` and
`electron-updater`. CI is `.github/workflows/ci.yml`; `release.yml` packages three systems, unsigned.

## Commands

Unit and web tests run in the project's container, never directly on the machine.

| To | Run |
|---|---|
| Build | `dotnet build ServiceBusExplorer.slnx`, 0 warnings on the summary line; then `tools/checks/check-diagnostics.sh <touched .csproj>` clean |
| Test every unit project | `tools/checks/in-docker.sh bash tools/checks/test-per-project.sh`, each with a count and 0 skipped |
| Test one test | add `--filter "FullyQualifiedName~<Name>"` |
| Integration tests | `dotnet test src/ServiceBusExplorer.IntegrationTests`, on the machine: they start brokers in Docker |
| Web tests, in `web-app/` | `../tools/checks/in-docker.sh npm test -- --watch=false`. Never plain `npx vitest`: it has no Angular compiler |
| Web build, in `web-app/` | `npm run build` |

A change to `ServiceBusExplorer.Core` runs both unit projects: the API references the core. The
integration suite runs only when broker code changes, and the end-to-end suite once, at the end of
a lane that changes the screen. At most two such heavy lanes run at once on the owner's machine.

## Rules

Three things are never left for later: nobody but the local user reaches the API, a secret never
leaves the backend unmasked or reaches a log, and a bulk operation never loses a message
silently. Each known breach is written under "Known gaps" on the service pages and in
`context/pages/roadmap/followups.md`. A change may leave a recorded gap as it found it. It never
adds one and never widens one.

**The API is local and authenticated.** It listens on loopback only, filters the Host header,
restricts CORS to the configured front end, and refuses every request without the per-launch
`X-Api-Key`, compared in fixed time. `/health` is the one exemption. The Angular app reaches it
only through `ApiService`.

**Secrets are masked and never logged.** A connection string, a password, a client secret and the
API secret leave the backend only as the mask, except on an export the user asked for with
secrets. The mask never overwrites a stored secret. A new secret field is added to the mask, to
the merge on save and import, and to a masking test, in one change.

**A bulk operation never loses a message silently.** Send first, complete after. A message that
was sent and could not be removed from its source is reported as a possible duplicate, never
resent in silence. Every failure is reported per sequence number. Scans are bounded. The caller's
`CancellationToken` stops the batch. Operations are at-least-once, and the UI says so.

**A broker is reached through `IMessagingProvider`.** What a provider cannot do is declared in
`IProviderCapabilities`, never a silent no-op. `Azure.*` and `RabbitMQ.Client` types stay inside
`src/ServiceBusExplorer.Core/Providers/<Provider>/`.

**Never touch a broker the owner did not name.** No operation that removes or moves messages
runs against a broker the owner did not name for that purpose. No real namespace, host,
connection string or id from the owner's environment goes into code, tests, pages or a commit.

**A change ships with its test.** The test fails without the change and asserts the requirement
in the words of the request. A refactor names tests that are green before and after.

**One test where the call fails.** A change that adds or alters a call to a broker SDK, the
RabbitMQ management API, Azure Monitor, the filesystem or a subprocess ships a test in which
that call fails (timeout, 5xx, a broker exception) and asserts what the caller does.

**No abstraction for one user.** A generic, a base class or a helper needs a second caller. The
provider interface, the capabilities and the factory are documented abstractions and stay.

**Read before you cite.** A file, class or convention is read in the current tree before it is
recommended. `docs/ADDING_PROVIDERS.md` describes a flow the code does not fully run; the service
pages say which parts.

**Documentation lives in `context/`, in English.** Code carries a `<summary>` on a public type or
member, and no comment that narrates inside a member or refers to a decision, a page or an issue;
the one exception is a `ponytail:` line that names a deferral. Identifiers and comments are in
English. An existing file is edited before a new one is created, and no planning or analysis
Markdown is written outside `context/`.
`README.md` is the public front page; how it works and why stays in `context/`. A page cites code
by name, `path#Member`, never by line number.

**Git belongs to the owner.** No commit, push, pull request, release or merge unless the owner
asks for that action. A batch authorisation in words covers one session's commits and pull
requests on a `feat/`, `fix/`, `chore/` or `docs/` branch, and never a push to `main`: every
change reaches `main` through a pull request. A commit, a pull
request and a source file never carry a line that credits an AI tool.

## Where things are

- Why something is the way it is: `context/pages/decisions/`.
- Rules that span projects: `context/pages/invariants/`.
- How each part works, and its known gaps: `context/pages/services/`.
- What is owed: `context/pages/roadmap/followups.md`.
