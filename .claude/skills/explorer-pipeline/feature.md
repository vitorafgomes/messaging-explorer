# Feature lane

Stages in order. Repo facts live in the linked vault pages; this file carries only the stage order.

0. **Discovery** - when the request is an owner sentence with no spec in the vault yet, run
   `superpowers:brainstorming` and `product-management:write-spec` first, write the outcome into a
   roadmap page under `vault/pages/roadmap/` (problem, users, scope, non-goals, acceptance, open
   decisions), and only then continue.
1. **Pre-flight** - decide before coding: which project owns it (a feature that seems to need the
   API and the web app usually needs one provider member, one endpoint and one Angular service
   method, in that order); whether it touches the API surface, a secret, or a message (and in which
   order it receives, sends and completes); which provider supports it and what the other provider
   answers (a capability flag in `IProviderCapabilities`, never a silent no-op).
2. **Vault route** - `vault/pages/services/<project>.md` + linked invariants + relevant ADRs, **then
   the capability check in SKILL.md gate 1**. Exit: no invariant conflict (else stop, superseding
   ADR first).
3. **Plan** - state the six-part plan from SKILL.md before implementation; a sequence diagram when
   the flow crosses Angular, the API and a broker.
4. **Implement** - dispatch `explorer-implementer` (opus) with the six-part plan, then check its
   diff against the plan and report any departure to the owner. Rule B per edit. A new provider
   member ships in both providers (implemented, or declared unsupported through capabilities) and
   ships its failing-call test (Rule I).
5. **Scans (diff-gated)** - per `AGENTS.md`; the test-quality skills run as part of gate 5. A scan
   whose surface the diff does not touch does not run.
6. **Gates 3-9** from SKILL.md (build -> full test surface -> **Prove the requirement** -> review
   workflow -> crystallize -> PR body -> commit message). A brand-new provider or feature uses
   `mutation proof` (SKILL.md gate 5).
