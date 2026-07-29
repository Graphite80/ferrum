# Ferrum domain invariants

The rules the domain enforces mechanically. If code and this document disagree, the code is
authoritative and this document is a bug.

Every invariant below is either enforced by a type, a thrown error, or a test named in the
"Enforced by" line. An invariant with no enforcement is an intention, not an invariant, and is
marked as such.

---

## 1. What counts as a comparable set

Two sets may be compared — for progression, e1RM, personal records, or trend lines — only when
their `comparisonSignature` values are byte-identical.

The signature is a canonical delimited string, not a hash:

```text
v1|ex:<definitionId>|eq:<equipmentKey>|ls:<loadSemantics>|lem:<loadEntryMode>
  |rcm:<repCountMode>|lat:<laterality>|rom:<romVariant>|tempo:<tempoVariant>
```

A hash would be shorter and completely opaque. When two sets that should compare equal do not,
the difference has to be visible in a debugger and in an exported CSV without a lookup table.
`describeIncomparability(a, b)` returns the differing facets.

`equipmentKey` is the equipment instance id, **or** the user-declared `equivalenceGroupId` when
one is set. Declaring two machines equivalent is the only mechanism that merges their histories.
An unknown instance (`eq:-`) is its own bucket and never silently merges with a known one.

Consequences, all intended:

- a paused bench press never compares to a touch-and-go bench press
- two different Smith machines never compare
- a deep squat never compares to a partial
- a banded pull-up never compares to a weighted pull-up
- dumbbells entered per-hand never compare to dumbbells entered as a total

**Enforced by** `comparisonSignature()` in `packages/domain/src/comparison.ts`; signature version
is `COMPARISON_SIGNATURE_VERSION` and any change to the facet list is a breaking version bump.

---

## 2. Revision versus new definition

Editing an exercise definition falls into exactly one of three outcomes, decided by
`classifyDefinitionChange()`.

**New revision** — history stays comparable. Permitted fields: name, aliases, description, cues,
default rest, default increment, muscle roles, movement id.

**New definition required** — history is NOT comparable and the edit is refused at the domain
level:

`loadSemantics`, `loadEntryMode`, `repCountMode`, `laterality`, `rangeOfMotionVariant`,
`tempoVariant`, `equipmentType`, `bodyweightFraction`

These are the fields the comparison signature is built from. Changing one in place would silently
re-interpret every set already logged under the old meaning. `reviseDefinition()` throws
`IdentityFieldEditRejected`. The UI offers "create a variation" instead; it must never present an
editor that can overwrite the meaning of history.

**No change** — proposed values are equal to current; revision is not incremented.

**Enforced by** `IDENTITY_DEFINING_FIELDS` and `reviseDefinition()` in
`packages/domain/src/exercise.ts`.

---

## 3. Load semantics

`resolveLoad()` returns a three-way result and there is no fourth option:

| Result                                   | Meaning                          |
| ---------------------------------------- | -------------------------------- |
| `{ kind: 'load', systemKg, calibrated }` | a defensible number              |
| `{ kind: 'not_load_bearing' }`           | time / distance / reps-only work |
| `{ kind: 'indeterminate', reason }`      | we refuse to invent a number     |

`calibrated: false` means the number is a machine's marking, not a measured mass — a stack marked
"50" on an uncalibrated pulley. It may be shown and compared against itself; it may not be
presented as kilograms of force.

Per semantic:

- `external` — the entered load, adjusted by entry mode
- `per_hand` — entered × 2 (two implements)
- `per_side` — entered × 2 + bar mass; **`indeterminate('bar_mass_unknown')`** when the instance
  has no configured bar mass, because a Smith bar is not 20 kg
- `machine_stack` — marking × pulley ratio when known, otherwise the marking with
  `calibrated: false`
- `bodyweight` — bodyweight × `bodyweightFraction`; a push-up is not 100% of bodyweight
- `bodyweight_plus_external` — carried + added (pull-up with a belt)
- `bodyweight_minus_assistance` — carried − assistance, floored at zero
- `band`, `chain` — always `indeterminate`. Stored descriptively, excluded from e1RM, never
  converted to an "equivalent" load

Bodyweight is `null` → `indeterminate('bodyweight_unknown')`. It is never defaulted to 80 kg.

**Enforced by** `resolveLoad()` in `packages/domain/src/load.ts`.

---

## 4. Per-hand and per-side

`loadEntryMode` describes what the **user typed**, not what the system computed.

- `total` — one number for the whole system
- `per_hand` — one dumbbell; system load is 2×
- `per_side` — plates on one side of a bar; system load is 2× + bar
- `added_only` — the external addition to a bodyweight movement

`repCountMode` describes what the user counted:

- `total` — the default for unilateral work as well (see §11)
- `per_side` — reps for one limb; `totalRepsPerformed()` doubles it
- `alternating_total` — alternating reps already summed

Both are identity-defining (§2). A user who switches from logging dumbbells per-hand to logging
them as a total gets a new definition, not a corrupted trend line.

---

## 5. Immutable fields

Once a `SetLogged` event exists, these are fixed for that set and no amendment can change them:

`id`, `sessionExerciseId`, `exerciseRevisionSnapshot`, `prescriptionSnapshot`, `localDate`,
`tzOffsetMinutes`, `sourceDeviceId`, `recordedAt`

`SetAmendedPayload` structurally cannot carry them — the type has no such fields.

`comparisonSignature` _is_ amendable, because correcting which machine you used is a legitimate
after-the-fact fix. It is the one field whose amendment moves a set between comparison buckets,
and amendments are recorded in `projection.amendments` so the move is auditable.

**Enforced by** the shape of `SetAmendedPayload` in `packages/domain/src/events.ts`.

---

## 6. Which operations produce events

Training activity is an append-only event log. Configuration is versioned rows with field-level
LWW. The split is not stylistic: training data must never be lost to a merge, configuration must
converge without user intervention.

Event-producing (15 types): `SessionStarted`, `SessionMetadataChanged`, `ExerciseAddedToSession`,
`ExerciseRemovedFromSession`, `ExerciseReordered`, `ExerciseSubstituted`, `SupersetGroupChanged`,
`SetLogged`, `SetAmended`, `SetDeleted`, `SetRestored`, `SessionFinished`, `SessionReopened`,
`SessionDeleted`, `SessionRestored`.

Additions to this vocabulary keep `EVENT_SCHEMA_VERSION` unchanged but require clients to update
before pulling: an old bundle rejects the unknown type at wire validation and its sync stalls
until the service-worker update is applied.

Two of these are additions to the original plan's list, and both are load-bearing:

- `SetRestored` — the plan requires reversible tombstones (§3.5) and undo on every destructive
  action (§8.3). Without an explicit restore event, "undo a delete" has no deterministic
  representation.
- `ExerciseRemovedFromSession` — removing an exercise you added by mistake, without deleting its
  sets one by one.

Not event-producing: routines, programs, equipment profiles, aliases, preferences, unit settings.
Those are versioned records. Purging a session (§7a) is not event-producing either, and for a
different reason: it destroys log entries rather than adding one.

---

## 7. How deletion is represented

Deletion is a status transition to `'deleted'`, never a removal from the log or the projection.
A deleted set is returned in `projection.deletedSets`, not dropped.

Race resolution, deterministic on every replica:

- **amend then delete** (in HLC order) — the set is deleted and carries the amended values
- **delete then amend** — the amendment applies to the fields, the set stays deleted

Amending a tombstoned set never resurrects it. Resurrection requires `SetRestored`. This is the
one arbitrary choice in the model, and it is arbitrary in the safe direction: a set the user
deleted stays gone until they explicitly say otherwise.

**Enforced by** `packages/domain/src/projection.ts`; the never-lost property is asserted in
`replay.test.ts` — "never loses a logged set".

### 7a. Purge: the one operation that leaves the log

A user who deletes a workout must also be able to destroy it. Purge does that, and it is
deliberately **not** an event type: it removes rows instead of adding them, nothing about it
converges, and replaying it is meaningless. The domain layer therefore does not know it exists —
it lives in storage and sync, and the projection's never-lost property is untouched.

What it costs, and what it buys:

- Only a **deleted** session can be purged. The destructive path is two decisions deep, and the
  irreversible one is never adjacent to Restore in its confirmed state.
- Locally it takes the events, the plan snapshot, the rest timer and the snapshot row in one
  transaction, and writes a **local tombstone** in `purges`. Without that tombstone the next pull
  re-imports the workout and "delete forever" lasts until the next sync.
- Server-side the rows are deleted and one row per aggregate is written to `purged_aggregates`.
  That journal is what other replicas read: it has its own cursor (`purgedAfter`), because the
  events it refers to no longer exist to carry the news.
- A device that has not read the journal yet still holds the session and will push it back. The
  server counts those events as `purged` and refuses them, so the tombstone outranks the push for
  as long as it exists.

**Enforced by** the purge suite in `services/api/tests/api.test.ts`, the purge-propagation tests in
`apps/pwa/tests/unit/sync-client.test.ts`, and end-to-end by
`apps/pwa/tests/e2e/history-delete.spec.ts` and `apps/pwa/tests/e2e/sync.spec.ts` — "erasing on
device A destroys the workout on the server and on device B".

---

## 8. Replay determinism

The same set of events, delivered in any order, any number of times, produces the same projection.

`projectSession()` imposes its own ordering and never trusts arrival order:

1. dedupe by `eventId`
2. total order by HLC, tie-broken by `eventId`
3. apply

Field-level last-writer-wins falls out of the total order for free: an amendment overwrites only
the keys it actually carries, so the last event to mention a field is the one that set it, on
every replica.

**Enforced by** property tests in `packages/domain/tests/replay.test.ts`:
permutation invariance, full-log idempotence, partial-batch-retry idempotence, no set lost,
contiguous exercise ordering, foreign-session rejection.

`generator-coverage.test.ts` asserts the generator itself stays rich enough for those properties
to mean anything. The first version of the generator produced ~12-event sessions and every
property passed while barely touching delete, reorder or superset. That test exists so the suite
cannot quietly go vacuous again.

---

### 8a. One clock per device, not per tab

The device id and the HLC's `(wallMillis, counter)` live in IndexedDB, and `appendEvents` reads
them, advances them and writes the new events inside a **single read-write transaction**.

This is load-bearing, not incidental. The common failure in browser HLC implementations is giving
each tab its own node id: two tabs then produce concurrent events that never order against each
other, and the devices believe they are synced while holding different data — silent divergence
behind a green indicator. Sharing the id through IndexedDB and bumping the clock inside the same
transaction that appends the events makes the browser serialise it for us.

Consequences to preserve:

- never derive a node id per tab, per page load, or from anything in memory
- never read the clock outside the transaction that will use it
- the node id must stay free of the separator used by `encodeHlc` (`:`)

**Enforced by** `apps/pwa/src/db/event-store.ts` and asserted by
`apps/pwa/tests/e2e/multi-tab.spec.ts`, which drives two real tabs against one IndexedDB and
checks that both see the same log, that every event id and order key is unique, that exactly one
device id appears, and that the order keys are strictly increasing.

## 9. Prescription snapshots

A `SetPrescriptionSnapshot` is taken when the session starts and is immutable thereafter. It
records what was asked for: target load, rep range, RIR/RPE, set type, and the rule id and
version that produced it.

Changing a program later never rewrites what a past session was told to do. This is what makes
compliance analysis, recommendation evaluation, and historical replay of the progression engine
possible at all.

A set with `prescriptionSnapshot: null` was unprescribed — ad-hoc work, or imported history. That
is a distinct state from "prescribed and not followed", and analytics must not conflate them.

---

## 10. Bodyweight provenance

`bodyweightKgSnapshot` without provenance is worthless: it makes every bodyweight exercise show
false progression. Every snapshot carries `bodyweightSource` and `bodyweightAgeDays`.

- `measured_today` — evidence
- `interpolated` — evidence, permitted only when the two bracketing measurements are within
  **14 days** of each other
- `last_known` — evidence only while `ageDays <= 30`
- `default_profile` — never evidence

`resolveBodyweight()` returns `qualifiesAsEvidence: false` outside those bounds, and sets so
flagged are excluded from e1RM.

**Enforced by** `packages/domain/src/bodyweight.ts`, constants `MAX_INTERPOLATION_SPAN_DAYS` and
`MAX_EVIDENCE_AGE_DAYS`.

---

## 11. Unilateral exercises default to one row

Logging left and right separately doubles taps and directly contradicts the sub-second logging
target. Default is `repCountMode: 'total'`, one row. Splitting into two sides is an explicit user
action, remembered per exercise. Asymmetry is recorded only when the user asked for it.

**Not yet enforced by code** — this is a UI default, and the UI is a vertical slice. Marked as an
intention until the exercise-level preference exists.

---

## 12. Week boundaries and timezones

Every session stores `tzOffsetMinutes` and a derived `localDate`. Weekly aggregates group by
`localDate`, never by UTC. The week's first day is a user setting (`firstDayOfWeek`).

Changing timezone moves the user, never their history: `toLocalDate()` reads the offset stored on
the record, so a session logged at 23:00 in Berlin stays on that Berlin date forever.

**Enforced by** `packages/domain/src/time.ts`; `startOfWeek()` and `weekKey()` take
`firstDayOfWeek` as a required argument, so no caller can accidentally assume Monday.

---

## 13. Determinism of the domain layer

Domain and progression code must be runnable in Node, a worker, and a browser, and must produce
the same answer every time. They may not read the ambient clock, generate randomness, touch the
DOM, touch storage, or do I/O. Time, ids and randomness are explicit inputs.

**Enforced by** ESLint: `no-restricted-globals` and `no-restricted-syntax` bans on `Date.now()`,
`new Date()`, `Math.random()`, `window`, `document`, `localStorage`, `indexedDB`, `fetch` in
`packages/domain` and `packages/progression-engine`, plus `eslint-plugin-boundaries` preventing
imports from the app layer.

Floating point is a correctness hazard here, not a rounding nicety: `2.5 + 2.5 + 20 !== 25` on
some paths would fork a comparison signature. All loads normalise through integer grams
(`kilograms()`, `grams()`, `sameLoad()`).

---

## 14. Platform constraints that the domain must survive

Verified against live sources in July 2026. These are not domain invariants; they are the reasons
several domain decisions look paranoid.

**Screen Wake Lock in an installed PWA requires iOS 18.4+.** From iOS 16.4 to 18.3.1 the promise
resolved with a valid `WakeLockSentinel`, `released === false`, and the screen dimmed anyway
(WebKit bug 254545). Feature detection cannot see this. Detection must be by iOS version, and
older devices get an honest hint to set auto-lock to Never. The first request must come from a
user gesture — WebKit requires transient activation even though the spec does not; authorization
is then sticky for the document, so re-acquiring on `visibilitychange` works.

**An in-flight `IDBTransaction` stops being active when the process is suspended** (WebKit bug
202705). Backgrounding the app mid-write can lose the transaction. Therefore: one short
transaction per user action, committed immediately, never a transaction left open across taps.
IndexedDB errors are a normal path with a retry, not an assertion (bug 235579).

**Background Sync does not exist on iOS and is not planned** — WebKit's standards position has
been unset for seven years with privacy and power concerns recorded. Sync must be driven by app
start, successful local mutation, `online`, `visibilitychange`, window focus, and manual retry.
Background Sync is progressive enhancement for Chromium only.

**Web Push cannot wake the app to sync.** `notificationclick` does not fire when the PWA is closed
(WebKit bugs 282935, 268797). Push is a way to show the user text, best-effort. It is not a rest
timer and not a sync trigger.

**Cross-domain navigation exits standalone mode** and cookies are not shared with Safari. Any
third-party OAuth redirect drops the user into the browser and loses the session. Authentication
must stay on our own origin.

---

## 15. Progression

The progression engine turns comparable history into one explainable recommendation. Four
commitments hold across every policy (`double_progression`, `linear_load`, `top_set_backoff`),
and each is a behaviour, not an aspiration.

**A single bad session never reduces load or sets.** Every reduction path requires at least two
failing sessions in a row: `linear_load` raises a rule's own `failuresBeforeBackoff: 1` to the
engine floor of two, and `double_progression` demands three at the same load unless total reps
also collapsed. One bad day produces `repeat` or `hold`, never `reduce_*`. The replay harness
recounts failing runs from the rule itself, so the number in its report is not produced by the
code it checks.

**Enforced by** the "one bad session never reduces anything" property in
`packages/progression-engine/tests/properties.test.ts` and by
`reductionsAfterSingleBadSession === 0` over the real fixture in
`packages/progression-engine/tests/replay-harness.test.ts`.

**Missing effort never reads as compliance.** A session logged without RPE or RIR gets
`effortVerdict === 'unknown'`, which forces confidence to `low` and blocks `increase_load` in
every policy. Silence about effort is missing evidence, not proof of easy work.

**Enforced by** the "missing effort never reads as compliance" property in
`packages/progression-engine/tests/properties.test.ts`.

**Back-off loads anchor to the load actually lifted, never the load prescribed.** A top set
taken 5 kg under the plan makes every prescribed back-off percentage wrong by the same 5 kg, so
`top_set_backoff` computes back-off sets from the performed top set.

**Enforced by** "anchors the back-off to the performed top set, not the prescribed target" in
`packages/progression-engine/tests/top-set-backoff.test.ts`.

**`insufficient_data` instead of guessed loads.** When no comparable set survives exclusion —
nothing logged, all warmups, pain-flagged work, or an indeterminate load such as a per-side bar
with no configured bar mass — every policy returns `insufficient_data` with no proposed
prescription. Guessing a load from no comparable set is the one thing the engine will not do.

**Enforced by** the insufficient-data cases in
`packages/progression-engine/tests/double-progression.test.ts`,
`packages/progression-engine/tests/linear-load.test.ts` and
`packages/progression-engine/tests/top-set-backoff.test.ts`, and by the pendulum-squat case in
`packages/progression-engine/tests/replay-harness.test.ts`.

---

## Open items

- §11 is an intention, not an enforced invariant.
- Muscle credit policy (`MuscleCreditPolicy`) is specified in the plan but not yet implemented;
  anatomical roles exist, the weighting heuristic does not.
- The sync wire protocol (`server_sequence` cursor, push/pull, idempotency on
  `user_id + event_id`) is designed in the plan and typed in the event envelope, but no
  `packages/sync-protocol` exists yet. Phase 4.
