---
title: "<Service name>: <Topic>"
version: "1.0"
date: YYYY-MM-DD
changes: "v1.0: first version"
page_type: service
status: active
description: "Read when a change touches <what in the code>."
source:
  - <the source paths of this topic only>
reliability: high
---

# <Service name>: <Topic>

One topic of [[pages/services/<project>|<Service name>]]; the map lists the others.

Saved as `pages/services/<project>/<topic>.md`. At most 12,000 characters
(`tools/checks/check-doc-sizes.sh`); when it grows past that, split it and add the new page to the
map's Topics table and to the table in `.claude/rules/<project>.md`. The `description` says when
to read the page, never what the page says. Cite code by name, `path#Member`, never by line.

## Contract

REQUIRED when the topic has a public surface. What other code may rely on: the types, the members,
the routes, the configuration keys. Each statement cites the `path#Member` that holds it.

## How it works

REQUIRED. What happens, in the order it happens. Each claim a reader could doubt cites the
`path#Member` or the test that shows it. A topic that holds the main flow of the project carries
a drawing (Mermaid: `flowchart`, `sequenceDiagram` or `stateDiagram-v2`) whose boxes name types.

## Sharp edges

Lines where a small change has a wide effect, each with its `path#Member` and what breaks.

## Tests

The tests that cover this topic, by `path#TestName`, and how they reach an external boundary
when there is one.
