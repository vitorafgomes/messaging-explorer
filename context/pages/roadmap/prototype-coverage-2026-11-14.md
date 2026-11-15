---
title: Prototype coverage on 2026-11-14
type: roadmap
updated: 2026-11-14
---

# Prototype coverage on 2026-11-14

Counted from the artboards under `context/prototypes/web-app/` against the working tree, one row per thing an artboard draws, as `.claude/skills/explorer-pipeline/reference/prototype.md` asks; the grey status strip and the designer's notes are not rows. Counted twice that day: in the morning after lanes L2 to L16 (548 of 670), and in the afternoon after lanes L17 to L21 of [[pages/roadmap/ui-material-migration]], at a finer grain, so the two totals do not compare row for row.

**PROTOTYPE COVERAGE, afternoon: 765 of 802 rows.** 30 partial, 1 missing, 6 not buildable. The counts predate the AutoResubmit, Main and Messages rows and the entity form hints closed later on 2026-11-14, listed under What is left; they were not recounted.

| Artboard | Rows | Done | Partial | Missing | Not buildable |
|---|---|---|---|---|---|
| Main | 81 | 72 | 7 | 0 | 2 |
| EntityAdmin | 60 | 58 | 2 | 0 | 0 |
| Rules | 50 | 50 | 0 | 0 | 0 |
| Monitoring | 81 | 79 | 1 | 0 | 1 |
| Messages | 83 | 77 | 5 | 1 | 0 |
| Send | 72 | 70 | 2 | 0 | 0 |
| AutoResubmit | 89 | 82 | 5 | 0 | 2 |
| Settings | 77 | 77 | 0 | 0 | 0 |
| Window | 30 | 29 | 1 | 0 | 0 |
| Connections | 117 | 114 | 3 | 0 | 0 |
| Components | 62 | 57 | 4 | 0 | 1 |

## What is left

Checked item by item against the code at the end of 2026-11-14, after lanes L22 to L26: every row the morning and afternoon counts left open is built, except these.

- **Connections, a refused user name or password**: the drawn sentence names the management API of RabbitMQ; RabbitMQ connects over AMQP and its refusal is a `RabbitMQ.Client` type the API may not name, so it needs a change in the RabbitMQ provider. Deferred to the RabbitMQ work, which the owner put after Azure.
- **Not seen in a screenshot**: the layout rows (the summary's right alignment, the 8 px corners, the 40 px buttons, the tree at 232 px) are built and asserted where a spec can, but no screenshot was compared with the artboards.

## Not buildable

- A subscription's Size card: Azure gives no size for a subscription.
- Another holder's session lock expiry ("Locked until"), in Main and Monitoring: the SDK does not give it.
- Two AutoResubmit sentences that would be false for the head-of-queue loop ("The rest stay in dead-letter", "sent first and removed after").
- "The request to {conn} timed out after 30 seconds" in Messages and Main: nothing in those calls times out, and a client timeout would cut a long peek that is working. Monitoring, which has the timeout, says it.
- The Rules count before the definitions export: only the export's read of every topic knows it, so it reads "Counted when exported" until then.
- The AutoResubmit Pause and Stop sentence as drawn: Stop cancels the request in flight, so the app keeps the true words; "(what the app does today)" is a note about the old app.
- The "Design, not built" tag of the Components sheet: an annotation.
