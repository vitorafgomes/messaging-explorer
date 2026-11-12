# Bug-fix lane

1. **Vault route** - `vault/pages/services/<project>.md`, its "Known gaps" (the bug may already be
   recorded there with its citation) and the invariants touching the bug surface. If the bug
   violates a documented invariant, that invariant is the fix target, not the symptom.
2. **Reproduce first** - once the expected behaviour is a defined spec, the failing test is step one
   of the plan and `explorer-implementer` writes it, red, before the fix. Exit: a test that
   demonstrates the bug. Proof that it goes red when the fix is removed is gate 5 in SKILL.md. A
   bug in masking, in the key check or in a bulk operation needs a test that fails on the *old*
   behaviour; nothing else proves it.
3. **Root cause, then smallest fix** - grep every caller of the function you are about to touch: one
   guard in the shared path beats a guard per caller, and patching only the path the report names
   leaves every sibling broken (the queue and the topic controller, the Azure and the RabbitMQ
   provider, the active and the dead-letter variant). No surrounding cleanup (Rule C).
4. **Scans (diff-gated)** - only if the fix touched a scan, a bulk operation or a polling path. A
   typical small fix runs zero scans.
5. **Gates 3-9** from SKILL.md, including gate 4's surface table and **Prove the requirement** - a
   fix inside `ServiceBusExplorer.Core` runs both .NET test projects.
6. **Crystallize** - a bug that came from a rule nobody had written down becomes an invariant page,
   not just a code change; a fix that closes a "Known gaps" entry removes the entry. The
   implementer writes the page the plan names; the manager reviews it (SKILL.md gate 7).
