# CLAUDE.md

Guidance for Claude Code working in this repository. Inherits everything in `../CLAUDE.md`; the
sections below either add detail or explicitly override it.

## What this is

Ferrum is a local-first strength-training logger that separates **what was prescribed** from **what
happened**, and produces an explainable next decision from the difference.

The product bar, in order: logging a set is faster than the incumbent; completed workout data is
practically impossible to lose; the program model reflects what was actually prescribed; the
recommendation is reproducible from its inputs; and the whole thing stays valuable with social
features, wearables, AI and payment entirely switched off.

Read `docs/INVARIANTS.md` before changing anything in `packages/domain`. It is the contract.

## Layout

```text
packages/domain              zero-dependency core: events, projection, load semantics, HLC, time
packages/exercise-library    93 curated definitions (YAML -> generated TS), ranked search
packages/exercise-media      technique diagrams: stick rig + IK, per-movement poses, muscle map
packages/importers           life-as-code JSON, Hevy CSV, Strong CSV, Telegram shorthand
packages/progression-engine  three versioned deterministic policies + historical replay harness
packages/sync-protocol       push/pull wire format: validation, cursors, idempotency keys
services/api                 Hono + Postgres: sync endpoints, Telegram bot, serves the PWA
apps/pwa                     React 19 + Vite + Dexie offline logger (Hevy-grade loop)
fixtures/                    real training history, the source of truth for edge cases
docs/INVARIANTS.md           the domain contract
Dockerfile                   one container: API + static PWA, GIT_SHA sed in builder stage
```

`packages/program-engine`, `packages/analytics`, `packages/ui` and `services/worker` are in the
plan but deliberately **not created yet** — an empty package that builds nothing is dead weight
that reads as progress. Create each when it has real content (phase 5).

## Commands

```bash
npm run type-check          # tsc over every package and the app
npm run test                # vitest: domain + library + importers
npm run lint                # prettier --check
npm run lint:js             # eslint
npm run dev                 # vite dev server for apps/pwa

cd apps/pwa && npm run build
cd apps/pwa && npx vite preview --port 4173 --strictPort --host 127.0.0.1
cd apps/pwa && CI=1 BASE_URL=http://127.0.0.1:4173 npx playwright test   # workout-loss drills

npm run generate --workspace @ferrum/exercise-library   # after editing src/data/*.yaml

# Judge a pose by eye, not by trigonometry: renders every animation to one static page.
npx tsx packages/exercise-media/scripts/render-gallery.mjs /tmp/gallery.html   # or `0:10` to page

npm run dev --workspace @ferrum/api                     # needs DATABASE_URL; bot needs
                                                        # TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET
docker build -t ferrum --build-arg GIT_SHA=$(git rev-parse HEAD) .
```

Packages are consumed as **raw TypeScript** (`exports` points at `src/index.ts`); there is no build
step for libraries and no `dist`. Vite and Vitest resolve them through workspace symlinks, and
`tsc --noEmit` at the root type-checks everything at once. This deliberately avoids the
"must build core before the dev server works" trap.

## Testing policy — a documented exception to the workspace rule

The workspace `CLAUDE.md` bans unit tests. This repo carves out exactly one exception, and names
its boundary:

**Property-based and example tests of pure domain functions are allowed**, because the domain layer
is deterministic by construction — no clock, no storage, no I/O, enforced by ESLint. These tests use
real implementations and real data, never mocks or stubs. Everything with I/O is covered by
integration or end-to-end tests only. Mocking frameworks stay banned.

Two suites carry the product's core promises and must never be weakened:

- `packages/domain/tests/replay.test.ts` — replay determinism, idempotence, no set ever lost.
- `apps/pwa/tests/e2e/workout-loss.spec.ts` — the vertical path survives reload, offline, undo.

`packages/domain/tests/generator-coverage.test.ts` guards the generator that feeds the property
suite. The first version of that generator produced ~12-event sessions and every property passed
while barely exercising delete, reorder or superset. If you touch the arbitrary, that test is what
stops the suite from going quietly vacuous.

`packages/exercise-media/tests/coverage.test.ts` plays the same role for the technique diagrams:
it asserts every exercise resolves to a pose, stays inside its canvas, actually moves, and shades
every primary mover. It cannot see whether a pose looks _right_ — that is what the gallery script
is for, and a new movement family is not done until it has been looked at.

## Platform constraints that shaped the code

Verified July 2026. Do not "simplify" the code that works around these.

- **Wake Lock in an installed PWA needs iOS 18.4+.** On 16.4-18.3.1 the promise resolves with a
  valid sentinel and the screen dims anyway (WebKit 254545). Feature detection cannot see it, so
  `platform/wake-lock.ts` sniffs the iOS version and tells the user the truth. The first request
  must come from a user gesture; authorization is sticky afterwards.
- **An in-flight IDBTransaction dies when the process is suspended** (WebKit 202705). Every append
  is one short transaction that commits before the UI acknowledges the set. Never hold a
  transaction open across taps.
- **Background Sync does not exist on iOS and is not planned.** Sync must be driven by app start,
  local mutation, `online`, `visibilitychange`, focus and manual retry.
- **Web Push cannot wake the app**; `notificationclick` does not fire when the PWA is closed. Push
  is not a rest timer and not a sync trigger.
- **Cross-domain navigation exits standalone mode** and cookies are not shared with Safari, so
  authentication must stay on our own origin — no third-party OAuth redirect.

The rest timer is always derived from `endsAt - now`. `setInterval` is a repaint trigger, never the
source of truth.

## Git

Work on `main`, commit and push directly. Conventional commits, sentence-case subject, scope from
`commitlint.config.js`. `pre-commit` runs fast checks; `pre-push` runs tsc, eslint and vitest.

## Deployment (live)

Running at `ferrum.nikolay-eremeev.com`; ArgoCD app `ferrum-production`, namespace
`ferrum-production`, image `git.nikolay-eremeev.com/nikolay-e/ferrum:main-<sha7>`. Push to `main`,
Argo Workflows builds, the `ferrum-production` ImageUpdater CRD bumps the tag, ArgoCD syncs; the
whole loop takes about ten minutes. Apps in this cluster contain **no CI config at all**: the
contract is a root `Dockerfile` plus a Forgejo push webhook. The pieces, for when one needs
repairing — all of them already exist in `~/gitops`:

1. Push to `https://git.nikolay-eremeev.com/nikolay-e/ferrum.git`, create the push webhook (Gitea
   type) to `http://forgejo-eventsource-svc.argo-events.svc.cluster.local:12000/push`.
2. `gitops/kubernetes/ci/ci-platform/sensor-ferrum-image.yaml` (copy `sensor-hidden-gem-image.yaml`)
   plus an entry in that directory's `kustomization.yaml`. Image tag is `main-<sha7>`; the only
   build arg passed by `app-image-ci` is `GIT_SHA`.
3. `gitops/kubernetes/helm-charts/ferrum/` — copy hidden-gem's shape, which is the complete one
   (it ships `templates/namespace.yaml` and `templates/networkpolicy.yaml`; pflegescore omitted
   both and had to be patched afterwards).
4. `gitops/kubernetes/argocd/argocd-image-updater/image-updaters.yaml` — append an `ImageUpdater`
   CRD. The `argocd-image-updater.argoproj.io/*` annotations described in the workspace CLAUDE.md
   are documentation only; the CRD is the live mechanism. `allowTags` is
   `regexp:^main-[a-f0-9]{7}$` — seven hex, not forty.
5. Register in `simple-apps-applicationset.yaml`, add the namespace to the `network-policies`
   chart values, add DNS in `terraform/dns.tf`, and copy `forgejo-registry.enc.yaml` into a
   per-app secrets directory.

Postgres, when phase 4 needs it, is a role plus a `Database` CR on the shared CloudNativePG
cluster, not a new instance.

## Open work

- e1RM with uncertainty; the muscle credit policy.
- Telegram bot v2 gated on measured usage (ANALYSIS protocol, Final Synthesis step 5): live
  rest-timer pushes need workout events flowing server-side mid-session; the current bot is
  read-mostly + importer by design.
- Spike A on a real iPhone. Nothing in this repo has run on iOS yet, and the wake-lock and
  storage-eviction behaviour is the one thing that cannot be verified from a desktop — now also
  inside the Telegram webview.
