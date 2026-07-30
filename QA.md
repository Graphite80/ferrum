# QA.md — Ferrum QA playbook

Project-specific invariants for `/qa`. Generic patterns live in `~/.claude/qa-refs/`.

## Applicability matrix

- Forge: Forgejo (`git.nikolay-eremeev.com/nikolay-e/ferrum`), no GitHub mirror.
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

## Invariants that bite

- Two suites are the product's core promises and must never be weakened:
  `packages/domain/tests/replay.test.ts`, `apps/pwa/tests/e2e/workout-loss.spec.ts`.
- Token minting in production is `POST /auth/bootstrap` with header `x-bootstrap-key`
  (Keychain: `ferrum-bootstrap-key`) or `POST /auth/sso` with the hub's identity cookie and
  header `x-ferrum-sso: 1`; `/dev/token` needs `FERRUM_DEV_ROUTES=1` and must stay off in prod.
  Tokens are stored sha256-hashed (`auth_tokens.token_hash`).
- `POST /auth/sso` answers `200 {"signedIn": false}` when no identity cookie was presented —
  the app asks on every cold start, so that case must stay quiet in the console, the pod log
  and the crawler. It must **never** return a token without a ticket that verifies. A ticket
  that was presented and failed verification is a 401 AND an `sso_ticket_rejected` log line:
  that line is the only symptom of `SSO_SIGNING_KEY` drifting between `ferrum-secrets` and
  life-as-code's `sso-signing-key`, which otherwise looks like an ordinary signed-out visitor.
- Static responses carry cache headers from the API, not from the edge: `/assets/*` (content
  hashed) is `public, max-age=31536000, immutable`, every other document — index.html, `sw.js`,
  the manifest — is `no-cache`. Left unset, the edge applies a 4h default and a released shell
  keeps naming the previous build's bundles.
- The Telegram bot is private-chat only by design — group chats would let any member read or
  write another member's log. Do not "fix" the chat-type guards away.
- Bot env (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`) is optional; the server must
  always boot sync-only without it.
- E2E: `cd apps/pwa && npm run build && npx vite preview --port 4173 ... && CI=1 npx playwright
test`. The sync spec spawns `services/api` `dev:memory` (PGlite) itself.

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
- The crawler will always report "Pages visited: 1". Every screen lives at `/` (the typed
  `Screen` union in `App.tsx`; a router was considered and rejected), so link-following cannot
  reach them. UI coverage comes from the monkey run and the Playwright suite, not the crawler.
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
