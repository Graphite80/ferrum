# QA.md — Ferrum QA playbook

Project-specific invariants for `/qa`. Generic patterns live in `~/.claude/qa-refs/`.

## Applicability matrix

- Forge: Forgejo (`git.nikolay-eremeev.com/nikolay-e/ferrum`) is authoritative. A `github` remote
  (`github.com/nikolay-e/ferrum`) exists as a mirror — enumerate issues and PRs on BOTH sides,
  push only to Forgejo.
- CI: Argo Workflows via `sensor-ferrum-image` (gitops ci-platform); webhook id 16 on the repo,
  secret from `gitops/kubernetes/secrets/ci-events/forgejo-webhook.enc.yaml`.
- CD: ArgoCD app `ferrum-production`, namespace `ferrum-production`, image
  `git.nikolay-eremeev.com/nikolay-e/ferrum:main-<sha7>`, ImageUpdater CRD `ferrum-production`.
- URL: https://ferrum.life-as-code.com (public tier, Cloudflare tunnel `gitops`). The old
  https://ferrum.nikolay-eremeev.com must answer 301 to it — check both every pass.
- Postgres: role/db `ferrum_production` on shared CNPG via pooler; password secret
  `shared-postgres-ferrum-production` (shared-database ns) → ExternalSecret `ferrum-postgres`.
- SonarCloud: no project configured — skip, note as N/A.
- Schemathesis: N/A — the API publishes no OpenAPI document, so the autoqa gate is correctly
  disabled. Cover the routes with `services/api/tests/api.test.ts` and the manual smoke below.
- Health: `/health` = liveness (static); `/ready` = readiness (checks Postgres).
- Telegram bot: N/A while unmounted. The deployment carries no `TELEGRAM_*` env, so
  `POST /telegram/webhook` answers 404 and no user receives a bot message — the chat
  communication review has nothing to read. Re-check the env every pass; the moment those
  variables appear the review becomes mandatory and `services/api/src/bot/` is its subject.

## Bug channels

Enumerate these every pass; verify against the code rather than against this list, and add any
channel found in code but missing here.

- **Forgejo issues** — the canonical tracker, and the only one that takes `Fixes #N`.
- **GitHub mirror issues/PRs** — normally empty, but enumerate rather than assume.
- **Server-side error log** — `kubectl logs deploy/ferrum-production`. The API logs failures and
  only failures, so this is a real channel and an empty log is evidence.
- **Telegram bot reports** — N/A while the bot is unmounted; becomes a channel the moment
  `TELEGRAM_*` env appears.
- **No in-app bug queue and no client-error telemetry exist.** `ErrorBoundary` writes to the
  console and nowhere else, so a render crash on a real device leaves no trace anyone can read.
  That is a deliberate posture for a local-first app, not an oversight to "fix" by adding an
  ingest endpoint — but it does mean the monkey run and the Playwright suite are the ONLY
  evidence of a client-side crash, so neither may be treated as optional.

## Invariants that bite

- Two suites are the product's core promises and must never be weakened:
  `packages/domain/tests/replay.test.ts`, `apps/pwa/tests/e2e/workout-loss.spec.ts`.
- `POST /auth/revoke-all` withdraws every credential of the calling account, its own included,
  by stamping `auth_tokens.revoked_at`; `requireAuth` requires that stamp to be absent. It is the
  remedy for a lost device and the only auth operation that stays correct whatever is settled in
  issue #1 about expiry and device names. There is deliberately no UI: signing out a
  bootstrap-only device that holds unsynced events would strand them.
- Token minting in production is `POST /auth/bootstrap` with header `x-bootstrap-key`
  (Keychain: `ferrum-bootstrap-key`) or `POST /auth/sso` with the hub's identity cookie and
  header `x-ferrum-sso: 1`; `/dev/token` needs `FERRUM_DEV_ROUTES=1` and must stay off in prod.
  Tokens are stored sha256-hashed (`auth_tokens.token_hash`).
- **A cold start must make no `/auth/sso` call at all.** There is no account by default; the app
  is local until the lifter asks for sync in Settings. A boot that spends the ambient hub cookie
  would enrol whoever is logged into the hub in that browser. If a pass ever sees `/auth/sso` in
  the network log of a freshly loaded page, that is a P0, not a curiosity.
- `POST /auth/sso` answers `200 {"signedIn": false}` when no identity cookie was presented —
  which is what a lifter who taps Sign in without a hub session gets, so that case must stay quiet
  in the console, the pod log and the crawler. It must **never** return a token without a ticket that verifies. A ticket
  that was presented and failed verification is a 401 AND an `sso_ticket_rejected` log line:
  that line is the only symptom of `SSO_SIGNING_KEY` drifting between `ferrum-secrets` and
  life-as-code's `sso-signing-key`, which otherwise looks like an ordinary signed-out visitor.
- The first SSO sign-in backfills history from the hub, so `events` going from 0 to thousands on
  one request is the expected shape, not a runaway. Check `hub_backfill` in the pod log after any
  sign-in: it carries `setsImported` and `unresolved`, and a non-zero `unresolved` is history the
  exercise library could not name — a finding, not noise. `hub_backfill_unreachable` means the
  NetworkPolicy pair or `HUB_API_URL` is wrong; sign-in still succeeded, the account is just empty.
- The integration runs BOTH ways and both need checking. `hub_export` after a `/sync/push` that
  finishes a workout is the return leg; `hub_export_rejected` with a status is the hub refusing
  (401 = the audiences drifted, 404 = the hub predates the ingest endpoint). The export deliberately
  times out at 4s — well under the sync client's 20s — because it runs inside the push response, and
  a hub that merely hangs would otherwise time the PUSH out, make the client retry, and wedge sync
  in a loop over a secondary concern. Never raise it to the client's timeout.
- A deleted set has to stop counting on BOTH sides. The hub's ingest trailing-prunes per
  (date, exercise) because `workout_sets` has no source column — a wider prune would delete rows
  the Hevy importer owns on the same day. Removing a whole exercise from a session, or deleting a
  finished session outright, still leaves its rows in the hub: known gap, not yet closed.
- **An exercise id is a lookup key, and only the library's spelling works.** `lastPerformances`
  and `bestPriorSets` match on `exerciseDefinitionId`, so a routine that spells one differently
  finds nothing — silently, because `resolveDefinition` falls back to punctuation-insensitive
  alias resolution and every name and diagram still renders. The seeded routine said
  `squat-machine` against a library of `squat_machine` and five years of imported history read
  "no previous set". `apps/pwa/tests/e2e/session-naming.spec.ts` drills it now; a new routine
  source must take ids from the library, never compose them.
- **Never hand-assemble a comparison signature.** The seed used to, and claimed `machine_stack`
  semantics for a plate-loaded press. A slot with no signature is correct — `planExercise` asks
  the library — and a wrong one is invisible until history stops matching.
- A screen's chips must say what a thing IS, not what tapping would do. Both warmup chips read
  "Warmup" and differed only by border brightness, which put twelve of them on a workout with
  three. State on the face, action in the `aria-label`.
- An imported session starts and finishes on one instant, so anything derived from elapsed time
  has to answer "unknown" rather than zero (`formatDuration` returns null).
- Every screen owns a URL (`/`, `/history`, `/history/<id>`, `/workout/<id>`, `/summary/<id>`,
  `/routine/<id|new>`, `/settings`) and a reload restores it. Boot-time auto-resume only fires
  when the path names nothing — otherwise reloading on `/history` would drag you into a workout
  you had deliberately left. The SPA fallback serves `index.html` for any of these, so a new
  screen needs a `screenForPath` case or its address 404s to the shell silently.
- A running workout is leavable: `workout-home` returns to Home WITHOUT ending it, and Home shows
  `resume-workout` while a session is active and undeleted. These two are a pair — leaving without
  a way back hides a running workout until the app restarts.
- A session with no title of its own is named from its primary movers (`describeSession`), so the
  history list reads Push / Pull / Legs / Upper body / Full body / Core rather than 278 rows of
  "Workout". The label is derived, never stored, so a session that changes renames itself and a
  title the lifter typed always wins. `packages/exercise-library/tests/session-label.test.ts`
  asserts every exercise in the library classifies — an unclassified one silently degrades the
  whole list to the fallback.
- Static responses carry cache headers from the API, not from the edge: `/assets/*` (content
  hashed) is `public, max-age=31536000, immutable`, every other document — index.html, `sw.js`,
  the manifest — is `no-cache`. Left unset, the edge applies a 4h default and a released shell
  keeps naming the previous build's bundles.
- The Telegram bot is private-chat only by design — group chats would let any member read or
  write another member's log. Do not "fix" the chat-type guards away.
- Bot env (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`) is optional; the server must
  always boot sync-only without it.
- E2E: `cd apps/pwa && npm run build && CI=1 npx playwright test` — the config starts the preview
  server itself for the offline drills. The sync, session-naming and hub-sso specs do NOT use it:
  they spawn `services/api` on PGlite with `STATIC_DIR=apps/pwa/dist` and navigate to that origin,
  because sync targets the origin the page came from and a preview server has no API behind it.
  So `npm run build` is a precondition of those three, not a convenience.
- **There is no sync server field and must not be one again.** Sync is a relative path against the
  page's own origin; Settings holds only an access token, for dev and e2e. A custom address never
  worked for the hub cookie, the backfill or the return leg, all of which are same-origin.

## Known gotchas

- CNPG operator ignores `managed.roles` drift (ArgoCD `ignoreDifferences`): a new role must be
  `kubectl patch`-ed into the live cluster AND committed; if the password secret lands after
  the role, the operator may never apply it — `ALTER ROLE ... PASSWORD` from the primary pod,
  value from the SOPS secret.
- network-policies `traefikIngress` labelValue must be the RELEASE name (`ferrum-production`),
  not the chart name — the pod label is `app: {{ .Release.Name }}`.
- autoqa runs post-deploy from the sensor; archived logs live in MinIO
  (`argo-workflows-artifacts/ferrum-autoqa-*/...`, fetch via `kubectl exec` into the minio pod,
  container `minio`). A green run still requires reading the crawler/monkey findings.
- Monkey seed 1337 previously caught: Stepper `-Infinity` overflow via pasted huge negatives —
  every Stepper exit must stay finite and non-negative.
- Navigation is `<button>`, never `<a href>`, so link-following reaches nothing and the crawler
  audits exactly what `seed-pages` names — no more. As of 2026-08-05 the sensor seeds
  `/,/history,/settings,/routine/new`, which is every address that needs no session id, so
  "Pages visited: 4" is the healthy number. A drop back to 1 means the seed list was lost.
  The id-bearing screens (`/workout/<id>`, `/summary/<id>`, `/history/<id>`) remain unreachable
  to it; those are covered by the monkey run and the Playwright suite.
  **"Pages visited: 0" is a different animal and always a broken run** — it means every seed
  was skipped, and the gate still reports `ok` (upstream `nikolay-e/autoqa#51`). It happened
  on the 2026-07-30 host move: the sensor still named the old host, which by then 301'd to the
  new one, so the crawler audited nothing, the monkey took 0 actions, and an empty baseline was
  written for the old host. Whenever the public host changes, the sensor's `TARGET_URL` in
  gitops changes in the same commit, and the first run afterwards gets read line by line.
- Observatory sits at B+ (threshold B). The single failing test is `unsafe-inline`/`unsafe-eval`
  in `script-src`, which comes from the cluster-wide `kube-system-security-headers` middleware
  shared by every app on the domain — a ferrum-only fix would mean a ferrum-only middleware.
  Re-evaluate if the score drops below the gate; do not silently accept a worse grade.
- ZAP stays off in the sensor: the autoqa image drives it as a Docker container that does not
  exist in-cluster, so enabling it produces a permanent blocking gate-fail (same reason as the
  yay-tsa sensor).
- Live reads go through `useLiveData` (`src/components/live-data.ts`), never `useLiveQuery`
  directly: the raw hook rethrows an IndexedDB failure during render and, with no boundary in
  its path, unmounts the app mid-workout. The same applies to the `liveQuery` observer in the
  sync client — an Observable error is terminal, so it re-arms itself.
- Deletion is a tombstone that must stop the workout counting everywhere, not just in list
  views: `allSets` (domain) excludes deleted sessions, and `db/history.ts` guards both the
  prefill and the PR baseline. A new reader over sessions needs the same filter.
- Post-deploy autoqa races the rollout it is named for: the sensor submits the autoqa
  workflow in PARALLEL with the image build, so its wait budget has to cover build +
  Image Updater poll + ArgoCD sync + rollout (~12.2m measured). It was 12m and silently
  QA'd the PREVIOUS release while reporting success; raised to 20m in gitops
  `workflow-templates/autoqa.yaml`. Always read the first two lines of the autoqa log:
  "Live site serves main-<sha>" means the run is trustworthy, the `::warning::` line
  means it tested something else.
- **The crawler cannot reach a populated screen, so populate one yourself for any pass that
  claims to have looked.** Dump the hub's `workout_sets` to the importer's shape
  (`select ... json_agg` on `lifeascode_production`), seed a throwaway PGlite through
  `importForUser`, and serve it with `PGLITE_DIR=<dir> STATIC_DIR=apps/pwa/dist tsx
src/dev-server.ts`. That is how the "no previous set" and "0 s" defects surfaced; neither is
  visible on the empty database every automated suite runs against. No production credentials
  and no hub cookie are involved.
- `/auth/sso` answers 404 in that local configuration (no `SSO_SIGNING_KEY`), and the browser
  logs it as a console error on every start. Expected, not a finding: not mounting the endpoint
  without a key is the deliberate posture, asserted in `services/api/tests/sso.test.ts`.
- A QA browser profile holds a service worker from whatever build it last loaded, and
  `registerType: 'prompt'` keeps it there until "Restart" is tapped. A cache-busting query
  string does not help. Unregister the worker and clear `caches` before believing anything
  the browser shows, or an old bundle will fake a regression that production does not have.
- Smoke the write path with a well-formed body: `{"deviceId":...,"events":[],"idempotencyKey":...}`.
  An empty `{}` returns a 400 protocol error, which proves validation but not the write.
- The API logs failures, and only failures: one JSON line per 4xx/5xx on an API path and
  per failed write anywhere, successes and asset reads stay silent (`app.ts`). So an empty
  pod log over the autoqa window is now evidence rather than the absence of logging it used
  to be, and `grep '"level":"error"'` is the 5xx check. An `OPTIONS /` 404 appears
  occasionally from an outside prober and is not an app fault.
- Before bumping the autoqa pin in gitops `workflow-templates/autoqa.yaml`, confirm the
  candidate tag was actually published: `gh api user/packages/container/autoqa/versions`
  lists real tags. autoqa main can be ahead of the newest image (a Dependabot CI-action
  merge lands without producing one), and pinning a tag that does not exist breaks the QA
  gate for every consumer, not just this app.
