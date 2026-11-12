# Web app UI prototype

The target layout of the web app, as 38 artboards in one self-contained file: [`index.html`](./index.html). Open it in a browser; it needs no server and no network. The buttons at the top switch artboard and theme, and each artboard has an address: `index.html#queue`, with `,dark` appended for the dark theme (`index.html#messages,dark`) and `,shot` to hide the prototype's own bar. The addresses: `#queue`, `#sub`, `#purge`, `#messages`, `#states`, `#topic`, `#rabbit`, `#create`, `#connections`, `#conn-azure`, `#conn-rabbit`, `#groups`, `#conn-transfer`, `#detail`, `#send`, `#move`, `#msg-import`, `#msg-export`, `#resubmit`, `#diff`, `#bulk`, `#monitoring`, `#metrics`, `#settings`, `#updates`, `#bug`, `#about`, `#mac-today`, `#mac`, `#win`, `#min`, `#p-edit`, `#p-rules`, `#p-status`, `#p-counts`, `#p-sessions`, `#p-scheduled`, `#p-defs`.

It is a drawing of the proposal, not the application: the data is invented and nothing is wired, except the artboard switch, the theme, the typed purge acknowledgement and the authentication selector of board 10. The rules it illustrates are in [`vault/pages/conventions/ui.md`](../../pages/conventions/ui.md), the order of work in [`vault/pages/roadmap/ui-material-migration.md`](../../pages/roadmap/ui-material-migration.md), and what the application breaks today, screen by screen, in [`vault/pages/roadmap/ui-review-2026-11.md`](../../pages/roadmap/ui-review-2026-11.md).

**The prototype is the spec.** Where the application and an artboard differ, the artboard is what the screen should become; a change to a screen updates its artboard and its screenshot in the same change. Three kinds of board are not a spec of something that exists: boards 8 and 24 draw a screen the app lacks for a function it has, board 28 draws a defect, and boards 32 to 38 are **proposed features, not built**, framed with a dashed border.

To refresh the screenshots, run a headless Chromium on each address with a 1280 px wide window and the height the page reports in `data-h` on its root element: `chrome-headless-shell --headless --hide-scrollbars --window-size=1280,<h> --screenshot=screens/<n>-<name>.png "file://<path>/index.html#<name>,shot"`.

## The design canvas

The prototype is being redrawn as a design canvas: one `.dc.html` artboard per screen, listed and placed by [`canvas.json`](./canvas.json). Each artboard carries both themes, a `state` switch for every state of the screen (loading, empty, error, each dialog), an `environment` switch, and is clickable; a strip at its top says whether the screen is `Built`, `Built, layout to migrate` or `Design, not built`. The artboards need the canvas runtime to render and are not opened directly in a browser. Until every board of `index.html` has its artboard, `index.html` and its screenshots stay, and the addresses the review cites stay valid; where the two differ, the artboard is the newer drawing.

| Artboard | Page | Draws |
|---|---|---|
| `Main.dc.html` | The app today | the entity tree and the queue, topic and subscription panel |
| `Connections.dc.html` | The app today | the connection list, add and edit for both brokers, groups, export, import, a failed connect |
| `Settings.dc.html` | The app today | settings, every state of the update, the bug report, clearing the data |
| `Messages.dc.html` | The app today | active, dead-letter, transfer dead-letter and scheduled messages, selection, cancel scheduled, progress and results |
| `Send.dc.html` | The app today | send, schedule, edit and resubmit, move, import, export, compare |
| `AutoResubmit.dc.html` | The app today | the automatic dead-letter resubmit as it is today on a queue of 700,000, and the proposal for a run of that size |
| `EntityAdmin.dc.html` | Azure Service Bus | create, edit and status of a queue, a topic and a subscription |
| `Rules.dc.html` | Azure Service Bus | the subscription rules table and editor |
| `Monitoring.dc.html` | Azure Service Bus | monitoring today, and the proposed counts, sessions and definitions screens |
| `Components.dc.html` | Window and components | the colours, type and components every artboard uses |
| `Window.dc.html` | Window and components | the window on each system, without a menu bar, and macOS as it is today |

The pages `RabbitMQ` and `Next version` of the canvas are empty until the screens of [`rabbitmq-messaging-scenarios`](../../pages/roadmap/rabbitmq-messaging-scenarios.md) and [`azure-event-hubs-and-event-grid`](../../pages/roadmap/azure-event-hubs-and-event-grid.md) are drawn.

## Entities

### 1. Queue

A queue uses the same panel as a subscription: the same cards with live counts, the same tabs, the same actions (rule 7). The toolbar says which environment and which broker and now carries the navigation. Purge and delete are under the overflow menu, in the error colour, never beside View messages (rule 6).

![Queue](./screens/1-queue.png)

![Queue, dark](./screens/1-queue-dark.png)

### 2. Subscription

The same panel. It differs from the queue only where the broker differs: the parent topic in the header, the Rules tab, and the warning that a resubmit from a subscription publishes to the topic.

![Subscription](./screens/2-sub.png)

### 3. Purge confirmation

A destructive confirmation names what it destroys: the entity, the connection and its environment, and the count read at that moment. The button is disabled until the entity name is typed (rule 6). Every other destructive or disruptive action in the prototype reuses this dialog.

![Purge confirmation](./screens/3-purge.png)

![Purge confirmation, dark](./screens/3-purge-dark.png)

### 4. Messages

A selection says exactly what it covers ("3 selected of 20 loaded, 37 in the dead-letter queue"), and a result says what happened to each message. A possible duplicate is never offered for retry. Delete sits apart from resubmit, move, export and compare (rule 6).

![Messages](./screens/4-messages.png)

![Messages, dark](./screens/4-messages-dark.png)

### 5. States

Loading, empty and error are three different screens (rule 9). Extended with the cases a screen has of its own: not connected, a filter that matches nothing among the loaded messages, the local API down, no metrics, a capability the broker lacks, an expired sign-in.

![States](./screens/5-states.png)

### 6. Tree and topic

The tree filters by name, counts each section and says how many entities the filter hides. A topic uses the same panel shape; its properties are text because today's form has inputs and no save (rule 8).

![Tree and topic](./screens/6-topic.png)

### 7. RabbitMQ

The same panel with RabbitMQ's words: ready and unacknowledged, bindings and arguments, a queue and an exchange. What the broker cannot do is a disabled tab with its reason (rule F of the repo, rule 9 here).

![RabbitMQ](./screens/7-rabbit.png)

### 8. Create entity

Create a queue, a topic or a subscription. The services can already create by name; no screen offers it today. Each dialog names the connection and its environment and shows a validation error beside the field (rule 10).

![Create entity](./screens/8-create.png)

## Connections

### 9. Connections

Connections as one list grouped by client and environment, with the environment marked: red for production, green otherwise, an outlined NO ENVIRONMENT when there is none. One primary action; delete lives in each row's menu (rule 6).

![Connections](./screens/9-connections.png)

![Connections, dark](./screens/9-connections-dark.png)

### 10. Azure connection

Add or edit an Azure Service Bus connection with the five authentication types of the model (the dialog offers four today). The selector works in the prototype. A stored secret shows as a mask and the hint says where it is kept (rule G of the repo).

![Azure connection](./screens/10-conn-azure.png)

### 11. RabbitMQ connection

The same dialog for RabbitMQ, drawn with a failed test: which port refused, beside the field, and what to check (rule 9). The password starts empty.

![RabbitMQ connection](./screens/11-conn-rabbit.png)

### 12. Groups

Clients and their environments in one list instead of two tabs. An environment carries a production mark, which is new. Deleting a group names the connections that lose it and uses a dialog of the app, not a browser confirm box.

![Groups](./screens/12-groups.png)

### 13. Export and import connections

Export is masked unless the user chooses otherwise, and the choice with secrets says what the file will hold. Import previews what is added and replaced; a masked secret never overwrites a stored one.

![Export and import connections](./screens/13-conn-transfer.png)

## Messages

### 14. Message detail

One message: the body first, formatted when it parses, with system and application properties beside it and the dead-letter reason on top. Delete is apart. One monospace stack that exists on every platform.

![Message detail](./screens/14-detail.png)

![Message detail, dark](./screens/14-detail-dark.png)

### 15. Send

Send with the target and its environment in the header, a required session id when the queue needs one, a schedule shown in UTC and local time, a time to live with its unit, and a button that says what will happen.

![Send](./screens/15-send.png)

### 16. Move

Move names the source, the target and the count, and states the at-least-once contract before the button (rule H of the repo).

![Move](./screens/16-move.png)

### 17. Import messages

The file is parsed and checked before anything is sent; rows that cannot go are counted and the button carries the number that will. No fixed pixel column widths (rule 5).

![Import messages](./screens/17-msg-import.png)

### 18. Export messages

The scope is the selection or what is loaded, with the numbers, never an unstated "all".

![Export messages](./screens/18-msg-export.png)

### 19. Continuous resubmit

A long resubmit counts its three outcomes per batch and in total while it runs. Stop ends after the current batch and says what is left. For a subscription it repeats that messages go to the topic.

![Continuous resubmit](./screens/19-resubmit.png)

### 20. Diff

Two messages side by side, named by sequence number. Added and removed lines carry a sign as well as a colour.

![Diff](./screens/20-diff.png)

![Diff, dark](./screens/20-diff-dark.png)

### 21. Bulk progress and results

Progress counts the outcomes as they happen and cancel says what it does. The result lists each sequence number that did not succeed with its reason; retry is for failures only.

![Bulk progress and results](./screens/21-bulk.png)

## App

### 22. Monitoring

Totals, the trend of active and dead-letter, and one table of every entity with right-aligned, tabular counts. Reachable from the toolbar: today nothing in the desktop app leads to it.

![Monitoring](./screens/22-monitoring.png)

![Monitoring, dark](./screens/22-monitoring-dark.png)

### 23. Entity metrics

The Metrics tab of an entity: a time range, two charts whose series differ by line style as well as colour, and the source and age of the numbers.

![Entity metrics](./screens/23-metrics.png)

### 24. Settings

Not a screen today. It gathers the theme, the update channel, the data file, the shortcuts, developer mode and Clear all data, which today are a toolbar button, a hidden menu on the version number, a shortcut and a File menu item.

![Settings](./screens/24-settings.png)

### 25. Update states

Available, downloading, ready, failed, and a package that cannot update itself and links to the download instead. One sentence and one action each.

![Update states](./screens/25-updates.png)

### 26. Bug report

The report shows exactly the text that will be posted as a public GitHub issue, editable, before the browser opens.

![Bug report](./screens/26-bug.png)

### 27. About

A dialog of the app with the version, channel, platform and runtimes, and a button to copy them. Today it is a native message box.

![About](./screens/27-about.png)

## Platform

### 28. macOS today

Inferred from the code, not reproduced on a Mac. The window buttons drawn over the title, no drag region, no Edit or Window menu. The numbered findings are on [the review page](../../pages/roadmap/ui-review-2026-11.md).

![macOS today](./screens/28-mac-today.png)

### 29. macOS target

The same shell in a standard macOS window: the native title bar holds the window buttons and drags the window, so the page needs no layout of its own for the Mac. No File, Edit, View, Window or Help row is drawn in the window; the system menu bar keeps only the application menu, Edit and Window, which macOS needs for copy and paste. Cmd in the shortcut hints.

![macOS target](./screens/29-mac.png)

![macOS target, dark](./screens/29-mac-dark.png)

### 30. Windows and Linux

The native frame stays, the toolbar drops the brand the title bar already shows, and there is no menu bar at all: no File, Edit, View or Help row, and none that appears on Alt. What the menu held is in the app (a new connection on the Connections screen, About and the developer tools in Settings); the testing item that cleared all data is removed.

![Windows and Linux](./screens/30-win.png)

### 31. Minimum size

The shell at the smallest window the app allows, 1000 by 700, with a long broker name and an update button in the toolbar. Nothing scrolls sideways (rule 5).

![Minimum size](./screens/31-min.png)

## Proposed features

### 32. Edit entity

**Proposed, not built.** Edit the properties of an existing queue, topic or subscription. Only what the broker lets change is an input (rule 8); the changes are listed before saving; production asks with the board 3 dialog.

![Edit entity](./screens/32-p-edit.png)

### 33. Rules editor

**Proposed, not built.** Add, edit and delete subscription rules: SQL filter, correlation filter, optional action. Deleting the last rule says the subscription stops receiving and asks for the rule name.

![Rules editor](./screens/33-p-rules.png)

### 34. Entity status

**Proposed, not built.** Active, Send disabled, Receive disabled and Disabled as four choices with their consequence, the typed confirmation, and how a disabled entity is marked afterwards.

![Entity status](./screens/34-p-status.png)

### 35. Counts dashboard

**Proposed, not built.** Every queue and subscription with active, dead-letter, scheduled and transfer counts in one sortable table, with a dead-letter switch, auto-refresh and a total. It grows out of the Monitoring table.

![Counts dashboard](./screens/35-p-counts.png)

![Counts dashboard, dark](./screens/35-p-counts-dark.png)

### 36. Sessions

**Proposed; a subscription has a first version, a queue has none.** The sessions list, the messages of one session and its state, read only.

![Sessions](./screens/36-p-sessions.png)

### 37. Scheduled

**Proposed, not built.** A Scheduled tab beside Active and Dead-letter, with cancel as a destructive action that names the message it deletes.

![Scheduled](./screens/37-p-scheduled.png)

### 38. Entity definitions

**Proposed, not built.** Export the definitions of a namespace's entities and import them into another: a plan first, create only, nothing changed or deleted, the namespace name typed for production.

![Entity definitions](./screens/38-p-defs.png)
