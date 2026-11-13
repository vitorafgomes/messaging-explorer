# Contributing to messaging-explorer

Thanks for your interest. Issues and pull requests are welcome. For anything
beyond a small fix, open an issue first so the approach can be agreed before
you write it.

## Ground rules

This tool is pointed at production brokers. A pull request that breaks one of
these is not merged:

- The local API listens on `127.0.0.1` only and accepts a request only with
  the key generated at each start.
- A secret leaves the API masked unless the user asks for it.
- A bulk operation is at-least-once: a message is never lost, and a possible
  duplicate is reported, never sent again silently.
- A broker SDK type stays inside its provider.

The rules and how the code keeps them are under `context/pages/invariants/`.

## Getting set up

You need the .NET 10 SDK, Node.js 22 or newer with npm, and Docker for the
integration tests.

```bash
git clone https://github.com/vitorafgomes/messaging-explorer.git
cd messaging-explorer
dotnet build ServiceBusExplorer.slnx
dotnet test src/ServiceBusExplorer.Core.Tests
dotnet test src/ServiceBusExplorer.Api.Tests
dotnet test src/ServiceBusExplorer.IntegrationTests   # starts brokers in Docker
cd web-app && npm install && npm test -- --watch=false
```

## Workflow

1. Fork and create a branch: `feat/<slug>`, `fix/<slug>` or `chore/<slug>`.
2. Keep commits atomic, one concern per commit, with a conventional message.
3. A change needs a test that fails without it, a build with 0 warnings and
   the test suites green.
4. Open a pull request against `main` and fill in the template.

## Code style

- Code, identifiers and comments in English.
- No emojis in source files, no AI-attribution comments.
- Follow the `.editorconfig` in the repository.
- Never commit a secret: connection values come from the user at run time.

## License

Contributions are accepted under the project's MIT license. By opening a pull
request you confirm you have the right to contribute the code and that it can
be released under MIT.
