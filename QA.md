# QA.md — Ferrum QA playbook

Project-specific invariants for `/qa`. Generic patterns live in `~/.claude/qa-refs/`.

## Applicability matrix

- Forge: Forgejo (`git.nikolay-eremeev.com/nikolay-e/ferrum`), no GitHub mirror.
- CI: Argo Workflows via `sensor-ferrum-image` (gitops ci-platform); webhook id 16 on the repo,
  secret from `gitops/kubernetes/secrets/ci-events/forgejo-webhook.enc.yaml`.
- CD: ArgoCD app `ferrum-production`, namespace `ferrum-production`, image
  `git.nikolay-eremeev.com/nikolay-e/ferrum:main-<sha7>`, ImageUpdater CRD `ferrum-production`.
- URL: https://ferrum.nikolay-eremeev.com (public tier, Cloudflare tunnel `gitops`).
- Postgres: role/db `ferrum_production` on shared CNPG via pooler; password secret
  `shared-postgres-ferrum-production` (shared-database ns) → ExternalSecret `ferrum-postgres`.
- SonarCloud: no project configured — skip, note as N/A.
- Health: `/health` = liveness (static); `/ready` = readiness (checks Postgres).

## Invariants that bite

- Two suites are the product's core promises and must never be weakened:
  `packages/domain/tests/replay.test.ts`, `apps/pwa/tests/e2e/workout-loss.spec.ts`.
- Token minting in production is only `POST /auth/bootstrap` with header `x-bootstrap-key`
  (Keychain: `ferrum-bootstrap-key`); `/dev/token` needs `FERRUM_DEV_ROUTES=1` and must stay
  off in prod. Tokens are stored sha256-hashed (`auth_tokens.token_hash`).
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
