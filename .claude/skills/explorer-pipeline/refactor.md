# Refactor lane

1. **Read the decision behind the current shape** in `context/pages/decisions/`. A refactor that
   contradicts an accepted decision starts with a superseding one. When no decision governs the
   shape, say so and continue.
2. **Check `reference/sensitive.md`.** Moving a call out of an abstraction, changing which project
   talks to a vendor SDK, or changing where a configuration value is read adds a capability.
3. **Lock the behaviour.** Every row of the requirement table is a `behaviour lock`. Each named
   test is green before the restructure and green after it. A test that is red before shows the
   change is a feature or a fix: stop and classify it again. Tests for branches nothing covers
   are step one of the plan, written before any code moves. When the refactor changes nothing
   executable, say so.
4. **Restructure** (`SKILL.md` step 4). Behaviour stays the same; the provider, capability and factory
   abstractions stay; nothing gains an abstraction with one user.
5. **Check, prove, review, record** (steps 5 to 8). A refactor that moves code into
   `ServiceBusExplorer.Core` widens the test surface to the Api tests.
6. **Fix the pages that named what moved.** Search the context folder for the old paths. A
   citation that still resolves proves the file exists, not that it still says what the page
   claims: read each one you rewrite.
