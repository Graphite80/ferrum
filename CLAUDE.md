# CLAUDE.md

Guidance for Claude Code working in this repository. Inherits everything in `../CLAUDE.md`; the
sections below either add detail or explicitly override it.

## Ultimate Goal

**THIS IS THE MOST IMPORTANT SECTION IN THIS FILE.**

The ultimate goal is a guiding star — not necessarily achievable, but the direction we always move toward:

**Never lose a set, and turn what actually happened in the gym into the next decision worth making.**

Every decision, every feature, every change must be evaluated against this goal. Code is a means, not the goal.

The gap between what was prescribed and what happened IS the signal. A logger that
forgets, or that argues with itself after a phone dies mid-workout, has failed at the only
job that matters.

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
packages/exercise-library    118 curated definitions (YAML -> generated TS), ranked search
packages/exercise-media      technique diagrams: stick rig + IK, per-movement poses, muscle map
packages/importers           life-as-code JSON, Hevy CSV, Strong CSV, Telegram shorthand
packages/progression-engine  three versioned deterministic policies + historical replay harness
packages/sync-protocol       push/pull wire format: validation, cursors, idempotency keys
services/api                 Hono + Postgres: sync endpoints, Telegram bot, serves the PWA
apps/pwa                     React 19 + Vite + Dexie offline logger (Hevy-grade loop)
apps/android-twa             Android shell: Trusted Web Activity around the deployed PWA
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

cd apps/android-twa && ./dev-install.sh    # signed APK onto the connected device (--build-only)

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
- **Background Sync does not exist on iOS and is not planned.** Sync is driven by app start, local
  mutation (debounced), `online`, `visibilitychange`, `focus`, a five-minute poll while the page is
  visible, and an exponential backoff after failure. There is no manual retry and no control to
  press: the lifter cannot help, and a button during an outage only produces another failure. The
  one thing the button did that ambient triggers could not was escape an armed backoff, so
  `online` now clears it — a network moving from down to up makes every failure counted so far
  evidence about a world that is gone. `visible`, `focus`, `poll` and `append` stay suppressed
  while a backoff is armed, or every app switch would hammer a server that is already down.
- **Web Push cannot wake the app**; `notificationclick` does not fire when the PWA is closed. Push
  is not a rest timer and not a sync trigger.
- **Cross-domain navigation exits standalone mode** and cookies are not shared with Safari, so
  authentication must stay on our own origin — no third-party OAuth redirect. This is why ferrum
  lives at `ferrum.life-as-code.com` and signs in from a cookie rather than a redirect: see
  "Single sign-on" below.

The rest timer is always derived from `endsAt - now`. `setInterval` is a repaint trigger, never the
source of truth.

## One sync target, never a typed one

The app syncs to the origin it was served from and to nothing else. There is no server field: every
sync request is a relative path, so it resolves against the page's own origin by construction. There
is no token field either — Settings offers exactly one way in, "Sign in with life-as-code", because
that is the only way a human can get a credential. A field for pasting one outlived its purpose the
moment SSO landed: nobody outside this repo can obtain a token, and a text input that accepts one is
a way to attach the wrong account, or somebody else's, to a device.

The e2e suite still needs a token — `/dev/token` is how it gets a synced account with no hub in the
picture — so it writes the same `settings` record `saveSyncConfig` writes and reloads
(`apps/pwa/tests/e2e/sync-token.ts`). The reload is the point rather than a workaround: a linked
device reads its token at start-up on every launch, so installing one this way exercises the
production path instead of a control that only tests could reach.

This is not a simplification of a feature that worked — a custom server address never could work
for the parts that matter. The hub's identity cookie is same-origin, the first-sign-in backfill and
the return leg both run inside this API, and a second address to type is a second thing to get
wrong. Two consequences worth keeping in mind:

- **`npm run dev` proxies the API paths** (`/health /ready /auth /dev /sync /link /telegram`) to
  `dev-server.ts` on port 3100, because a Vite server that answers only for assets can no longer
  reach any sync path at all.
- **The e2e sync drills are served by the API itself** (`STATIC_DIR=apps/pwa/dist`), the shape
  production uses. `mountStaticFallback` is exported separately from `createApp` for exactly this:
  it answers for everything, so `dev-server.ts` must register `/dev/bot-import` before it.

## No account by default

Ferrum starts with no account and contacts no server. The log lives in this browser (IndexedDB via
Dexie — an append-only event log, which `localStorage` could hold neither durably nor at size), and
a lifter who never opens Settings has a complete, working app that has never made a network call
beyond fetching its own assets.

Syncing with life-as-code is something they ask for, once, in Settings. **Start-up must never trade
the hub's identity cookie for a token.** The cookie is ambient — it rides along on every request to
this origin — so spending it at boot would enrol whoever happens to be logged into the hub in the
same browser, link an account nobody chose to link, and pull that person's five years of history
onto a device they never claimed. `initSync` therefore only reads the token already stored; a device
that has been linked keeps syncing across restarts without asking again, and one that has not stays
local. `apps/pwa/tests/e2e/hub-sso.spec.ts` asserts the boot path issues no `/auth/sso` call at all,
which is the property, rather than merely asserting no token was stored.

The same number means two things, so History says which: with sync configured, "N events not yet
synced" is a backlog; without it, "N events stored on this device" — because there is nothing for an
event to be "not yet" synced to, and the old wording read as a fault on an app working as intended.

## Single sign-on

Once a lifter asks for it, this is the mechanism. life-as-code is the hub and owns the human's
account; ferrum is one of its apps and holds no password. The hub sets a second cookie next to its own session — `__Secure-lac-sso`, scoped
`Domain=life-as-code.com`, HttpOnly, SameSite=Lax — carrying an HS256-signed statement of who is
logged in (`iss=life-as-code`, `aud=life-as-code-apps`, 12h). The hub's own session cookie keeps its
stricter `__Host-` prefix and is never shared.

Because ferrum is served from a host under the same registrable domain, that cookie arrives on every
request to this origin. `POST /auth/sso` verifies it offline against `SSO_SIGNING_KEY` — no callback
to the hub, so a hub outage cannot lock a lifter out mid-session — maps `sub` onto a row in
`user_identities` (provider `life-as-code`) and mints an ordinary ferrum bearer token. The PWA does
this once, when the lifter asks for it in Settings — never on start-up.

Three properties this rests on, none of them incidental:

- **No redirect anywhere.** A top-level hop to the hub would exit standalone mode on iOS and land in
  a browser view with a different cookie jar — the constraint above.
- **`x-ferrum-sso: 1` is required.** The cookie is ambient, so a hostile page could aim a form POST
  at `/auth/sso`; a custom header cannot be forged cross-origin without a CORS preflight this API
  never answers. SameSite=Lax is the second lock.
- **A one-day cap on ticket lifetime is enforced by the verifier**, not just by the issuer. A stolen
  ticket is a login; the reader is what bounds the damage.

Without `SSO_SIGNING_KEY` the endpoint is not mounted at all, so Sign in reports that it could not
reach the hub and the only way to a synced account is `/dev/token` written straight into storage —
which is what local development and the e2e suite run against.

## The history backfill

Signing in gives a lifter an account. Without this it is an _empty_ one, which reads as "the app
lost my training" rather than "the app is new" — so the first sign-in pulls the history the hub
already holds and replays it through the same importer the Telegram path uses.

This runs on the sign-in the lifter asked for, never on a cold start — see "No account by default".

`/auth/sso` → `hub-import.ts` → `GET {HUB_API_URL}/api/federated/strength-sets`, presenting the
same ticket ferrum just verified. The hub verifies it too and answers with the sets of _that
subject only_ — the user id is never an input. The rows come back in `@ferrum/importers`'
`life-as-code:get_strength_sets` shape, which is the hub's own column names.

- **Only into an empty account.** The importer is idempotent, but a device that has already logged
  something owns its history and must not have the hub's copy replayed over it.
- **Inline, not a background job.** Measured at 1.34s for 5,904 sets. A background job that failed
  would leave the app showing an empty account with nothing to retry against.
- **A hub outage costs nothing.** The token is minted first; a failed backfill answers
  `backfill.outcome: "unavailable"` and sign-in still succeeds.
- **`HUB_API_URL` is cluster-local**, so the call never leaves the cluster. It needs BOTH halves of
  the NetworkPolicy pair in gitops (`crossNamespaceEgress` on ferrum, `crossNamespaceIngress` on
  life-as-code); an egress allow alone gives a connection that times out rather than one refused.

Measured against the real five-year history: 5,902 of 5,904 rows import, 0 field mismatches, volume
matching to the kilogram. The 2 that do not are one Pull Up logged as 0 reps × 0 kg — no
measurement, so there is no set to make.

## The return leg

The backfill alone would make this a one-way street: the hub is where training data is analysed, so
a workout logged here has to arrive there or the hub goes stale the moment a lifter stops using the
importer that used to feed it.

`POST /sync/push` → `hub-export.ts` → `POST {HUB_API_URL}/api/federated/strength-sets`, after the
batch is durable and never inside its transaction. The hub upserts on
`(user_id, date, exercise, set_index)` — the same key its Hevy sync uses — so a re-push corrects a
row instead of duplicating it.

- **Only finished, undeleted sessions travel.** A session still being logged would arrive a set at
  a time and read there as a string of tiny workouts.
- **A separate audience.** The read ticket is handed to the browser as a cookie and therefore leaves
  this domain, so it must not also authorise a write: ferrum mints `aud: life-as-code-ingest`,
  `iss: ferrum`, 5 minutes, over the same shared key. The hub checks both, and a read ticket
  presented to the write endpoint is a 401.
- **Only a linked account has anywhere to push.** The hub subject comes from `user_identities`; a
  bootstrap-only account reports `not-linked`, which is not an error.
- **A hub outage never costs a set.** The export runs after the push has been stored and its failure
  is logged (`hub_export_unreachable`), never returned — the workout is already safe.
- Warmups are sent marked rather than dropped, because the hub excludes them from its own analysis
  and sending them as working sets would inflate every volume figure it computes.

The hub's `DataSource` gained a `ferrum` member for this, so its sync-status surface can tell these
rows apart from Hevy's.

## The Android shell

`apps/android-twa` is a Trusted Web Activity pointed at `https://ferrum.life-as-code.com`, so an
Android lifter gets a launcher icon and no browser chrome while the logger, the event log and the
sync path stay exactly the ones the PWA already ships. There is no second implementation and
nothing Android-specific in `packages/` — which is the point: an Android bug here is a PWA bug.

The whole thing hangs on a Digital Asset Links pair, and it fails in one direction only. The site
half is `apps/pwa/public/.well-known/assetlinks.json`, naming the APK's signing certificate; the
app half is `assetStatements` in `app/src/main/res/values/strings.xml`, naming the site. When they
do not match, nothing errors — the app opens as a Custom Tab with a URL bar across the top.

A missing site half is the trap: `/.well-known/assetlinks.json` is not an API prefix, so the
single-page fallback answers it with `index.html` and a **200**. Only the content type tells the
two apart, which is what `apps/pwa/tests/e2e/pwa.spec.ts` asserts. Details, and the key discipline
that keeps upgrades installing in place, in `apps/android-twa/README.md`.

## Git

Work on `main`, commit and push directly. Conventional commits, sentence-case subject, scope from
`commitlint.config.js`. `pre-commit` runs fast checks; `pre-push` runs tsc, eslint and vitest.

## Deployment (live)

Running at `ferrum.life-as-code.com` (moved off `ferrum.nikolay-eremeev.com` on 2026-07-30, which
now 301s there via a Cloudflare page rule in `gitops/terraform/redirects.tf`); ArgoCD app
`ferrum-production`, namespace
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
