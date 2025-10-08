# Deduplication Deep Dive & Simplification Blueprint

> Goal: challenge the default assumption that we _must_ deduplicate, surface the real-world risks, and chart a lean path forward that honours the “keep it simple” mandate without walking blindly into spammy duplicates.

---

## 1. Current State: What We Actually Have

| Aspect        | Details                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| Trigger       | GramJS `NewMessage` events (per source channel)                                       |
| Guard         | Monotonic message ID check → `Map<sourceId, lastMessageId>` drops `newId <= lastSeen` |
| Cleanup       | None (Map grows by at most one entry per source channel)                              |
| Observability | "Duplicate message" debug log when detected                                           |
| Persistence   | None (Map clears on process restart)                                                  |

**Implementation note:** After removing the heavyweight LRU cache (2024-10), we adopted Option B from this plan: a minimal last-ID guard that leverages Telegram's strictly-increasing message IDs. This prevents MTProto retry bursts from duplicating messages to targets while keeping complexity minimal (~7 lines).

---

## 2. Where Could Duplicates Come From? (Reality Check)

| Scenario                                 | Likelihood                       | Impact if dedupe removed                    | Notes                                                                                                                 |
| ---------------------------------------- | -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **GramJS retransmit after flaky ack**    | Low (requires poor connectivity) | Same message forwarded twice within seconds | GramJS doc notes MTProto can replay updates when the client reconnects mid-ack. Happens, but rare in stable networks. |
| **Telegram server replays after resume** | Very low                         | Duplicate(s) shortly after reconnect        | Telegram’s `pts/seq` tracking already reduces duplicates unless our client loses state.                               |
| **User re-posts manually**               | High (people repost)             | Not a duplicate in protocol terms           | Dedupe _will not help_; IDs differ.                                                                                   |
| **Albums / grouped media**               | Medium                           | We already forward each message separately  | Album messages share a `groupedId` but distinct message IDs. Dedupe is irrelevant.                                    |
| **Edit events**                          | Medium                           | N/A                                         | Edits arrive on a different update type that we ignore.                                                               |
| **Process restarts**                     | Guaranteed                       | Duplicate after restart                     | Cache can’t help; it starts empty.                                                                                    |

**Inference:** Any guard (map, LRU, etc.) mainly protects against MTProto retry bursts. For the typical replicator (stable network, single process), this is a rare edge case.

---

## 3. Cost of the Old LRU (Why “Over-Engineering” Felt Real)

| Cost Surface              | Today’s Reality                                                   | Opportunity if removed/simplified                   |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| **Code paths**            | Custom `LRUCache`, timers, stats, log plumbing                    | Collapse into a few lines (or nothing)              |
| **Operational brainload** | Need to remember TTL, cleanup, memory bounds, logs                | Zero knobs → less to explain to teammates/operators |
| **Telemetry noise**       | Duplicate logs triggered even under test (seen during `npm test`) | Cleaner test output; fewer false alarms             |
| **Performance**           | Micro hit per message (Map operations) + cleanup loops            | Slight CPU drop; deterministic behaviour            |
| **Bug surface**           | TTL bugs, memory growth, inconsistent stats                       | Hard to misconfigure if the feature doesn’t exist   |

That LRU made sense when we only watched one channel and didn’t want to flood from network hiccups. With multi-source support and a “simple by default” philosophy, the weight became obvious—hence the pivot to the lean map guard.

---

## 4. Threat Modelling Without Dedupe

Think like an operator: _What is the worst that happens if we delete `isMessageProcessed` tomorrow?_

1. **Burst duplicates** – e.g., 3 copies of the same post arrive within ~10 seconds due to a reconnect. All targets receive all copies. Most channels tolerate the occasional double send, but some automation might not.
2. **Downstream ripple** – If a target channel fans out to integrations (Slack, email), duplicates may annoy humans or trigger duplicate tickets. Severity depends on the downstream tolerance.
3. **Reputation** – Channels with strict posting discipline may dislike re-sends (e.g., regulated comms). Might be a non-starter without a mitigation.

No other catastrophic effects. There’s no risk of data loss, security issues, or state corruption.

---

## 5. Alternative Guards (All Simple by Design)

| Option                                        | Mechanics                                              | Pros                                                | Cons                                                          |
| --------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------- |
| **A. Kill dedupe entirely (pure KISS)**       | Remove the guard and let every message through         | Absolute simplicity                                 | Rare duplicate bursts might leak through                      |
| **B. Keep the last-ID guard (current state)** | `Map<sourceId, lastMessageId>`; drop `newId <= seenId` | 5–10 LOC, no timers, respects monotonic message IDs | Doesn’t catch replays that jump _forward_ in ID (theoretical) |
| **C. Reintroduce a sliding window/LRU**       | Remember a short window of IDs per source              | Strongest defence against bizarre replays           | Brings back cleanup, tuning, and extra moving parts           |

**Telegram fact check:** Message IDs inside a channel are strictly increasing integers. Even album parts increase monotonically. Therefore, Option B—the approach we use today—is safe for the current use cases.

---

## 6. Data-Driven Path to a Decision (Ultrathink Roadmap)

Even when we trust theory, it’s smart to gather _our_ evidence:

### Phase 1 – Instrument (0.5 day)

- Add an env flag `DEDUP_TRACE=true` that logs `sourceId`, `msgId`, and whether the guard blocked it (without changing behaviour yet).
- Deploy to staging or run locally with `LOG_LEVEL=debug` and record logs for a few hours of normal traffic.

### Phase 2 – Shadow Run (1–3 days)

- Add a second env flag `DEDUP_BYPASS=true` that skips updating the map but still logs would-be suppressed keys.
- Observe log patterns. If duplicates appear, capture:
  - Time delta between repeats
  - Whether the client was reconnecting (`GramJS` debug logs can show) or network issues exist
  - Downstream reaction (if any)

### Phase 3 – Evaluate Outcomes

- **No duplicates seen:** consider Option A (pure simplicity) or keep Option B if you like the low-cost safety net.
- **Occasional duplicates (e.g., 1/day):** decide if downstream can stomach them. If not, stay with Option B.
- **Frequent duplicates:** move to Option C if the map proves insufficient.

### Phase 4 – Implement & Cleanup

- Option A: remove the map, related logs, and docs describing dedupe.
- Option B: keep the map (what we ship today) and ensure docs reflect the behaviour.
- Option C: design a small sliding window or resurrect the LRU utility, then document the extra maintenance.

### Phase 5 – Monitor (1–2 weeks)

- After the change, watch for user complaints, and optionally add a lightweight `duplicateSuspect` counter when `msgId <= lastSeen` (only for Option B/C).

---

## 7. Recommendation Snapshot

1. **Default stance:** keep the current Option B guard—it delivers simplicity with a bit of safety.
2. **Safety net:** if duplicates are negligible, Option A is viable; if they hurt, be ready to escalate to Option C.
3. **Document the residual risk:** whichever path chosen, record in README that duplicates may occur after restarts or network retries so operators know what to expect.

---

## 8. Additional Considerations (Thinking Past the Defaults)

- **Multi-process scale-out:** If the replicator ever runs in parallel, all in-memory approaches fail. Dedupe would then need Redis/postgres etc.—far more complex. Because we’re intentionally staying simple, embrace at-most-once semantics and document the limitation instead of half-measures.
- **Backpressure interplay:** If dedupe removes duplicates immediately, it slightly helps when the sender is throttled. Removing dedupe means the sender must handle the full load (but Telegraf already retries). Minor effect.
- **Testing discipline:** Current unit tests (notably `filter.test.js`) trigger dedupe logs during runs, creating noise. Removing dedupe avoids spurious log assertions when adding more tests.
- **Operations:** Some teams rely on the duplicate counter for diagnosing network flaps. If we remove the feature, provide guidance on using GramJS debug logs or an external metric instead.
- **Future toggles:** Consider exposing a single env `DEDUP_STRATEGY=none|last-id|lru` if you foresee needing to flip behaviour without redeploy. Default to `none` to keep the code path straightforward.

---

## 9. TL;DR for Decision Makers

- **Is dedupe strictly necessary?** No. It mitigates a rare class of retries but doesn’t guarantee uniqueness, especially across restarts.
- **What happens if we remove it?** Worst-case: occasional duplicate posts during transient network hiccups. For most channels, acceptable. For strict ones, use a tiny last-ID guard instead of the heavyweight LRU.
- **What’s the simplest sustainable setup?** Stick with the per-source last-ID map by default; drop it only if duplicates are acceptable.

---

### Next Actions Checklist

- [ ] Add instrumentation flag(s) and run a short experiment to confirm duplicate frequency.
- [ ] Choose `DEDUP_STRATEGY` (`none` vs `last-id`) based on evidence and tolerance.
- [ ] Implement change, update docs, and prune unused utilities.
- [ ] Monitor for a week, then cement the simplified design.

“Simple” doesn’t mean reckless—it means understanding the real risks, cutting the fluff, and keeping knobs only where they pay rent.
