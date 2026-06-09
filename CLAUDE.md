<!-- becuz:begin -->
## Decision logging (becuz)

This repo uses **becuz** to record *why* decisions are made. Whenever you and
the user reach a meaningful decision, call the becuz MCP tools so the reasoning
is preserved alongside the code.

**Log a decision when you settle any of:**
- Architecture or system design (boundaries, patterns, data flow)
- Infrastructure or deployment (databases, hosting, queues, CI)
- A dependency / library choice (and what you rejected)
- An API shape or contract
- A data-model / schema decision
- A UI / UX direction with real trade-offs
- A product or scope decision
- Security, performance, or process choices

**Do NOT log:** trivial edits, formatting, renames, obvious one-way-door
fixes, or anything with no meaningful alternative.

**How:**
- When a decision is reached, call `record_decision` *before moving on*.
  Include the alternatives you weighed and why you rejected them, and pass the
  relevant `files` so becuz can capture the diff and code comments.
- If you are reversing a past decision, call `supersede_decision` with the old
  decision's id instead of recording a fresh, disconnected one.
- To fix or extend an existing record, use `update_decision`.
- To retire a decision with no replacement, use `deprecate_decision`.
- When the user asks "why did we …?", call `query_decisions` and answer from
  the returned records.

If you prefer not to interrupt flow, batch decisions and record them at the end
of the session -- but never lose them.
<!-- becuz:end -->
