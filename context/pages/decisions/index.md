---
title: "Decisions"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the entries of this area moved out of the context index"
page_type: index
status: active
description: "The pages of the decisions area, one line each."
source:
  - context/index.md
reliability: high
---

# Decisions

The architecture decision records, newest first.

- [[pages/decisions/0007-read-azure-resource-manager-to-list-namespaces|ADR 0007 - Read Azure Resource Manager to list the namespaces]] *(accepted 2026-11-19)* - The add dialog signs in first and lists the subscriptions and namespaces of the account; the Resource Manager token stays in the API's memory.
- [[pages/decisions/0006-choose-the-version-to-install|ADR 0006 - Choose the version to install, per channel]] *(proposed 2026-11-15)* - Settings lists the releases of Stable or Beta and installs the one picked, older ones included, only on the user's click; the automatic check stays as it is.
- [[pages/decisions/0003-azure-authentication-strategy|ADR 0003 - Azure authentication strategy]] *(accepted 2026-04-19)* - Identity before keys: five supported credentials, two rejected, and resource discovery, which is the part not built.
- [[pages/decisions/0004-the-in-repo-documentation-folder-is-named-context|ADR 0004 - The in-repo documentation folder is named context]] *(accepted 2026-11-13)* - `vault/` became `context/`; ADR 0001 otherwise stands.
- [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk|ADR 0005 - Cite code by name, prove in proportion to the risk]] *(accepted 2026-11-13)* - `path#Member` citations instead of line numbers; mutation proofs, integration and end-to-end runs and review rounds spent where the risk is.
- [[pages/decisions/0002-integration-tests-against-brokers-in-docker|ADR 0002 - Integration tests against brokers in Docker]] *(accepted)* - A third test project that starts RabbitMQ and the Azure Service Bus emulator in containers; a test never talks to a broker it did not start.
- [[pages/decisions/0001-in-repo-vault-and-agent-harness|ADR 0001 - In-repo context and agent harness]] *(accepted)* - Why the documentation and the harness live in the repo, and where the ten rules came from.
