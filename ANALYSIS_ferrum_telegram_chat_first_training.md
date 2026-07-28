# ANALYSIS — How to make Ferrum a Telegram/chat-first training app (like Hevy, but in Telegram)

Tournament protocol. Rounds append below; never overwrite prior rounds.

Question: Ferrum today is a local-first PWA strength logger (event-sourced domain,
offline Dexie storage, importers, progression engine). The user wants it to become a
Telegram/chat-first training app — Hevy-grade logging, but living in Telegram. How
should this be done — architecture, product shape, what to keep, what to build,
what the real risks are?

## Round 1 — Ferrum Architect

### 1. What survives untouched

Everything under `packages/` survives a Telegram pivot with zero changes — this is the payoff of
the determinism invariant (INVARIANTS §13, ESLint-enforced: no `Date.now`, no `fetch`, no DOM, no
storage in `packages/domain` and `packages/progression-engine`).

- **`packages/domain`** — zero-dependency, `exports` → raw `src/index.ts`, runs identically in a
  Node bot process, a worker, or a Mini App webview. `projectSession()` is pure; a server can
  replay any session from Postgres rows exactly as the PWA replays from Dexie. Critically, the
  `EventEnvelope` (`packages/domain/src/events.ts`) already carries `userId`, `serverReceivedAt`,
  `serverSequence` — all currently `null` in the PWA. The wire format for a server was designed in
  advance; the pivot fills in fields that already exist.
- **`packages/progression-engine`** — `ProgressionPolicy.evaluate()` (`src/types.ts`) is pure and
  returns a `Recommendation` with `explanation`, `reasonCodes`, `evidence`, `confidence`. This is
  _made_ for chat: a bot reply "Bench 82.5 kg 3×5 — all sets at top of range, RIR inside band,
  3 comparable sessions (high confidence)" is a direct rendering of the existing type. No UI work
  needed to ship the product's differentiator through Telegram.
- **`packages/importers`** — pure `SourceExtraction → events` pipeline with pluggable
  `ExerciseResolver` (`src/pipeline.ts`). Telegram document upload of a Hevy/Strong CSV → run the
  importer server-side → reply with the existing import report (ambiguities, dedupe candidates).
  Onboarding via chat is arguably _better_ than via PWA file picker.
- **`packages/exercise-library`** — generated TS, pure lookup; the bot's fuzzy exercise matching
  for text commands reuses the same resolver contract importers already define.

### 2. Event-sourced model ↔ chat interface

The mapping is unusually clean because the event vocabulary (13 types, INVARIANTS §6) is already
command-shaped:

| Chat interaction                                                | Event                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/start push-day` or routine button                             | `SessionStarted` + `ExerciseAddedToSession`×                                           |
| message `bench 100x5 @2`                                        | `SetLogged` (RIR=2)                                                                    |
| **user edits their message** (Telegram `edited_message` update) | `SetAmended` — a natural fit; amendable fields (§5) match what a text edit can express |
| `/undo`, inline "delete" button; "restore" button               | `SetDeleted`; `SetRestored`                                                            |
| `/done`                                                         | `SessionFinished`                                                                      |

Two Telegram-specific traps: (a) bots do **not** receive message-deletion updates, so deleting a
chat message can never mean `SetDeleted` — deletion must be an explicit command/button; (b) bot
update processing must be idempotent on `update_id`, which composes fine with the log's own
`eventId` dedupe (`dedupeEvents`).

**Where the log lives**: server-side Postgres, one `events` table
(`user_id, event_id PK, aggregate_id, order_key, envelope jsonb, server_sequence bigserial`) —
exactly the `user_id + event_id` idempotency + `server_sequence` cursor the INVARIANTS "Open
items" already specify for phase 4. Telegram **CloudStorage is not a candidate** for the log:
1024 keys × 4096 bytes ≈ 4 MB, key-value only, no transactions — fine for caching the device HLC
state or last-projection snapshot in a Mini App, hopeless for an append-only history (the real
fixture `fixtures/real-history-2026-06-15_2026-07-25.json` is ~6 weeks and already substantial).
Projection cost is a non-issue: sessions are ~40 events (comment in `apps/pwa/src/db/ferrum-db.ts`),
replay per session on demand, no snapshotting needed server-side for years.

For pure-chat commands the **server is the HLC node**: it stamps events with a per-user server
`nodeId` using the same `tick()` from `packages/domain/src/hlc.ts`, advancing the clock inside the
same Postgres transaction that inserts — the exact discipline `event-store.ts` uses with Dexie
(§8a: never read the clock outside the transaction that uses it). `receive()` with its 60 s
`ClockDriftError` guards merging Mini-App-generated batches.

### 3. Does chat-first solve sync or break local-first?

**Both, split by client.** The honest framing:

- **Pure bot chat is a thin client** — the server log is the source of truth, multi-device is
  trivially solved (any device's Telegram sees the same chat), and the entire
  `packages/sync-protocol` problem _for that path_ collapses to "one writer". This is real: the
  hardest open item in the repo disappears for the chat path.
- **But it breaks the "impossible to lose a set" invariant in the gym.** Today
  `appendEvents` commits to IndexedDB before the UI acknowledges (`apps/pwa/src/db/event-store.ts`).
  A bot cannot acknowledge without network. Telegram's client-side outbox queues messages typed
  offline and delivers on reconnect — a poor man's offline queue — but (i) the user gets no
  confirmation the set was parsed, (ii) `message.date` is server-receipt time, so `performedAt`,
  `actualRestSeconds` and the HLC wall time are all wrong after a basement-gym reconnect, and
  (iii) a mis-parsed line discovered an hour later is a data-quality hole Hevy doesn't have.
  Offline logging is a top gym scenario (concrete buildings, airplane-mode lifters).
- **Resolution: the Mini App is the gym client, chat is the ambient client.** A Telegram Mini App
  is a webview with working IndexedDB — the local-first Dexie path (`ferrum-db.ts`,
  `event-store.ts`, one-short-transaction discipline) survives verbatim. It syncs through the same
  server log the bot writes to. HLC is therefore _not_ removable: Mini App devices still generate
  events offline and merge later. Chat-first doesn't delete the sync problem; it forces building
  the server half of it (which phase 4 required anyway) while adding a second, zero-sync client.

### 4. apps/pwa reuse and which iOS workarounds die

React 19 + Vite builds into a Mini App with minor additions (Telegram `WebApp` init script,
`initData` auth header, theme vars). Reusable as-is: `src/db/*` (Dexie event store),
`src/features/workout/*` (session-controller, SetRow, rest-timer view logic), `src/platform/ids.ts`.

- **Dies for chat, survives for Mini App**: `platform/wake-lock.ts` — irrelevant in a chat
  conversation; inside Telegram's iOS webview `navigator.wakeLock` availability is unverified
  (Spike A on a real iPhone, already the repo's #1 open item, now must test _inside Telegram_).
  The `absent` branch of `detectWakeLockSupport` handles it gracefully either way.
- **Becomes irrelevant entirely**: the Web Push limitation (INVARIANTS §14 — `notificationclick`
  dead when PWA closed). **A bot message reaches the user with everything closed.** The rest
  timer as a bot push ("Rest over — bench set 3 of 5, target 100×5") is the single biggest UX
  _win_ of the pivot: it does what Web Push on iOS provably cannot. Server-side timer =
  `endsAt - now` semantics preserved (`rest-timer.ts` philosophy), delivery latency ~1-2 s,
  per-chat rate limits (~1 msg/s) are irrelevant at rest-timer cadence.
- **Becomes irrelevant**: cross-domain-OAuth constraint — Telegram `initData` HMAC validation is
  the auth story, no redirect, no cookies, solves §14's auth paragraph outright.
- **Still applies inside the Mini App webview**: WebKit IDBTransaction suspension (bug 202705),
  no Background Sync, IndexedDB `UnknownError` recovery (`withDatabaseRecovery`) — same engine,
  same bugs, plus a new one: Telegram can evict webview storage more aggressively than Safari
  evicts an installed PWA's; server sync becomes the durability backstop sooner.

### 5. What gets HARDER (skeptical list)

1. **Offline gym logging via chat** — see §3. Non-negotiable answer: Mini App for live logging.
2. **Sub-second logging bar** (product bar #1 in `CLAUDE.md`): typing `100x5@2` may beat Hevy's
   taps for keyboard-fluent users, but inline-keyboard round trips add 300-1000 ms per
   interaction vs. 0 ms local taps. Chat is _slower_ than the PWA for button-driven logging.
3. **Rest timer visibility**: no persistent on-screen countdown in chat; a bot can edit a pinned
   message every ~5 s at best (rate limits) — jittery. Mini App keeps the real timer.
4. **Wake lock is gone in chat** — irrelevant (Telegram itself keeps the screen via user
   interaction) but the "glance at phone mid-set" flow needs the Mini App.
5. **Parsing ambiguity vs. domain strictness**: the domain refuses to invent numbers
   (`resolveLoad` `indeterminate`, INVARIANTS §3; per-hand vs total is _identity-defining_, §2/§4).
   `dumbbell press 30x8` — per hand or total? A bot that guesses corrupts comparison signatures
   permanently. The grammar must ask once and persist per-exercise entry mode, which adds
   friction exactly where Hevy has none.
6. **`local-first` marketing claim quietly dies for chat-only users** — their history lives on
   our server + Telegram's. The product bar "valuable with everything switched off" now requires
   the Mini App path to stay first-class, or it's just a bot with a database.

### 6. Minimal architecture and phases

Forced into existence from the "deliberately not created yet" list: **`packages/sync-protocol`**
(push/pull, `server_sequence` cursor, idempotency on `user_id+event_id` — already typed in the
envelope) and **`services/api`** (Fastify/Hono: sync endpoints + Telegram webhook handler + the
Postgres event store mirroring `event-store.ts` semantics). New and Telegram-specific:
**`packages/chat-grammar`** — pure parser `text → AppendInput | Ambiguity`, property-testable
exactly like the domain (same ESLint determinism regime), which is where the pivot's real product
risk (§5.5) gets pinned by tests. `services/worker` stays uncreated (rest-timer pushes are a
`setTimeout`/pg-cron in `services/api` at this scale).

**Phases**: (1) `services/api` + `sync-protocol` + Postgres event log + PWA sync client — this is
phase 4 as already planned, unmodified, and everything else stands on it. (2) Bot MVP: webhook,
chat-grammar, log/undo/finish, `Recommendation` rendering, rest-timer push, CSV import via
document upload. (3) Mini App: wrap `apps/pwa` (initData auth, theme, CloudStorage HLC-state
cache), keep Dexie local-first; chat and Mini App converge on one log. (4) Polish: per-exercise
entry-mode memory, inline-keyboard quick-log from the rest-timer push message.

### 7. Deployment fit

Clean fit with `ferrum/CLAUDE.md` phase-4 recipe. **Webhook over long-poll**: the cluster already
terminates public TLS (`letsencrypt-prod`), so `api.ferrum.<domain>` ingress + Telegram
`setWebhook` with `secret_token` is one more route in the hidden-gem-shaped Helm chart
(`gitops/kubernetes/helm-charts/ferrum/`, copy with `templates/namespace.yaml` +
`templates/networkpolicy.yaml`); long-poll would be the only long-poll deployment in the cluster
and needs exactly-one-replica semantics anyway. Same repo, root `Dockerfile` (multi-stage:
`services/api` runtime + `apps/pwa` static build served by the same container or a second one),
Forgejo push webhook → `sensor-ferrum-image.yaml`, tag `main-<sha7>`, ImageUpdater CRD with
`regexp:^main-[a-f0-9]{7}$`. Postgres = role + `Database` CR on the shared CloudNativePG cluster
(explicitly pre-decided in `ferrum/CLAUDE.md`). Bot token → SOPS-encrypted secret alongside the
per-app `forgejo-registry.enc.yaml`. Network policy must allow egress to `api.telegram.org` —
the one non-default hole vs. other apps in the cluster.

**Bottom line**: the pivot costs almost nothing in the packages layer (the determinism invariant
pays out in full), forces phase 4 to happen now, gains a push channel iOS PWAs can never have,
and its real risks are product-shaped, not architecture-shaped: offline gym logging demands the
Mini App stay first-class, and the chat grammar must refuse to guess where the domain refuses to
guess.

## Round 1 — Telegram Platform Realist

Lens: what the Telegram platform (July 2026) can and cannot carry. Evidence-first; Ferrum's own bar is "logging faster than the incumbent, data practically impossible to lose" (CLAUDE.md) with local-first invariants enforced by an atomic IndexedDB transaction per append (INVARIANTS.md §8a) and the workout-loss e2e drill.

### 1. The offline question decides everything — and the answer is bad on iOS

- **Service workers do not run in Telegram's iOS webview.** Telegram iOS embeds WKWebView; SW registration silently fails. Tracked since July 2024, still open/"in progress": <https://github.com/Telegram-Mini-Apps/issues/issues/27>. Works on Android (Chromium-based webview) and macOS.
- No SW means **a Mini App cannot even open without network on iOS** — it is a URL fetched fresh into the webview. The official Mini Apps doc (<https://core.telegram.org/bots/webapps>) contains zero mention of offline operation or caching. A gym basement = blank screen.
- IndexedDB _exists_ inside the webview, but its lifetime is owned by Telegram, not you: Telegram's cache-clear settings and webview data wipes take Dexie with them, and there is no `navigator.storage.persist()` you control. Ferrum's §8a invariant (device id + HLC advanced inside the same IDB read-write transaction as the append) is only trustworthy where you own the storage.
- Partial mitigation, Bot API 9.0 (April 2025): **DeviceStorage — 5 MB per user of persistent native KV**, and **SecureStorage — 10 items per user** in Keychain/Keystore (<https://core.telegram.org/bots/api-changelog>, <https://core.telegram.org/bots/webapps>). 5 MB ≈ 10–15k Ferrum events at ~350–500 B/event — enough for ~1–2 years of log as an outbox/mirror. But it is an **async KV with no transactions** (no atomic clock+append), and it is only reachable _after the page has loaded_ — which on iOS requires network. It hardens durability, not availability.
- CloudStorage is a toy for this use: 1024 keys × 4096 chars ≈ 4 MB, keys 1–128 chars, server-side (<https://core.telegram.org/bots/webapps>). Fine for preferences, not an event log.

**Conclusion:** Ferrum's local-first model cannot be honored inside Telegram on iOS. On Android it approximately can (SW + IndexedDB in Chromium webview), which gives you a platform-split product — exactly the kind of silent data-loss asymmetry the repo's invariants exist to prevent.

### 2. Pure-chat bot loop: workable ergonomics, hard ceilings

- Rate limits: ~30 messages/s per bot globally, **~1 message/s per chat**, 429 + `retry_after` on excess; `editMessageText` counts against the same buckets (<https://core.telegram.org/bots/faq>, <https://gramio.dev/rate-limits>). A one-message "session card" that the bot edits after every set is capped at ~1 edit/s/user — acceptable for sets (30–180 s apart), tight for rapid corrections.
- Every inline-keyboard tap is a full round trip (Telegram → your webhook → answerCallbackQuery + edit → Telegram): realistically 300–800 ms per tap, network required. **Sub-second set logging (Ferrum's product bar) is not achievable through callback queries**; free-text `100x5` parsed server-side is one send and is the only fast path.
- The one genuinely underrated offline property: **Telegram's own client queues unsent messages**. Typing `100x5` in a basement parks the message client-side and delivers it when signal returns — a free, user-visible offline outbox with zero code. Caveats: no bot feedback until delivery, and the message `date` is server receipt time, so `recordedAt`/HLC must be reconstructed (Ferrum's import-provenance path already models this: imported/unprescribed sets, `prescriptionSnapshot: null`, §9).
- Existing Telegram gym bots (GymNote — <https://github.com/javascriptizer1/gymnote>, Workout-Run-Bot — <https://github.com/freelkee/Workout-Run-Bot>, assorted Notion/GPT gluons) are all server-state command loops: `/start_training → pick exercise → type numbers`. None is Hevy-grade; none survives offline; their input loop confirms free-text parse + one edited summary message is the established pattern.

### 3. What Telegram _does_ give you (and it's substantial)

- **Auth for free:** `initData` HMAC-SHA-256 (secret = HMAC of bot token with `WebAppData`), plus Ed25519 signature for third-party validation since Bot API 8.0 (<https://core.telegram.org/bots/webapps>). This is a same-origin-free identity that fits Ferrum's "no third-party OAuth redirect" constraint for the _Telegram surface_ — and could bootstrap sync-protocol accounts.
- **Mini Apps 2.0 (Nov 2024):** fullscreen, `addToHomeScreen()` shortcuts, geolocation, device motion (<https://telegram.org/blog/fullscreen-miniapps-and-more>). A Mini App can _look_ like an app. It still cold-loads over the network.
- **Distribution & money:** direct links, main-app button, attachment menu; Stars for digital goods with subscriptions — Apple/Google take ~30% on Star purchases (realistic all-in ~32%), subsidized toward 0 if revenue is reinvested in Telegram Ads; payout via Fragment/TON after 21 days (<https://telegram.org/blog/telegram-stars>, <https://grambase.ai/blog/telegram-stars-guide-2026>).
- No Wake Lock API is exposed to Mini Apps — the iOS 18.4+ wake-lock story that `apps/pwa/src/platform/wake-lock.ts` fights for does not exist at all inside the webview; the screen dims mid-set and you cannot stop it.

### 4. Verdict

- **Pure-chat bot as the primary logger: not viable for Hevy-grade.** Round-trip latency per interaction, 1 msg/s/chat edit ceiling, no timer surface, no local durability you control. Viable as a _capture and notification channel_.
- **Mini App as the primary logger: not viable** while iOS has no service workers and no offline load path (open issue since 2024, no committed fix). It would be an online-only gym app on the platform half your users bring to the gym — a direct violation of Ferrum's "impossible to lose a workout" bar and of §8a.
- **Hybrid is the only honest architecture:** keep the PWA as the offline system of record; add (a) a chat bot that accepts free-text set lines (leveraging Telegram's client-side offline queue) and replays them into the event log as provenance-tagged events, exactly like the existing importers, and (b) an online Mini App for review/analytics/social/Stars monetization, authenticated via initData and reading the synced log. Telegram is a _channel and identity layer_ for Ferrum, not a runtime. Anything sold as "Hevy, but in Telegram" is structurally an online-first server-state app wearing Ferrum's name.

## Round 1 — Product Skeptic

Stance tested: "Hevy, but in Telegram" — is chat-first actually a better logger, or a distribution fantasy?

### 1. Tap-count: chat LOSES the core interaction

Hevy's mid-workout loop, per its own docs (<https://help.hevyapp.com/hc/en-us/articles/35361530647959-How-to-Log-a-Workout-in-the-Hevy-App-Step-by-Step-Guide>, <https://www.hevyapp.com/features/track-workouts/>): previous weight/reps are pre-filled, so the common case is **1 tap** (checkmark) per set; a changed weight is ~4-6 taps/keystrokes. The checkmark also auto-starts the rest timer, which stays visible in-app and on the lock screen.

Telegram bot, best case (chat pinned, notification tapped): reach chat ~2 taps, focus input 1 tap, type "100x5" 5 keystrokes, send 1 tap ≈ **9 interactions + bot round-trip latency**. With an inline "repeat last set" button: ~3 taps — still 3x Hevy, and only if the bot's reply keyboard is the newest message (each logged set scrolls it; other chats' messages interleave). Structural losses that no grammar fixes:

- **No always-visible rest timer.** A bot cannot render a live countdown; message edits are flood-limited (~1 msg/sec/chat, <https://core.telegram.org/bots/faq>). A "rest over" push is a downgrade from a lock-screen countdown.
- **No glanceable session table.** Ferrum's core object is prescribed-vs-actual — a tabular diff. Chat is an append-only transcript; the "current state" is a message that ages off-screen. Keyboard covers half the viewport while typing.
- **The phone is already in the app.** Mid-workout you interact every 60-120s for 20+ sets; "no app install" saves friction once, Hevy's pre-filled checkmark saves it 20 times per session. Reddit lifters churn precisely on rest-timer and plate-calculator ergonomics (<https://setgraph.app/ai-blog/best-workout-tracker-app-reddit>) — chat has neither.
- **Chat requires connectivity; Ferrum is local-first.** A bot makes the server the write path — gym basements break it, and the "data practically impossible to lose" invariant (short IDB transactions, docs/INVARIANTS.md) has no equivalent inside Telegram's webview/bot model. A Telegram Mini App is just a worse-persistence rebuild of apps/pwa.

### 2. Prior art: the category exists and has zero winners

Every Telegram "gym log" is a hobby project or automation template: NextSet (<https://github.com/voevodinaua-lab/NextSet-Fitness-Tracker-Telegram-Bot>), gymnote (<https://github.com/javascriptizer1/gymnote>), Workout-Run-Bot (<https://github.com/freelkee/Workout-Run-Bot>), n8n/Gemini templates (<https://n8n.io/workflows/6697-telegram-fitness-bot-custom-workout-plans-from-phototext-using-gemini-ai/>). WhatsApp equivalents are AI-coach wrappers (<https://www.maicoach-ai.com/>, <https://www.codewords.ai/templates/whatsapp-fitness-tracker-bot>). None has visible traction. Meanwhile Hevy went 1.5M (2022) → 15M+ users, ~$2M ARR with **zero paid marketing — growth came from app-store algorithms and word of mouth** (<https://obj.ca/fitness-app-entrepreneur-pumped-by-hevys-progress-to-2m-in-annual-revenue/>, <https://www.revenuecat.com/blog/growth/guillem-ros-hevy-podcast>, <https://www.hevyapp.com/about-us/>). That growth channel does not exist for bots: "there is no search for bots in Telegram" — discovery is third-party directories of unmaintained bots (<https://www.airdroid.com/ai-insights/how-to-find-bots-in-telegram/>, <https://habr.com/en/articles/990174>). Telegram's 1B MAU / ~500M DAU (<https://www.demandsage.com/telegram-statistics/>, <https://backlinko.com/telegram-users>) is reach you cannot address: Mini App hits are crypto/tap-to-earn games bought with ad spend (<https://propellerads.com/blog/adv-telegram-mini-app-advertising-report/>), not tools found organically.

### 3. Where chat genuinely wins: the coach loop, not the set loop

Coaches already run clients through chat — and hit a wall: WhatsApp coaching breaks around ~20 clients for lack of structured profiles/history (<https://assistantcoach.fit/blog/whatsapp-google-sheets-fitness-coaching/>); platforms like TrueCoach exist precisely to add structure to that chat relationship, and now compete on built-in voice messaging (<https://truecoach.co/blog/the-best-personal-trainer-apps-with-voice-messaging-2026-guide/>). So chat is the natural surface for **feedback, check-ins, summaries, nudges** — asynchronous, low-frequency, social — and a proven failure surface for **per-set logging** — synchronous, high-frequency, ergonomic. "Training log that lives where your coach already talks" is a real wedge; "Hevy in Telegram" is not.

### 4. The shorthand grammar is real value — but the market attacks this friction with voice, not chat

"squat 100x5 / +2.5 / same" is a good input language. Note where 2025-26 products deploy exactly that grammar: voice-first loggers — Liftly ("bench 185 for 8" spoken, <https://apps.apple.com/us/app/liftly-voice-workout-logging/id6752257498>), W8Log (<https://www.w8log.app/blog/voice-workout-log-guide>), GhostFit, whose founder's pitch is literally "most apps slow you down" (<https://ghostfit.ai/blog/ai-technology-in-fitness/why-i-built-a-voice-first-workout-tracker-because-most-apps-slow-you-down>), Vora (<https://askvora.com/voice-coaching>). Voice beats typing in a gym (hands busy/chalky, eyes free); typing "100x5" into Telegram is the worst of both. The grammar belongs in Ferrum's PWA as a quick-add box and a voice target — it does not require Telegram to exist.

### 5. Verdict and minimal wedge

**Chat-first is a trap as the product; chat is a legitimate companion.** It fails Ferrum's own bar: logging is slower than Hevy (1 tap vs ~3-9 interactions), and durability/local-first cannot be honored on a bot write path. The Telegram-shaped asset Ferrum actually has is its event log + import provenance (commit c149593): messages are just another import source.

Cheapest hypothesis test (≤1 week, no architecture change):

1. **Bot as importer + notifier, not logger**: a Telegram bot that accepts "squat 100x5" shorthand and appends events with `source: telegram` provenance, and pushes an end-of-workout summary card (prescribed vs actual) into a chosen chat. Reuses packages/importers + packages/domain untouched.
2. **Instrument the race**: for 2-4 weeks of real training, log via PWA as normal; the bot is available in parallel. Metric: what fraction of sets get logged through the bot voluntarily. Skeptic's prediction: near zero mid-workout, non-zero for post-hoc "I forgot to log Tuesday" entries and for sharing summaries.
3. **If the coach loop is the wedge**, the test is different and social: one real coach-athlete pair using summary-cards + reply-to-adjust ("make it 3x5 next time" → prescription event). That tests "log lives where coach talks" without building a chat logger at all.

If step 2 shows real mid-workout bot usage, revisit; the burden of proof sits on chat, and nothing found in the wild suggests it will meet it.

## Round 1 — Backend & Ops Engineer

### Bot runtime: grammY, webhook mode, one small Deployment

grammY over Telegraf. In 2026 grammY leads on weekly downloads (~1.26M vs ~857k, <https://npmtrends.com/grammy-vs-node-telegram-bot-api-vs-telegraf-vs-telegram-bot-api>), is TypeScript-first with types that actually resolve, and has living docs; Telegraf's v4 TS migration produced notoriously opaque types and its docs decayed into a bare generated reference (grammY's own comparison, but the criticisms check out: <https://grammy.dev/resources/comparison>). Raw Bot API is viable but re-implements middleware, session plumbing and flood-wait retry for no benefit. grammY ships first-party `@grammyjs/conversations`, storage adapters (incl. Postgres), and `auto-retry` for 429 handling.

**Webhook, not long-polling.** The cluster already terminates public TLS with letsencrypt-prod; a webhook is one Ingress route (`ferrum-bot.nikolay-eremeev.com` or `/bot` path on the app domain — must be on the **Public** tier, Telegram's servers must reach it, so it cannot sit behind WARP). Validate the `X-Telegram-Bot-Api-Secret-Token` header set at `setWebhook` time. Webhook also buys free absorption of short pod restarts: Telegram queues undelivered updates and retries. Long-polling would work for a single replica but adds a permanently-open outbound connection and gains nothing here.

Deployment recipe is exactly the phase-4 recipe already in `/Users/nikolay/ferrum/CLAUDE.md`: root Dockerfile + Forgejo push webhook, `sensor-ferrum-image.yaml`, helm chart copied from hidden-gem's shape, ImageUpdater CRD with `^main-[a-f0-9]{7}$`. Footprint: 1 replica, ~0.1 vCPU / 128Mi, bot token as a SOPS-encrypted secret. Postgres is a role + `Database` CR on the shared CloudNativePG cluster — not a new instance.

### Auth: Telegram identity is an identity _provider_, not the auth system

`message.from.id` (bot) and Mini App `initData` (HMAC-SHA256 with key = HMAC(bot_token, "WebAppData"), check `auth_date` freshness ~5 min: <https://core.telegram.org/bots/webapps>, <https://docs.telegram-mini-apps.com/platform/init-data>) give a stable, cryptographically verifiable user id with zero password UX. But it cannot REPLACE the planned auth: `docs/INVARIANTS.md` §14 pins authentication to our own origin for the standalone PWA (cross-domain navigation exits standalone mode; the Telegram Login Widget is precisely such a third-party redirect). So:

- `users(id uuid pk)` + `user_identities(user_id, provider, provider_uid, unique(provider, provider_uid))` — `telegram:<tg_user_id>` is the first row type, passkey/email joins later for the PWA.
- Existing PWA users link via deep link: PWA mints a one-time token, opens `t.me/<bot>?start=<token>`, the bot's `/start` handler binds `tg_user_id → user_id`. Reverse direction (Telegram-first user later opening the PWA): Mini App carries the session, or bot sends a magic link to our origin.
- The bot MUST refuse to log sets before an identity row exists (auto-create a user on first `/start` is fine; writing events under a null/guessed `userId` is not — `EventEnvelope.userId` in `packages/domain/src/events.ts` is nullable only for the local-only PWA phase).

### State: event log is the truth, chat state is a disposable cursor

Two strictly separated stores, both in the shared Postgres (no Redis — a second stateful system for a cursor is dead weight):

```sql
create table ferrum.events (
  user_id            uuid        not null,
  event_id           text        not null,
  aggregate_id       text        not null,   -- sessionId
  event_type         text        not null,   -- 13 DomainEventType values
  schema_version     int         not null,
  hlc                text        not null,   -- encodeHlc output
  device_id          text        not null,
  payload            jsonb       not null,
  client_created_at  timestamptz not null,
  server_received_at timestamptz not null default now(),
  server_sequence    bigint      generated always as identity,
  primary key (user_id, event_id)            -- idempotency, as designed in the plan
);
create index events_pull on ferrum.events (user_id, server_sequence);

create table ferrum.device_clocks (          -- §8a server-side: one HLC per device row
  user_id uuid not null, device_id text not null,
  wall_millis bigint not null, counter int not null,
  primary key (user_id, device_id)
);

create table ferrum.chat_state (             -- disposable conversation cursor
  tg_chat_id bigint primary key, user_id uuid not null,
  active_session_id text, focus_exercise_id text,
  cursor jsonb not null default '{}', updated_at timestamptz not null default now()
);
```

The bot is **just another device** in the sync mesh: `device_id = 'bot-<user>'` (nodeId must not contain `:`, per `packages/domain/src/hlc.ts` encoding), clock advanced with `SELECT … FOR UPDATE` on `device_clocks` in the same transaction as the event insert — the Postgres transaction plays the role IndexedDB's read-write transaction plays in `apps/pwa/src/db/event-store.ts` (INVARIANTS §8a). Bot restart mid-workout loses nothing that matters: the active session is _derived_ (SessionStarted without SessionFinished, replayed via `projectSession()` — domain code runs unchanged in Node, §13 guarantees it), and `chat_state` rehydrates the "which exercise does '100x5' apply to" cursor; worst case the bot re-asks one disambiguating question.

### Reliability: quantify the regression honestly

The PWA's guarantee: a set is committed to IndexedDB in one short transaction before the UI acknowledges — logging works with **zero network**. Chat logging is a three-network chain: phone→Telegram DC→our webhook→Postgres. Availability = P(gym connectivity) × P(Telegram) × P(cluster). Telegram is generally solid but not immune — a Korea-region message-delivery incident on 2026-06-16 and Bot API slowdowns in April 2026 were recorded by third-party monitors (<https://statusgator.com/services/telegram>, <https://apistatuscheck.com/down/telegram>), Telegram publishes no SLA, and the dominant failure term is the gym itself (basements, dead zones). Realistic estimate: the chat path fails on the order of _a few sessions per hundred_ for a basement-gym user, versus effectively zero for the PWA. Our own single k3s cluster is absorbed by Telegram's webhook retry queue for short outages, but a multi-hour cluster outage drops sets typed at the bot only if Telegram gives up redelivery.

Degraded mode: pure-chat commands ARE the lossy path and cannot be fixed. The fix is architectural — ship the workout screen as a **Telegram Mini App that reuses the existing PWA event store** (Mini Apps are webviews with IndexedDB; Dexie + the §8a clock code run as-is) so mid-workout logging is device-local and syncs opportunistically, while chat commands remain a convenience layer. Chat-first, not chat-only.

### Notifications: the one thing Telegram wins outright

INVARIANTS §14: on iOS, Web Push cannot wake the PWA and `notificationclick` doesn't fire when it's closed — the PWA structurally cannot do reminders or a background rest timer. Telegram bot messages are real, reliable push on every platform. Rest timer via `editMessageText`: per-chat budget is ~1 message-action/sec and edits share the bucket with sends (<https://gramio.dev/rate-limits>, <https://core.telegram.org/bots/faq>) — so a per-second countdown edit sits exactly at the limit and will eat 429/flood-waits alongside normal logging traffic. Edit on milestones instead (start, 60s, 30s, 10s, done + one final "rest over" message): 5-6 calls per rest, safely inside budget, and grammY `auto-retry` honors `retry_after` on the residual 429s. Scheduled workout reminders and weekly summaries are trivially inside the 30 msg/s global bulk cap at any conceivable user count.

### What this forces into existence, from the "not created yet" list

1. **`services/api`** — the webhook receiver is the first server, and its event-ingest write path is 90% of the sync endpoint. Do not build a "bot backend" and a "sync backend"; they are one service.
2. **`packages/sync-protocol`** — non-negotiable and _simultaneous_: the moment the bot writes events server-side, the server is a second replica, and a PWA that can't pull those events is a forked history. The `server_sequence` cursor + `(user_id, event_id)` idempotency design from the plan ships in the same phase as the bot, not after.
3. A thin server-side event-store module (Postgres twin of `apps/pwa/src/db/event-store.ts`) implementing §8a over `device_clocks`.

NOT forced: `packages/ui`, `services/worker`, `packages/analytics` — summaries can replay in-process in the bot.

### Top 3 operational risks

1. **History fork by sequencing error** — shipping bot ingest before the PWA can push/pull leaves two authoritative stores diverging behind a green UI; the mitigation is a hard rule that `services/api` + `packages/sync-protocol` + PWA sync land as one phase.
2. **Identity orphans** — events written under a Telegram-only user who later "signs up" in the PWA create a merge problem the event model has no operation for; enforce link-before-log and make `user_identities` the only join point.
3. **Telegram as SPOF for the flagship interaction** — flood-waits on chatty rest-timer edits, webhook delivery pauses, no-signal gyms; capped-edit cadence + Mini-App-with-local-store keeps the product's "impossible to lose a workout" promise from silently becoming "impossible unless the basement has LTE".

## Round 2 — Advocate

Case for the hybrid: PWA stays the offline gym runtime, the bot becomes the ambient client, the
pivot forces phase 4 into existence. Sharpened below into resolutions, a product statement, a
build order, and preempted attacks.

### 1. Resolving Round 1's central contradiction: the offline Mini App

Platform Realist said "Mini App cannot work offline on iOS"; Architect assumed "webview with
working IndexedDB". **Both are right, about different properties — availability vs. durability of
an already-running page:**

- Service worker registration fails in Telegram's iOS WKWebView (open since 2024:
  <https://github.com/Telegram-Mini-Apps/issues/issues/27>), so the Mini App **cannot cold-open
  without network** on iOS.
- IndexedDB **works inside WKWebView once the page is loaded** — Apple's own guidance for the
  no-SW situation is literally "use regular Workers instead and store data in IndexedDB"
  (<https://developer.apple.com/forums/thread/745615>; API availability confirmed in
  <https://developer.apple.com/forums/thread/722160>). A loaded SPA is a running JS process; losing
  the network does not unload it. Dexie appends, `projectSession()`, the §8a
  clock-in-same-transaction discipline all keep working with zero connectivity.

**Gym scenario, stated honestly:** open the Mini App at the gym entrance (or at home) with
signal → walk into the basement → log the entire session locally into IndexedDB → sync drains on
reconnect. The only failure is _cold-opening_ with zero signal — and the answer to that is not a
Telegram hack, it is the **installed PWA, which is the same codebase on the same origin** with a
real service worker. One app, two shells: Mini App = zero-install trial and warm-offline shell;
installed PWA = full-offline graduation path, and the bot itself is the upgrade prompter ("install
for offline cold-start" after the first synced workout). Webview storage eviction (Telegram owns
the cache; historic WebKit persistence bugs like
<https://bugs.webkit.org/show_bug.cgi?id=144875>) is neutralized by the same move: once the server
log exists, webview IndexedDB is an outbox, not the system of record — plus Bot API 9.0
`DeviceStorage` (5 MB native KV, <https://core.telegram.org/bots/webapps>) as an eviction-surviving
mirror of unsynced events. So "impossible to lose a set" **tightens** under this plan: today a
lost phone loses everything; after phase 4a nothing older than the current basement session is
ever device-only.

### 2. The product statement: what "Telegram-first" means that Hevy cannot copy

Not "Hevy in worse clothes" — the set-logging loop stays on the local-first client where it
already beats chat (Skeptic §1 conceded correctly). Telegram owns everything _around_ the set:

1. **Real push on iOS.** INVARIANTS §14: Web Push cannot wake a closed PWA; `notificationclick`
   is dead. A bot message reaches a locked iPhone always. Rest-over pings with an inline
   **"same again" button — one tap, matching Hevy's checkmark for the repeat-set case** — plus
   workout reminders and "you skipped leg day" nudges. This is a capability class Hevy's PWA
   competitors structurally lack and Hevy itself only has via app-store installation.
2. **Zero-install onboarding via CSV drop.** `t.me/<bot>` → drop your Hevy/Strong export as a
   document → `packages/importers` runs server-side unchanged → reply is the existing import
   report (ambiguities, dedupe). Time-to-first-value: under a minute, no install, no signup —
   `initData`/`message.from.id` is the account. Hevy's own onboarding cannot beat "forward a file
   to a chat".
3. **Explainable recommendations as messages.** `Recommendation` already carries `explanation`,
   `reasonCodes`, `evidence`, `confidence` (`packages/progression-engine/src/types.ts`) — it
   renders as a chat line with zero UI work, and lands the evening before the workout, not buried
   in an app screen. The product's differentiator gets a delivery channel.
4. **The coach/group loop** — the one surface where chat provably wins (Skeptic §3): end-of-
   session prescribed-vs-actual summary cards posted into a chosen group/coach chat, forwardable;
   coach replies adjust the next prescription. This is Ferrum's shareable artifact and its only
   viral loop — bots aren't discoverable by search, but messages are forwardable.
5. **Ambient capture with provenance.** "squat 100x5" typed anywhere (even offline — Telegram's
   client outbox delivers on reconnect) lands as a provenance-tagged event, exactly the
   `source: telegram` import path commit c149593 built the plumbing for; a Telegram
   `edited_message` maps to `SetAmended`. Forgot-to-log-Tuesday stops being lost data.

One sentence: **the local-first logger keeps the set loop; Telegram gets the push, onboarding,
explanation and social loops — each of which is impossible or worse in an iOS PWA.**

### 3. Build plan (aligned with the existing phase-4 recipe)

| Phase                                                   | Contents                                                                                                                                                                                                                                                                                                                                                                  | New code                                                                                                                                     | Effort                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **4a — Server spine**                                   | Postgres event log (`events`, `device_clocks`, `users` + `user_identities` per Backend §Auth), push/pull with `server_sequence` cursor + `(user_id, event_id)` idempotency, PWA sync client (triggers: start, mutation, `online`, `visibilitychange`, per INVARIANTS §14), deploy via the CLAUDE.md recipe (hidden-gem-shaped chart, `Database` CR, sensor, ImageUpdater) | `services/api` (Hono/Fastify), `packages/sync-protocol`, server twin of `event-store.ts`                                                     | ~2 wk                                                                                  |
| **4b — Bot capture** (first shippable slice ships here) | grammY webhook (+`secret_token`, egress to `api.telegram.org` in netpol), `/start` deep-link account linking, **slice 1: CSV document import + shorthand `SetLogged` with `source: telegram` + `/undo` + end-of-session summary card** — importers/domain untouched                                                                                                       | `services/api` bot module, `packages/chat-grammar` (pure `text → AppendInput \| Ambiguity`, same ESLint determinism regime, property-tested) | ~1.5 wk; slice 1 ≈ 4 days once 4a exists                                               |
| **4c — Ambient loop**                                   | Rest-over push with "same again"/"+2.5" inline buttons, milestone-cadence card edits (5-6 edits/rest, inside flood limits per Backend §Notifications), scheduled reminders, weekly summary, group-chat summary sharing, `Recommendation` rendering                                                                                                                        | none (bot module grows)                                                                                                                      | ~1 wk                                                                                  |
| **4d — Mini App shell**                                 | Wrap `apps/pwa`: `initData` auth header, theme vars, `DeviceStorage` unsynced-event mirror, `addToHomeScreen()`, "install the PWA" upgrade prompt; Dexie path verbatim                                                                                                                                                                                                    | ~300 lines platform glue in `apps/pwa`                                                                                                       | ~1 wk + **Spike A now runs inside Telegram on a real iPhone (unchanged #1 open item)** |
| **4e — Measurement gate**                               | Skeptic's race: 2-4 weeks of parallel real training, count bot-logged vs PWA-logged sets, and one coach-pair summary-card trial; expand chat surface only where usage proves it                                                                                                                                                                                           | none                                                                                                                                         | calendar time                                                                          |

Ordering is forced by Backend risk #1: 4a is atomic (bot ingest before PWA pull = forked
history). Nothing here is throwaway — 4a is the pre-existing phase-4 plan verbatim, 4b/4c are
additive modules on it, and 4e is the honest check that keeps the Skeptic's null hypothesis
falsifiable instead of argued.

### 4. Preempting the attacker: three weakest points

1. **"Chat set-logging is slower than Hevy — so the pivot's core loop is a regression."**
   Conceded and designed around: the plan never puts the mid-set loop in chat. The set loop stays
   on the client that already wins it (1-tap local, offline); chat gets the loops Hevy's iOS-web
   rivals cannot have at all (push, zero-install import, forwardable summaries). If the attacker
   insists "then it isn't chat-first" — chat-first describes _acquisition and ambient life_
   (first touch, daily touches), not where a rep is recorded; that is the only reading under
   which the question has a good answer, and 4e measures it rather than asserts it.
2. **"No bot discovery; the category has zero winners — you're building distribution fantasy."**
   The failed prior art (gymnote, NextSet…) are server-state command loops — thin toys, all
   competing on the loop chat is worst at. This plan's distribution asset is the forwardable
   summary card and the coach loop — messages spread; bots don't need search when every shared
   card is a deep link. And the downside is capped: ~2.5 wk of bot code on top of a server that
   phase 4 required regardless; if 4e shows zero pull, Ferrum still exits with sync, backup,
   accounts and push — the three hardest open items closed.
3. **"iOS webview storage is Telegram's, not yours — §8a durability is a lie in the Mini App."**
   Correct as stated, wrong as an objection: after 4a, durability is layered — Postgres (synced,
   minutes-fresh) → DeviceStorage mirror (survives webview cache wipes) → webview IndexedDB
   (current session). The exposure window is "unsynced events of the session in progress, on a
   user who cold-opened via Mini App, in a basement, after Telegram wiped its cache mid-session"
   — strictly smaller than today's PWA exposure (entire history on one device). The installed
   PWA remains the documented answer for offline cold-open, and Spike A verifies the webview
   claims on hardware before 4d ships.

## Round 2 — Attacker

Target: the emerging hybrid consensus (PWA/Mini App = gym client, bot = ambient client, phase 4 forced now). Verdict up front: the hybrid survives only after amputation — its Mini App leg is already dead by Round 1's own evidence, its write-grammar leg violates the repo's central invariant in an unfixable way, and its sequencing inverts the repo's stated priorities. What survives is much smaller than the consensus pretends.

### A1. The Mini App leg of the hybrid is already refuted by Round 1 — the consensus is quietly ignoring its own evidence

The Architect's resolution (§3: "the Mini App is the gym client") and the Platform Realist's finding are in direct contradiction, and the Realist has the receipts: no service workers in Telegram's iOS WKWebView (open since July 2024, <https://github.com/Telegram-Mini-Apps/issues/issues/27>), therefore **a Mini App cannot open offline on iOS at all**. The Backend Engineer's "ship the workout screen as a Mini App that reuses the PWA event store" inherits the same refuted premise. So the honest hybrid is not {Mini App gym client + bot}; it is {the existing PWA + bot} — the Mini App adds a third client surface whose one claimed job (offline gym logging inside Telegram) it structurally cannot do on the platform half the users bring to the gym. The consensus keeps the Mini App in the plan mostly because it makes the pivot feel like a pivot. Cut it and "Hevy in Telegram" reduces to "the PWA plus a bot", which nobody would call chat-first.

### A2. Scope explosion: a distribution pivot before the product exists, with the repo's own words as the indictment

Repo state, verified now: `packages/progression-engine` is **entirely untracked** — work in flight, not one commit (`git status`: `?? packages/progression-engine/`, no tests directory yet). Spike A has a diagnostics harness (commit 0206ec9) but `CLAUDE.md` still lists it open: **nothing in this repo has ever run on a real iPhone**. The repo's own doctrine: "an empty package that builds nothing is dead weight that reads as progress", and the open-work list is importers polish, the three policies + replay harness, e1RM, muscle credit, sync protocol, Spike A.

The hybrid forces, simultaneously: `services/api` (webhook + ingest + sync endpoints), `packages/sync-protocol`, a Postgres event store re-implementing §8a over `device_clocks`, identity linking (`users` + `user_identities` + deep-link token flow), `packages/chat-grammar` with property tests, bot conversation state, rest-timer push scheduling, Mini App auth/theming, plus the full gitops onboarding (sensor, chart, ImageUpdater, DNS, secrets, a NetworkPolicy egress hole to api.telegram.org). At this repo's own testing bar (e2e drills for every core promise — replay.test.ts, workout-loss.spec.ts have no server-side or sync equivalent yet, and would need one), that is honestly **6–9 weeks**: 3–4 for phase 4 done properly with sync drills, 2–3 for bot + grammar + auth linking, 1–2 for the Mini App wrapper and an in-Telegram device spike. Meanwhile the differentiator the bot is supposed to _render_ — the progression engine — is uncommitted. This is the classic trap: building the distribution channel for a recommendation product whose recommendation engine does not exist yet. A single-user project does not have a distribution problem; it has a Spike-A problem.

### A3. The grammar doesn't just risk mis-parses — the event model makes bot mis-parses _permanently wrong_, by design

Concede the obvious steelman first: the Architect is right that the grammar must "refuse to guess where the domain refuses to guess" (§2/§4: `loadEntryMode`, `laterality`, `repCountMode` are identity-defining; `resolveLoad` returns `indeterminate` rather than invent numbers). A disciplined grammar can ask-once-and-persist. That point holds.

The attack is one level deeper, in §5 (immutable fields): once `SetLogged` exists, `recordedAt`, `localDate`, `tzOffsetMinutes`, `sourceDeviceId`, `sessionExerciseId`, `exerciseRevisionSnapshot`, `prescriptionSnapshot` are **structurally unamendable** — `SetAmendedPayload` has no such fields. Two consequences the consensus hasn't priced:

1. **Telegram's offline outbox — the one "free" offline story chat has — writes immutable lies.** A set typed at 23:50 in a basement and delivered at 00:40 gets server-receipt time; the bot must stamp `recordedAt` and derive `localDate` from _something_, and `message.date` is receipt time (all four Round 1 sections note the timestamp problem; none notes that §5 makes it **uncorrectable afterwards**). Wrong `localDate` moves the session across a week boundary (§12) forever. The PWA path cannot produce this class of error; the bot path produces it precisely in the offline scenario the hybrid claims to have solved.
2. **A mis-resolved exercise cannot be amended into the right one.** `sessionExerciseId` and `exerciseRevisionSnapshot` are immutable; fuzzy-matching "press 100x5" to the wrong definition requires delete + re-log — a new event with a new `recordedAt`, severed from its prescription snapshot. `comparisonSignature` being amendable (correcting _which machine_) does not cover _which exercise_. So every fuzzy-match error is either a permanent data-quality hole or a tombstone + orphaned re-entry. Hevy's tap UI has a mis-tap rate near zero on exercise identity; a text grammar's mis-resolution rate is strictly positive and each instance is unrepairable. For a product whose entire thesis is "prescribed vs actual, reproducible from inputs", the ambient write path is a contamination channel into the evidence base.

Cheap partial fix exists (bot previews the parse and requires one confirmation tap before appending) — but that adds the round-trip tax to every set and concedes the "faster than the incumbent" bar (Product Skeptic's 9-interactions arithmetic already killed it).

### A4. Telegram in 2026 is a uniquely bad platform bet for _this_ repo's philosophy — and the facts moved in the last 12 months

- **Russia has effectively fully blocked Telegram**: phased slowdown from 2026-02-10, ~80% request failure by March, near-total (95%) block since mid-March with a full block reported planned for April 2026, plus the state Max messenger push (<https://en.zona.media/article/2026/04/07/russian_internet_censorship_2026>, <https://www.cnn.com/2026/02/10/europe/telegram-ban-russia-web-block-latam-intl>, <https://www.amnesty.org/en/latest/news/2026/02/russia-slowing-down-of-telegram-messaging-app-another-blow-for-freedom-of-expression/>). Whatever one thinks of the audience question, a large slice of the RU-speaking gym demographic a Telegram-first product would naturally target now reaches Telegram only through workarounds.
- **EU exposure is live, not theoretical**: the Commission's JRC is technically investigating whether Telegram lied about being under the 45M-user DSA threshold (<https://www.ftm.eu/articles/telegram-plays-down-user-figures-to-avoid-stricter-eu-rules-documents-reveal>, <https://www.engadget.com/big-tech/eu-officials-believe-telegram-lied-about-user-numbers-to-skirt-regulation-165538148.html>); the Durov criminal probe is in its second year — fourth interrogation mid-2026, charges not dismissed, though travel restrictions were lifted Nov 2025 (<https://www.techpolicy.press/pavel-durov-arrest-tracker/>, <https://www.nbcnews.com/tech/tech-news/telegram-ceo-pavel-durov-charged-french-prosecutors-rcna168603>).
- **Telegram rewrites platform rules with ~30-day compliance deadlines**: the Jan 2025 bot-developer ToS forced all Mini Apps onto TON with a Feb 21 migration cutoff (<https://telegram.org/tos/bot-developers>, <https://aurum.law/newsroom/Telegram-Mini-App-Legal-Checklist-in-2025>). Today's target is crypto; the precedent is "your Mini App's continued operation is contingent on next month's ToS".
- The philosophical contradiction is not cosmetic. This workspace migrated **off GitHub onto self-hosted Forgejo**; Ferrum's product bar is "stays valuable with social features, wearables, AI and payment entirely switched off". A client whose availability = P(Telegram DC) × P(state-level blocking) × P(ToS stability), on a platform with no SLA, is the single most switched-on dependency this workspace would own. The Architect's §5.6 concession ("local-first marketing claim quietly dies for chat-only users") is the tell — the hybrid keeps the invariant only by keeping the non-Telegram client primary, which is another way of saying Telegram must stay optional, which is another way of saying it's a notification channel.

### A5. The sync problem gets harder in a way the current test suite cannot see

The consensus sells "the bot is just another device". Verified against the code: `receive()` — the only merge primitive, with its 60 s `ClockDriftError` — **has zero production call sites**; it exists in `packages/domain/src/hlc.ts` and is exercised only by tests. Every existing guarantee is single-store: `replay.test.ts` permutes events in memory; `multi-tab.spec.ts` drives two tabs against **one** IndexedDB (§8a's whole design point is making the browser serialize one clock). Nothing anywhere tests two independent HLC nodes exchanging batches. Adding a server-side writer _before_ `packages/sync-protocol` exists creates, on day one: (a) fork-by-default — the Backend Engineer conceded this exactly ("shipping bot ingest before PWA push/pull leaves two authoritative stores diverging behind a green UI") and the mitigation is "land it all as one phase", i.e. the maximal big-bang; (b) an unhandled `ClockDriftError` path — real phones run minutes off; a device >60 s ahead makes the server's `receive()` **throw** on merge, and no code or test defines whether that batch is rejected, quarantined, or wedges the queue; (c) a genuinely new race the event model has no answer for: the bot's `chat_state.focus_exercise_id` cursor resolves "100x5" to a `sessionExerciseId` while a concurrently-offline PWA reorders/substitutes that exercise — the set lands on the wrong immutable `sessionExerciseId` (§5 again) and HLC total order cannot fix it because both writes are _valid_. That is a semantic conflict class (stale-cursor attribution) that none of the 13 event types, none of the replay properties, and no planned test covers.

### A6. The 80% alternative the consensus skipped: bot as read-only channel + importer-provenance capture

Round 1 already contains the disproof of the write path's necessity, spread across sections:

- The **only outright Telegram win** every section agrees on is push (rest-timer, reminders, summaries) — because iOS Web Push can't wake a closed PWA (INVARIANTS §14). Push is **read-only**. It requires a bot token, `services/api`, and a `sendMessage` call — not a grammar, not conversation state, not a second writer in the sync mesh.
- The Product Skeptic's prior-art sweep found zero successful chat loggers, voice (not chat) as where the shorthand grammar actually wins, and proposed the decisive ≤1-week experiment: bot available in parallel for 2–4 weeks, measure what fraction of sets get logged through it voluntarily. **No Round 1 evidence justifies building the write path before that number exists.**
- For the residual write cases ("forgot to log Tuesday", post-hoc capture), the repo _already shipped the right abstraction_: import provenance inside the set event (commits bc9ff05, c149593 — Hevy/Strong CSV → provenance-tagged events, `prescriptionSnapshot: null`, unprescribed). A message forwarded to the bot is a fourth importer source processed as **batch import with an ambiguity report the user reviews**, not a live logger racing the session cursor. That reuses `packages/importers` untouched, keeps the server a _reader + importer_ (no HLC node, no `device_clocks`, no fork risk — imports enter through the existing PWA import path on next open), and defers `packages/sync-protocol` until multi-device actually demands it.

Cost of this alternative: bot token + one small webhook service + summary rendering off `projectSession()` — roughly 1–2 weeks, zero new invariants at risk. It captures the push win (the actual 80%), the CSV-onboarding win, and the summary/coach-loop wedge, while the write grammar and the Mini App wait for evidence that anyone logs mid-workout through chat.

### Concessions (what genuinely holds)

1. Phase 4 (`services/api` + Postgres event log) was always coming; the bot is a legitimate _first consumer_ of it — the attack is on sequencing and on sync-protocol-with-two-writers, not on ever building a server.
2. Telegram push genuinely does what iOS Web Push provably cannot (WebKit 282935/268797); any Ferrum future with reminders wants a bot channel.
3. `initData` HMAC auth is real and fits the no-third-party-redirect constraint — _for the Telegram surface only_; it does not solve PWA auth (§14 keeps that on-origin).
4. The domain layer's portability claim is true and verified — `projectSession()` and the progression types would render into chat unchanged. The packages are not the problem; the product shape is.

### Attacker's bottom line

The hybrid as stated is three clients, two writers, and a merge protocol for a one-user product with an uncommitted recommendation engine that has never run on an iPhone — justified by a platform that a nation-state just finished blocking and whose regulator relationship is an open criminal probe. Strip what Round 1's own evidence already killed (Mini App offline on iOS, chat as the fast logger) and what the invariants forbid (guessed identity fields, unamendable wrong timestamps), and the defensible remainder is: **read-only bot for push/summaries + message-as-import-source through the existing provenance pipeline, gated by the Skeptic's usage experiment before any live write grammar exists.**

## Final Synthesis

### TL;DR

"Hevy, but in Telegram" is the wrong sentence; the right one is **"Ferrum, with Telegram as its
push, onboarding and social layer."** Every line of evidence across both rounds converges on the
same split: the per-set logging loop must stay on a local-first client you own (chat loses it
1 tap vs ~3-9 interactions, needs three networks, and the iOS Telegram webview cannot cold-open
offline), while Telegram wins outright exactly where the iOS PWA is structurally mute — real push
to a locked phone, zero-install onboarding by forwarding a CSV, forwardable prescribed-vs-actual
summary cards, and chat-rendered `Recommendation` explanations. Build the Telegram surface in
that order, gate the chat _write_ grammar on measured usage, and treat the Mini App as the last
step, not the first.

### Recommendation (sequenced)

1. **Finish the product before the channel.** `packages/progression-engine` is uncommitted and
   Spike A has never touched a real iPhone. The bot's killer message — an explainable
   recommendation the evening before a workout — cannot ship before the engine exists. Order:
   progression engine → Spike A (now also covering the Telegram webview) → then the pivot.
2. **Phase 4a, unchanged and atomic**: `services/api` + Postgres event log
   (`(user_id, event_id)` idempotency, `server_sequence` cursor) + `packages/sync-protocol` +
   PWA sync client, deployed via the existing recipe (hidden-gem-shaped chart, `Database` CR on
   CloudNativePG, webhook ingress, SOPS bot token, netpol egress to `api.telegram.org`). This
   was always the plan; the pivot only decides its consumer. Never ship bot ingest before PWA
   pull — that is a forked history by construction.
3. **Bot v1 is read-only plus importer** (~1-2 weeks on top of 4a): grammY webhook,
   `initData`/deep-link identity rows (`user_identities`, link-before-log), rest-over and
   reminder pushes with a one-tap "same again" button, end-of-session summary cards shareable
   into a coach/group chat, Recommendation rendering, and CSV/document import through
   `packages/importers` untouched. This captures every uncontested win with zero new invariants
   at risk.
4. **Chat write path enters as import provenance, not as a live second writer.** "squat 100x5"
   messages (including Telegram's offline outbox backlog) are processed like a fourth importer
   source: parsed by a pure, property-tested `packages/chat-grammar`, previewed with one
   confirmation tap, appended as provenance-tagged unprescribed events. This defuses the two
   fatal objections — §5-immutable `recordedAt`/`localDate` stamped from receipt-time lies, and
   the stale-cursor race attributing a set to a `sessionExerciseId` a concurrent offline device
   just reordered — because import events don't race a live session cursor and their provenance
   is explicit. The grammar must ask-once-and-persist for identity-defining fields (per-hand vs
   total); it never guesses.
5. **Measure before expanding** (the Skeptic's race): 2-4 weeks of real training with the bot
   available in parallel; count voluntarily bot-logged sets and run one coach-pair summary-card
   trial. Only real mid-workout usage justifies a live conversational logger; the burden of
   proof sits on chat.
6. **Mini App last**: a shell over `apps/pwa` (initData auth, theme, DeviceStorage mirror of
   unsynced events, `addToHomeScreen()`), valuable as a zero-install trial and warm-offline
   client (opened with signal, survives the basement; IndexedDB works in a loaded WKWebView),
   with the installed PWA as the documented offline-cold-open answer and the bot prompting that
   upgrade. Ship only after Spike A verifies webview storage on hardware.

### Key tradeoffs

- **Reach vs. ownership.** Telegram gives push and zero-install reach an iOS PWA can never have;
  it costs a dependency with no SLA, a live EU/DSA and Durov legal cloud, ToS rewrites with
  ~30-day deadlines, and a near-total RU block (March 2026) sitting exactly on the RU-speaking
  demographic a Telegram-first product would target. The plan prices this by keeping Telegram
  strictly optional — a channel, never the system of record — which is also what the product bar
  ("valuable with everything switched off") already demanded.
- **Speed vs. integrity of the write grammar.** A confirmation tap on parsed sets surrenders the
  "faster than Hevy" claim for chat entry; skipping it contaminates the evidence base with
  unamendable mis-parses. Integrity wins: chat capture is for ambient/forgot-to-log entries
  where the alternative is _no data_, not for racing the checkmark.
- **Scope vs. sequencing.** The full hybrid is honestly 6-9 weeks at this repo's testing bar.
  Steps 2-3 cap the initial bet at ~3-4 weeks, ~80% of which (server spine, sync, accounts,
  backup) the repo needed regardless of Telegram — the walk-away cost of the bet is ~1-2 weeks
  of bot code.

### Strongest counter-argument to this synthesis

The Attacker's sharpest line stands: _a single-user project has a Spike-A problem, not a
distribution problem_ — even the trimmed plan builds channel infrastructure before any evidence
that a second user, or even the first user mid-workout, wants chat at all. The rebuttal is that
step 3's deliverables (push a PWA cannot do, CSV onboarding, shareable summaries) are valuable
to the single existing user today and ride on infrastructure phase 4 owed anyway — but if
anything slips, the correct casualty order is: Mini App first, write grammar second; the
read-only bot and the server spine are the parts that survive any honest cut.

### Sources (load-bearing)

- No service workers in Telegram iOS webview (no offline cold-open): <https://github.com/Telegram-Mini-Apps/issues/issues/27>
- IndexedDB works in a loaded WKWebView (Apple guidance): <https://developer.apple.com/forums/thread/745615>
- Mini Apps platform, DeviceStorage/SecureStorage, initData: <https://core.telegram.org/bots/webapps> ; <https://core.telegram.org/bots/api-changelog>
- Rate limits (~1 msg/s per chat, 30/s global; edits share the bucket): <https://core.telegram.org/bots/faq> ; <https://gramio.dev/rate-limits>
- Hevy 1-tap loop and growth (15M+ users, no paid marketing): <https://help.hevyapp.com/hc/en-us/articles/35361530647959> ; <https://obj.ca/fitness-app-entrepreneur-pumped-by-hevys-progress-to-2m-in-annual-revenue/>
- Bot discovery is structurally absent: <https://www.airdroid.com/ai-insights/how-to-find-bots-in-telegram/>
- Voice, not chat, is where the shorthand grammar wins mid-workout: <https://ghostfit.ai/blog/ai-technology-in-fitness/why-i-built-a-voice-first-workout-tracker-because-most-apps-slow-you-down>
- grammY vs Telegraf (downloads, maintenance): <https://npmtrends.com/grammy-vs-node-telegram-bot-api-vs-telegraf-vs-telegram-bot-api> ; <https://grammy.dev/resources/comparison>
- Telegram platform risk 2026: RU block <https://en.zona.media/article/2026/04/07/russian_internet_censorship_2026> ; EU/DSA probe <https://www.ftm.eu/articles/telegram-plays-down-user-figures-to-avoid-stricter-eu-rules-documents-reveal> ; Durov tracker <https://www.techpolicy.press/pavel-durov-arrest-tracker/> ; bot-developer ToS precedent <https://telegram.org/tos/bot-developers>
