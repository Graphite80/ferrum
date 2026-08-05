# Ferrum

A local-first strength-training logger that records what happened, remembers what was prescribed,
and explains its next suggestion.

Not a coach, not a dashboard. A log that is faster than the one you use now, that will not lose
your workout, and whose recommendations you can audit.

## Status

Early. The domain core, the offline logger, the exercise library and sync work; programs and the
recommendation engine are not finished. It runs at `ferrum.life-as-code.com` and signs in with a
life-as-code account — there is no password of its own. Nothing here has run on a real iPhone.

## What works today

- Start a routine, log prefilled sets in one tap, rest timer, finish, history — entirely offline.
- Every mutation is an append-only event; the session is rebuilt by replaying them. Reloading,
  going offline, force-quitting or undoing does not lose a completed set.
- 118 curated exercise definitions with honest load semantics: a push-up is not 100% of bodyweight,
  a Smith bar is not 20 kg, and a cable stack marked "50" is a marking rather than a mass.
- Import from a personal training database, Hevy CSV, Strong CSV and Telegram shorthand.
- Sync across devices against your life-as-code account, and only that account: history flows in
  on first sign-in and finished workouts flow back.

## Requirements

Node 22+, npm 10+.

## Getting started

```bash
npm install
npm run type-check
npm run test
npm run dev            # http://localhost:5173
```

The app syncs to the origin it is served from and nowhere else, so anything behind
sign-in needs the API answering on that origin. In development the Vite server
proxies the API paths to `dev-server.ts` on port 3100:

```bash
npm run dev --workspace @ferrum/api    # in a second terminal
```

Build and preview the installable app:

```bash
cd apps/pwa
npm run build
npx vite preview --port 4173 --strictPort --host 127.0.0.1
```

Run the workout-survival end-to-end drills against that preview:

```bash
cd apps/pwa
BASE_URL=http://127.0.0.1:4173 npx playwright test
```

## Design commitments

**Prescription and fact are separate records.** What a program asked for is snapshotted when the
session starts and never rewritten, so compliance, recommendation quality and history stay
answerable questions.

**Two sets are only compared when they mean the same thing.** A paused bench press does not compare
to a touch-and-go one, a deep squat does not compare to a partial, and two different machines do
not compare until you say they do.

**The app refuses to invent numbers.** Band and chain resistance, an uncalibrated pulley, an
unknown bar mass and a stale bodyweight all produce an explicit "cannot determine" rather than a
plausible figure.

**No single readiness score.** Sleep, HRV and resting heart rate are shown as named signals with
their own baselines. Training-load trends are described, never labelled safe or dangerous.

**Your data leaves with you.** JSON and CSV export, and an import that reports every row it could
not read instead of dropping it silently.

## Known platform limits

An accurate rest-timer alert while the screen is locked is **not possible in a web app** on iOS and
is not promised. During a workout the screen is kept awake instead, which costs battery. On iOS
below 18.4 an installed web app cannot keep the screen awake at all — the app detects this and says
so rather than pretending.

Background sync does not exist on iOS. Data syncs when the app is open.

## Documentation

- `docs/INVARIANTS.md` — the domain contract: what is comparable, what is immutable, how deletion
  and replay behave.
- `CLAUDE.md` — architecture and development workflow.

## Licence

Not yet chosen. All rights reserved for now.
