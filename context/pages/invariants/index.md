---
title: "Invariants"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the entries of this area moved out of the context index"
page_type: index
status: active
description: "The pages of the invariants area, one line each."
source:
  - context/index.md
reliability: high
---

# Invariants

The rules the code must preserve, with the code and tests that enforce them.

- [[pages/invariants/local-authenticated-api|The API is local and authenticated]] - Rule A. Loopback, Host filter, CORS, the per-launch key in fixed time.
- [[pages/invariants/secrets-masked-at-the-api-boundary|Secrets are masked at the API boundary]] - Rule G. The mask, the merge on save and import, the one raw export.
- [[pages/invariants/bulk-operations-are-at-least-once|Bulk operations are at-least-once]] - Rule H. Send before complete, the duplicate report, bounded scans, cancellation. Holds for Azure; RabbitMQ is a recorded breach.
- [[pages/invariants/provider-boundaries|Provider boundaries]] - Rule F. The provider contract, capabilities, vendor types inside their folder.
- [[pages/invariants/a-guard-must-be-able-to-fire|A guard must be able to fire]] - Every check has an input that reaches it and a test that supplies one; a failure never answers as success.
