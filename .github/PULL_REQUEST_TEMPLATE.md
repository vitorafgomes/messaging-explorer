## Summary

<!-- What does this PR do? One or two sentences. -->

## Related issue

<!-- Link to the issue this PR addresses, or write "N/A" for trivial fixes. -->

Fixes #

## Changes

-
-

## Safety

<!-- Messaging Explorer is pointed at production brokers. vault/pages/invariants/ -->

- [ ] **API surface:** nothing in this PR is reachable without the API key other than `/health`, and nothing widens the binding, CORS or host filtering (or: this PR does not touch the API surface).
- [ ] **Secrets:** no connection string, password, client secret or API secret leaves the backend unmasked or reaches a log (or: this PR does not touch a secret).
- [ ] **Message safety:** no path can lose a message silently; send comes before complete and failures are reported per message (or: this PR does not receive, send, complete or purge messages).

## Tests

- [ ] Tests added or updated; each fails without the change
- [ ] `dotnet build ServiceBusExplorer.slnx` at 0 warnings
- [ ] `dotnet test` green per test project
- [ ] `npm test -- --watch=false` and `npm run build` in `web-app/` (web changes)

## Checklist

- [ ] Commits are atomic and focused
- [ ] Code and comments are in English
- [ ] No real namespaces, hosts or credentials committed
- [ ] Vault pages updated in the same change (`vault/pages/services/`, an ADR for a change to an invariant)

<!-- Review: applied N, rejected M -->
