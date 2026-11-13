# Feature lane

The order of work for something new. Step numbers of `SKILL.md` are named where they apply.

1. **Discovery, when there is no spec.** If the request is one sentence from the owner and no
   roadmap page describes it, run `superpowers:brainstorming` and `product-management:write-spec`,
   write the result as a page under `context/pages/roadmap/` (problem, users, scope, non-goals,
   acceptance, open decisions), and continue from there.
2. **Decide before coding.**
   - Which project owns it. A feature that seems to need two projects usually needs one project
     plus a contract the Angular app reads.
   - Which broker operations it can reach, and whether any removes or moves a message.
   - Which abstraction each vendor type stays behind.
   - Where the configuration lives, and how a contributor without paid credentials runs it.
3. **Read.** The project's service page, then `reference/sensitive.md`. A feature is where a project
   first gains an endpoint, a broker operation or a new error
   path, and its page has no rule yet for a capability it does not have. A conflict with a
   rule stops the work: a superseding decision comes first.
4. **Plan** (`SKILL.md` step 3). When the feature is a screen an artboard draws, write the
   inventory of `reference/prototype.md` first; the plan's requirement table is that inventory. Add a sequence diagram when the flow crosses the control plane or
   a chat platform.
5. **Build** (step 4). A new provider registers through the existing
   abstraction and ships one test in which its external call fails.
6. **Check, prove, review, record** (steps 5 to 8). A new project or slice uses `mutation proof`.
