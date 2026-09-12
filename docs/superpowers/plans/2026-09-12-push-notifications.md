# Push Notifications & Réglages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Web Push reminders (morning priorities + per-task, delivered server-side even when the app is closed) and the Réglages screen that controls them, on top of the already-shipped, already-deployed offline-sync PWA (Plans 1 and 2).

**Architecture:** A new `push.js` manages the client-side Web Push subscription lifecycle (permission, `PushManager.subscribe()`, storing the subscription in Supabase). A new `settings.js` reads/writes `user_settings` (morning reminder time, notifications on/off) with plain direct Supabase calls — these are inherently online-only actions (subscribing to push requires live contact with the browser's push service), so unlike task edits they are NOT routed through the offline mutation queue. Per-task reminder times ARE routed through the existing offline queue (`sync.js`/`syncLogic.js`), exactly like the existing `urgent`/`important`/`done` edits, since setting a reminder time on a task is conceptually identical to those. The server-side half (Edge Function `send-reminders`, VAPID keys, `pg_cron` schedule) was already written and code-reviewed before Plan 1 started; this plan deploys it rather than writing it from scratch. `service-worker.js` gains a `push` event listener to display notifications and a `notificationclick` listener to focus/open the app.

**Tech Stack:** Same as Plans 1-2 (vanilla JS, ES modules, no build step) plus the browser's native Web Push API (`PushManager`, `Notification`) — no new libraries on the client. Server side: Supabase Edge Functions (Deno), `pg_cron` + `pg_net`, the `npm:web-push` Deno import (already used in the existing Edge Function code).

**Spec:** `docs/superpowers/specs/2026-09-04-mon-app-taches-design.md` (sections "Notifications push", "Maintien en activité du projet Supabase", and the Réglages bullet under "Interface")

## Scope of this plan vs. the rest of the spec

This is **Plan 3 of 3** — the last one. Plans 1 and 2 (done, deployed) built auth, CRUD, the Eisenhower UI, export, offline sync, and PWA installability. This plan finishes the spec: push notifications, the Réglages screen, and the Supabase keep-alive ping.

**Two scope decisions worth stating explicitly, since a reviewer comparing this plan against the spec's Réglages bullet could otherwise read them as gaps:**

- The spec lists "Exporter mes tâches (JSON)" and "déconnexion" as Réglages items. Both already exist and work, in the app header (shipped in Plan 1). This plan does **not** relocate them into the new Réglages screen — moving a working, tested UI element is unrelated churn, not a notifications feature. Réglages in this plan holds only the two settings that are genuinely new: heure du rappel matinal, activation des notifications. The spec's "la déconnexion désabonne aussi le push" requirement is still implemented (Task 6), just as a change to the *existing* header sign-out handler, not as new Réglages UI.
- `notifications_enabled`, `morning_reminder_time`, and the push-subscribe/unsubscribe actions are implemented as plain direct Supabase calls, with normal error surfacing via the existing `showAppError`/`safely()` pattern — NOT queued through `sync.js`'s offline mutation queue. Reason: subscribing to push requires live network contact with the browser's push service (`PushManager.subscribe()` cannot succeed offline no matter what), so there is nothing meaningful to "queue and retry later" for that action. Per-task reminder times are different — they're a plain database field edit with no such live-network requirement — so those DO go through the offline queue, matching `urgent`/`important`/`done`.

## Global Constraints

- Frontend is vanilla HTML/CSS/JS — no bundler, no build step, no `npm install` for anything the browser loads.
- The Supabase JS client is already vendored same-origin at `vendor/supabase-js.esm.js` (Plan 2). Nothing in this plan reintroduces a cross-origin CDN import anywhere.
- Every Supabase table already has RLS with `user_id = auth.uid()` (from Plan 1's migration, `supabase/migrations/0001_init.sql`) — this plan uses the existing `user_settings` and `push_subscriptions` tables as-is and does not touch the schema.
- **The VAPID public key is safe to hardcode client-side** (it's the whole point of the public/private split) and is embedded verbatim in this plan's Task 4. **The VAPID private key and `CRON_SECRET` must never be committed to the repo, ever** — they exist only as Supabase Edge Function secrets, handled entirely in Task 8 (a controller/human-driven deployment task, not a coding subagent task), never written into any file this plan creates.
- The service worker's `CACHE_VERSION` must be bumped by hand on any task that changes a file listed in its `ASSETS` array — this is the existing, already-documented rule from Plan 2 (`service-worker.js`'s own comment, and the README's "Déploiement" section); it applies again here.
- No realtime, no client-side polling for reminders — delivery is entirely server-driven (`pg_cron` → Edge Function → Web Push), unchanged from the spec's existing design. This plan only deploys and wires up what the spec already specifies; it does not add any new sync trigger.
- Task-level reminder-time edits go through the existing offline mutation queue (`sync.js`/`syncLogic.js`), following the exact pattern already used for `urgent`/`important`/`done`. Settings/push actions do not (see "Scope of this plan" above).

---

### Task 1: Pure sync logic extension — `setReminderTime` mutation type

**Files:**
- Modify: `syncLogic.js`
- Modify: `syncLogic.test.js`

**Interfaces:**
- Produces (used by Task 2):
  - `applyMutation` gains a new case: `{ type: "setReminderTime", id: string, reminderTime: string | null }` — returns a new array with the matching task's `reminder_time` field updated.
- `resolveMutationIds` and `buildOptimisticTasks` are unchanged — this mutation type only ever targets an existing task by id (never a temp id created in the same batch), so no new id-remapping behavior is needed.

- [ ] **Step 1: Write the failing test** — add to the end of `syncLogic.test.js` (keep every existing test in the file unchanged):

  ```js
  test("applyMutation setReminderTime updates only the matching task", () => {
    const tasks = [
      makeTask({ id: "a", reminder_time: null }),
      makeTask({ id: "b", reminder_time: null }),
    ];
    const result = applyMutation(tasks, { type: "setReminderTime", id: "a", reminderTime: "09:30" });
    assert.equal(result.find((t) => t.id === "a").reminder_time, "09:30");
    assert.equal(result.find((t) => t.id === "b").reminder_time, null);
  });

  test("applyMutation setReminderTime can clear a reminder by passing null", () => {
    const tasks = [makeTask({ id: "a", reminder_time: "09:30" })];
    const result = applyMutation(tasks, { type: "setReminderTime", id: "a", reminderTime: null });
    assert.equal(result[0].reminder_time, null);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test syncLogic.test.js`
  Expected: FAIL — both new tests fail because `applyMutation` doesn't recognize `"setReminderTime"` and falls through to the `default` case, leaving `reminder_time` as `undefined` (from `makeTask`'s spread, which doesn't set it unless overridden) rather than the mutation's value.

- [ ] **Step 3: Write the implementation** — in `syncLogic.js`, add a new `case` to the `switch` inside `applyMutation`, alongside the existing `"create"`/`"setTag"`/`"setDone"`/`"delete"` cases (add it anywhere in the switch, e.g. right after `"setTag"`; do not change any other case):

  ```js
    case "setReminderTime":
      return tasks.map((t) =>
        t.id === mutation.id ? { ...t, reminder_time: mutation.reminderTime } : t
      );
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test syncLogic.test.js`
  Expected: PASS — 12 tests, 0 failures (10 existing + 2 new).

- [ ] **Step 5: Commit**

  ```bash
  git add syncLogic.js syncLogic.test.js
  git commit -m "$(cat <<'EOF'
  Add setReminderTime mutation type to the offline sync logic

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 2: Task-level reminder time — `tasks.js` + `sync.js`

**Files:**
- Modify: `tasks.js`
- Modify: `sync.js`

**Interfaces:**
- Consumes: `applyMutation` (Task 1, already handles `"setReminderTime"`).
- Produces (used by Task 6):
  - `updateReminderTime(id: string, reminderTime: string | null): Promise<void>` — exported from `sync.js`, network-first with offline-queue fallback, same shape as `updateTag`/`updateDone`.

**No automated tests for this task** — both functions are thin Supabase/queue wrappers around already-tested logic (`setTag`'s equivalent isn't unit-tested either, for the same reason). Verification is `node --check` plus reading the code back against the existing `updateTag` pattern it's modeled on.

- [ ] **Step 1: Add `setReminderTime` to `tasks.js`** — add this new function anywhere in the file (e.g. right after `setTag`); do not change any existing function:

  ```js
  export async function setReminderTime(id, reminderTime) {
    const { error } = await supabase.from("tasks").update({ reminder_time: reminderTime }).eq("id", id);
    if (error) throw error;
  }
  ```

- [ ] **Step 2: Wire it into `sync.js`** — three small, separate edits to the existing file:

  1. Add `setReminderTime` to the existing `tasks.js` import at the top of the file. The current line is:
     ```js
     import { createTasksFromLines, listTasks, setTag, setDone, deleteTask } from "./tasks.js";
     ```
     Change it to:
     ```js
     import { createTasksFromLines, listTasks, setTag, setDone, deleteTask, setReminderTime } from "./tasks.js";
     ```

  2. Add a new exported function, following the exact pattern of `updateTag` right above it:
     ```js
     export async function updateReminderTime(id, reminderTime) {
       try {
         await setReminderTime(id, reminderTime);
       } catch (_err) {
         const mutation = { type: "setReminderTime", id, reminderTime };
         await enqueueMutation(mutation);
         const cached = await getCachedTasks();
         await setCachedTasks(applyMutation(cached, mutation));
       }
     }
     ```

  3. Inside `doFlush()`'s `if`/`else if` chain (the block that replays each queued mutation type), add a new branch. The current chain ends with:
     ```js
         } else if (resolved.type === "delete") {
           await deleteTask(resolved.id);
         }
     ```
     Change it to:
     ```js
         } else if (resolved.type === "delete") {
           await deleteTask(resolved.id);
         } else if (resolved.type === "setReminderTime") {
           await setReminderTime(resolved.id, resolved.reminderTime);
         }
     ```

- [ ] **Step 3: Syntax-check**

  Run: `node --check tasks.js` and `node --check sync.js`
  Expected: no output from either (success).

- [ ] **Step 4: Verify by reading, in your report**

  Read both files back and confirm in your report: (a) `setReminderTime` in `tasks.js` matches `setTag`'s exact shape (same error handling, same `.eq("id", id)` pattern), (b) `updateReminderTime` in `sync.js` matches `updateTag`'s exact shape, (c) the new `doFlush()` branch is reachable (i.e., it's a real `else if` in the existing chain, not dead code after a `return`), (d) no existing function in either file was altered.

- [ ] **Step 5: Commit**

  ```bash
  git add tasks.js sync.js
  git commit -m "$(cat <<'EOF'
  Add task reminder-time updates through the offline-aware sync layer

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 3: `settings.js` — user settings CRUD

**Files:**
- Create: `settings.js`

**Interfaces:**
- Produces (used by Task 6):
  - `getSettings(): Promise<{ morning_reminder_time: string | null, notifications_enabled: boolean, timezone: string }>`
  - `setMorningReminderTime(time: string | null): Promise<void>`
  - `setNotificationsEnabled(enabled: boolean): Promise<void>`

**No automated tests** — every function here is a direct Supabase call requiring a real network/session, same category as `tasks.js`'s functions (none of which are unit-tested either). Verification is `node --check` plus a structural read-back.

- [ ] **Step 1: Write `settings.js`**

  ```js
  import { supabase } from "./supabaseClient.js";

  async function requireUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user) throw new Error("Session expirée, reconnecte-toi.");
    return user;
  }

  export async function getSettings() {
    const user = await requireUser();
    const { data, error } = await supabase
      .from("user_settings")
      .select("morning_reminder_time, notifications_enabled, timezone")
      .eq("user_id", user.id)
      .single();
    if (error) throw error;
    return data;
  }

  export async function setMorningReminderTime(time) {
    const user = await requireUser();
    const { error } = await supabase
      .from("user_settings")
      .update({ morning_reminder_time: time })
      .eq("user_id", user.id);
    if (error) throw error;
  }

  export async function setNotificationsEnabled(enabled) {
    const user = await requireUser();
    const { error } = await supabase
      .from("user_settings")
      .update({ notifications_enabled: enabled })
      .eq("user_id", user.id);
    if (error) throw error;
  }
  ```

  Note: `requireUser()` is a small internal (not exported) helper — the three public functions each need "the current signed-in user's id" and this avoids repeating the same four lines three times in one file. Every `user_settings` row already exists for every user by the time they can sign in (Plan 1's `handle_new_user()` trigger creates it at sign-up), so `.single()` on the `select` is safe — it will never return zero rows for a real signed-in user.

- [ ] **Step 2: Syntax-check**

  Run: `node --check settings.js`
  Expected: no output (success).

- [ ] **Step 3: Verify by reading, in your report**

  Read the file back and confirm in your report: all three exported functions call `requireUser()` first, all three target `user_settings` filtered by `.eq("user_id", user.id)` (never a query that could touch another user's row — RLS would also block it, but the query itself should already be correctly scoped), and the column names (`morning_reminder_time`, `notifications_enabled`, `timezone`) match exactly what's in `supabase/migrations/0001_init.sql`'s `user_settings` table definition (read that file to confirm).

- [ ] **Step 4: Commit**

  ```bash
  git add settings.js
  git commit -m "$(cat <<'EOF'
  Add settings.js for reading and writing user_settings

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 4: `push.js` — Web Push subscription management

**Files:**
- Create: `push.js`

**Interfaces:**
- Produces (used by Task 6):
  - `subscribeToPush(): Promise<void>` — requests permission implicitly via `PushManager.subscribe()`, then stores the subscription in `push_subscriptions`. Throws if the browser denies permission or the write fails (caller surfaces the error normally — this is not queued, see Global Constraints).
  - `unsubscribeFromPush(): Promise<void>` — unsubscribes the browser's `PushManager` and deletes the matching row from `push_subscriptions`. If there is no active subscription, it's a silent no-op (not an error) — this matters for Task 6's sign-out handler, which calls this unconditionally on every sign-out even if the user never enabled notifications.

**No automated tests** — every function here depends on `navigator.serviceWorker`, `PushManager`, and `atob`, none of which exist in Node. Verification is `node --check` plus a hand-trace in the report, same category as Plan 2's `storage.js`/`service-worker.js`.

- [ ] **Step 1: Write `push.js`**

  ```js
  import { supabase } from "./supabaseClient.js";

  // Generated once via `npx web-push generate-vapid-keys` for this project.
  // Public key only — safe to ship to the client by design (VAPID's whole
  // point is that the private half never leaves the server). See Task 8 for
  // where the matching private key lives (Supabase Edge Function secrets,
  // never in this repo).
  const VAPID_PUBLIC_KEY =
    "BDZI4YXGXEpAmM_f6Q3nJOyPBiWSkENx0UIcHtfnMDK_XaG3dBH3ZsR2F_e1-ekWWvxREcMfKUKrAnngoggUVrI";

  // PushManager.subscribe() requires the VAPID key as a Uint8Array, but it's
  // generated and stored as a URL-safe base64 string — this converts between
  // the two. Standard, unavoidable boilerplate for the Push API.
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function requireUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user) throw new Error("Session expirée, reconnecte-toi.");
    return user;
  }

  export async function subscribeToPush() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const user = await requireUser();
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth_key: json.keys.auth,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
  }

  export async function unsubscribeFromPush() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  }
  ```

- [ ] **Step 2: Syntax-check**

  Run: `node --check push.js`
  Expected: no output (success). As with `storage.js` in Plan 2, this only confirms the JS parses — `navigator`, `atob`, and `PushManager`-style globals don't exist in plain Node, so this file cannot actually execute there. That's expected.

- [ ] **Step 3: Trace through two scenarios by hand, in your report**

  1. **First-time subscribe:** a signed-in user with no existing subscription clicks "Activer les notifications" (Task 6 wires this to call `subscribeToPush()`). Walk through what `registration.pushManager.subscribe(...)` returns, what `subscription.toJSON()` looks like (endpoint + keys.p256dh + keys.auth), and confirm the `upsert` call's shape exactly matches `push_subscriptions`'s columns (`user_id`, `endpoint`, `p256dh`, `auth_key`) from `supabase/migrations/0001_init.sql` — read that file to confirm column names match exactly.
  2. **Sign-out on a device that was never subscribed:** Task 6's sign-out handler will call `unsubscribeFromPush()` unconditionally. Walk through what happens when `registration.pushManager.getSubscription()` resolves to `null` — confirm the function returns early without throwing, so a user who never enabled notifications can still sign out normally.

- [ ] **Step 4: Commit**

  ```bash
  git add push.js
  git commit -m "$(cat <<'EOF'
  Add push.js for Web Push subscription management

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 5: Service worker — handle incoming push events

**Files:**
- Modify: `service-worker.js`

**Interfaces:** none — runs in its own worker context, same as the rest of `service-worker.js`.

- [ ] **Step 1: Bump `CACHE_VERSION`** — this task adds two new files (`push.js`, `settings.js`) to `ASSETS`, which requires the version bump per the file's own documented rule. Change:
  ```js
  const CACHE_VERSION = "v3";
  ```
  to:
  ```js
  const CACHE_VERSION = "v4";
  ```

- [ ] **Step 2: Add the two new files to `ASSETS`** — the current array ends with:
  ```js
    "./vendor/tslib-2.8.1.js",
  ];
  ```
  Change it to:
  ```js
    "./vendor/tslib-2.8.1.js",
    "./push.js",
    "./settings.js",
  ];
  ```

- [ ] **Step 3: Add `push` and `notificationclick` listeners** — add these at the end of the file, after the existing `fetch` listener (do not change the existing `install`/`activate`/`fetch` listeners):

  ```js
  self.addEventListener("push", (event) => {
    let payload = { title: "Mes Tâches", body: "Nouvelle notification" };
    if (event.data) {
      try {
        payload = event.data.json();
      } catch (_err) {
        payload = { title: "Mes Tâches", body: event.data.text() };
      }
    }
    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "./icons/icon-192.png",
      })
    );
  });

  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("./");
      })
    );
  });
  ```

  Note: the Edge Function (`supabase/functions/send-reminders/index.ts`, already written) sends exactly `{ title, body }` as the JSON payload via `webpush.sendNotification(subscription, JSON.stringify(payload))` — the `event.data.json()` branch above is what will actually run in production; the `event.data.text()` fallback only matters if a push is ever sent with a non-JSON body (defensive, not expected to trigger).

- [ ] **Step 4: Syntax-check**

  Run: `node --check service-worker.js`
  Expected: no output (success).

- [ ] **Step 5: Confirm every listed asset exists on disk**

  Run:
  ```bash
  for f in index.html style.css app.js supabaseClient.js tasks.js quadrants.js export.js sync.js storage.js syncLogic.js manifest.json icons/icon-192.png icons/icon-512.png vendor/supabase-js.esm.js vendor/supabase-auth-js-2.115.0.js vendor/supabase-functions-js-2.115.0.js vendor/supabase-postgrest-js-2.115.0.js vendor/supabase-realtime-js-2.115.0.js vendor/supabase-storage-js-2.115.0.js vendor/supabase-phoenix-0.4.5.js vendor/iceberg-js-0.8.1.js vendor/tslib-2.8.1.js push.js settings.js; do
    test -f "$f" && echo "OK: $f" || echo "MISSING: $f"
  done
  ```
  Expected: every line says `OK:`. Note `push.js` and `settings.js` won't exist yet unless Tasks 3 and 4 have already run — this task depends on them being complete first (this plan's tasks are executed in order, so by the time this step runs, both files exist from Tasks 3-4).

- [ ] **Step 6: Commit**

  ```bash
  git add service-worker.js
  git commit -m "$(cat <<'EOF'
  Handle incoming push events in the service worker; cache push.js/settings.js

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 6: Réglages screen, per-task reminder UI, sign-out unsubscribe

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `getSettings, setMorningReminderTime, setNotificationsEnabled` (Task 3); `subscribeToPush, unsubscribeFromPush` (Task 4); `updateReminderTime` (Task 2, from `sync.js`).

- [ ] **Step 1: Add a Réglages nav button to `index.html`** — the current nav is:
  ```html
        <button id="nav-history" data-active="false">Historique</button>
      </nav>
  ```
  Change it to:
  ```html
        <button id="nav-history" data-active="false">Historique</button>
        <button id="nav-settings" data-active="false">Réglages</button>
      </nav>
  ```
  Do not change anything else in the file.

- [ ] **Step 2: Add settings-form styling to `style.css`** — add this new rule anywhere in the file (e.g. right after the existing `#capture-form` rule); do not change any existing rule:
  ```css
  #settings-form { display: flex; flex-direction: column; gap: 8px; max-width: 320px; margin-bottom: 20px; }
  ```

- [ ] **Step 3: Modify `app.js`** — six separate, precisely-located edits. Apply them in order; each shows the exact current text to find and what to replace it with. Do not change anything not shown below.

  **3a. Add the two new imports** — the current top-of-file imports are:
  ```js
  import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
  import { loadTasks, captureTasks, updateTag, updateDone, removeTask, flushQueue, initSync } from "./sync.js";
  import { clearLocalData } from "./storage.js";
  import { getQuadrant, getPriorityTasks, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
  import { tasksToExportJson } from "./export.js";
  ```
  Change to:
  ```js
  import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
  import { loadTasks, captureTasks, updateTag, updateDone, removeTask, updateReminderTime, flushQueue, initSync } from "./sync.js";
  import { clearLocalData } from "./storage.js";
  import { getQuadrant, getPriorityTasks, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
  import { tasksToExportJson } from "./export.js";
  import { getSettings, setMorningReminderTime, setNotificationsEnabled } from "./settings.js";
  import { subscribeToPush, unsubscribeFromPush } from "./push.js";
  ```

  **3b. Add a `navSettings` element reference** — the current line is:
  ```js
  const navHistory = document.getElementById("nav-history");
  ```
  Change to:
  ```js
  const navHistory = document.getElementById("nav-history");
  const navSettings = document.getElementById("nav-settings");
  ```

  **3c. Add a reminder-time input to `taskRowHtml`** — the current function is:
  ```js
  function taskRowHtml(task) {
    return `
      <div class="task-row" data-id="${task.id}">
        <input type="checkbox" class="task-done" ${task.done ? "checked" : ""}>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="task-urgent" data-active="${task.urgent === true}">Urgent</button>
        <button class="task-important" data-active="${task.important === true}">Important</button>
        <button class="task-delete">×</button>
      </div>
    `;
  }
  ```
  Change to:
  ```js
  function taskRowHtml(task) {
    return `
      <div class="task-row" data-id="${task.id}">
        <input type="checkbox" class="task-done" ${task.done ? "checked" : ""}>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <input type="time" class="task-reminder" value="${task.reminder_time ? task.reminder_time.slice(0, 5) : ""}">
        <button class="task-urgent" data-active="${task.urgent === true}">Urgent</button>
        <button class="task-important" data-active="${task.important === true}">Important</button>
        <button class="task-delete">×</button>
      </div>
    `;
  }
  ```
  (`task.reminder_time` comes back from Postgres as a `"HH:MM:SS"` string or `null`; `.slice(0, 5)` matches the `<input type="time">` element's expected `"HH:MM"` format. `historyRowHtml` is untouched — archived tasks don't need a reminder input.)

  **3d. Wire the new input in `wireTaskRows`** — the current function ends with:
  ```js
      row.querySelector(".task-delete").addEventListener("click", () => {
        safely(() => removeTask(id));
      });
    });
  }
  ```
  Change to:
  ```js
      row.querySelector(".task-delete").addEventListener("click", () => {
        safely(() => removeTask(id));
      });
      row.querySelector(".task-reminder").addEventListener("change", (event) => {
        safely(() => updateReminderTime(id, event.target.value || null));
      });
    });
  }
  ```

  **3e. Add a `renderSettingsView` function** — add this new function anywhere after `renderHistoryView` and before `render` (e.g. right between them); do not change `renderHistoryView` or `render` themselves yet (that's step 3f):
  ```js
  async function renderSettingsView() {
    const settings = await getSettings();
    mainView.innerHTML = `
      <h2>Réglages</h2>
      <form id="settings-form">
        <label>
          Heure du rappel matinal
          <input type="time" id="morning-reminder-time" value="${settings.morning_reminder_time ? settings.morning_reminder_time.slice(0, 5) : ""}">
        </label>
        <button type="submit">Enregistrer l'heure</button>
      </form>
      <button id="toggle-notifications">${settings.notifications_enabled ? "Désactiver" : "Activer"} les notifications</button>
    `;

    document.getElementById("settings-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = document.getElementById("morning-reminder-time").value;
      safely(() => setMorningReminderTime(value || null));
    });

    document.getElementById("toggle-notifications").addEventListener("click", () => {
      safely(async () => {
        if (settings.notifications_enabled) {
          await unsubscribeFromPush();
          await setNotificationsEnabled(false);
        } else {
          await subscribeToPush();
          await setNotificationsEnabled(true);
        }
      });
    });
  }
  ```

  **3f. Wire the new view into `render` and add nav handling** — the current `render` function and the nav listeners right after it are:
  ```js
  async function render() {
    try {
      if (currentView === "main") await renderMainView();
      else await renderHistoryView();
      clearAppError();
    } catch (err) {
      showAppError(err);
    }
  }

  navMain.addEventListener("click", () => {
    currentView = "main";
    navMain.dataset.active = "true";
    navHistory.dataset.active = "false";
    render();
  });

  navHistory.addEventListener("click", () => {
    currentView = "history";
    navMain.dataset.active = "false";
    navHistory.dataset.active = "true";
    render();
  });
  ```
  Change to:
  ```js
  async function render() {
    try {
      if (currentView === "main") await renderMainView();
      else if (currentView === "history") await renderHistoryView();
      else await renderSettingsView();
      clearAppError();
    } catch (err) {
      showAppError(err);
    }
  }

  navMain.addEventListener("click", () => {
    currentView = "main";
    navMain.dataset.active = "true";
    navHistory.dataset.active = "false";
    navSettings.dataset.active = "false";
    render();
  });

  navHistory.addEventListener("click", () => {
    currentView = "history";
    navMain.dataset.active = "false";
    navHistory.dataset.active = "true";
    navSettings.dataset.active = "false";
    render();
  });

  navSettings.addEventListener("click", () => {
    currentView = "settings";
    navMain.dataset.active = "false";
    navHistory.dataset.active = "false";
    navSettings.dataset.active = "true";
    render();
  });
  ```

  **3g. Make sign-out also unsubscribe push** — the current handler is:
  ```js
  signOutButton.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (err) {
      showAppError(err);
    }
  });
  ```
  Change to:
  ```js
  signOutButton.addEventListener("click", async () => {
    try {
      await unsubscribeFromPush();
    } catch (err) {
      // Best-effort: never block sign-out on a push-unsubscribe failure (e.g.
      // no subscription existed, or the browser doesn't support Push).
      console.error(err);
    }
    try {
      await signOut();
    } catch (err) {
      showAppError(err);
    }
  });
  ```
  This must call `unsubscribeFromPush()` **before** `signOut()` — `unsubscribeFromPush`'s Supabase delete call needs the still-active session to pass RLS (`user_id = auth.uid()`); after `signOut()`, `auth.uid()` is null and the delete would be blocked.

- [ ] **Step 4: Syntax-check**

  Run: `node --check app.js`
  Expected: no output (success).

- [ ] **Step 5: Confirm nothing else was dropped, in your report**

  Read the full `app.js` back and confirm: every edit from Step 3 was applied exactly once, `renderMainView` and `renderHistoryView` are otherwise byte-identical to before this task, the auth wiring/`escapeHtml`/`wasSignedIn` sentinel/`isSignOut` guard/`initSync` callback are all unchanged, and the file has no leftover reference to a function that doesn't exist (e.g. a typo'd import name).

- [ ] **Step 6: Commit**

  ```bash
  git add index.html style.css app.js
  git commit -m "$(cat <<'EOF'
  Add Réglages screen, per-task reminder time UI, and unsubscribe-on-sign-out

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 7: Extract and unit-test the Edge Function's reminder-timing logic

**Files:**
- Create: `supabase/functions/send-reminders/reminderLogic.js`
- Create: `supabase/functions/send-reminders/reminderLogic.test.js`
- Modify: `supabase/functions/send-reminders/index.ts`

**Interfaces:**
- Produces: `localParts(timezone: string, now: Date): { dateKey: string, minutesOfDay: number }`, `isDueNow(target: string | null, timezone: string, now: Date, windowMinutes?: number): boolean` — both pure functions, moved out of `index.ts` unchanged.

The spec requires unit tests for `isDueNow` ("Tests unitaires pour les fonctions pures : ... `isDueNow` ..."), but it currently lives inline in `supabase/functions/send-reminders/index.ts`, a Deno Edge Function — this repo has no Deno runtime available to run `deno test`, and installing one is a bigger, more invasive change to the user's machine than this plan should make unilaterally. The actual fix is simpler: `localParts` and `isDueNow` use nothing Deno-specific (only `Intl.DateTimeFormat`, standard JS) — they're already portable. Moving them into their own plain `.js` file lets Deno import them via a relative path (Deno requires explicit file extensions in imports, so `.js` here is correct, not a typo) **and** lets this repo's existing `node --test` cover them, exactly like `syncLogic.js`.

- [ ] **Step 1: Write the failing tests** — `supabase/functions/send-reminders/reminderLogic.test.js`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { localParts, isDueNow } from "./reminderLogic.js";

  test("localParts extracts local date and minutes-of-day for a given timezone", () => {
    // 2026-09-12T07:05:00Z is 09:05 in Europe/Paris (UTC+2 in September, DST).
    const now = new Date("2026-09-12T07:05:00Z");
    const { dateKey, minutesOfDay } = localParts("Europe/Paris", now);
    assert.equal(dateKey, "2026-09-12");
    assert.equal(minutesOfDay, 9 * 60 + 5);
  });

  test("localParts can roll the local date forward relative to UTC", () => {
    // 2026-09-12T23:30:00Z is already 2026-09-13T11:30 in Pacific/Auckland
    // (UTC+12 in September — NZ daylight saving doesn't start until late
    // September, so this is NZST, not NZDT).
    const now = new Date("2026-09-12T23:30:00Z");
    const { dateKey, minutesOfDay } = localParts("Pacific/Auckland", now);
    assert.equal(dateKey, "2026-09-13");
    assert.equal(minutesOfDay, 11 * 60 + 30);
  });

  test("isDueNow returns false for a null target (no reminder set)", () => {
    const now = new Date("2026-09-12T07:05:00Z");
    assert.equal(isDueNow(null, "Europe/Paris", now), false);
  });

  test("isDueNow returns true exactly at the target minute", () => {
    const now = new Date("2026-09-12T07:00:00Z"); // 09:00 Europe/Paris
    assert.equal(isDueNow("09:00", "Europe/Paris", now), true);
  });

  test("isDueNow returns true within the default 5-minute window after the target", () => {
    const now = new Date("2026-09-12T07:04:00Z"); // 09:04 Europe/Paris
    assert.equal(isDueNow("09:00", "Europe/Paris", now), true);
  });

  test("isDueNow returns false once the default window has passed", () => {
    const now = new Date("2026-09-12T07:05:00Z"); // 09:05 Europe/Paris, window is [0,5)
    assert.equal(isDueNow("09:00", "Europe/Paris", now), false);
  });

  test("isDueNow returns false before the target time (never fires early)", () => {
    const now = new Date("2026-09-12T06:59:00Z"); // 08:59 Europe/Paris
    assert.equal(isDueNow("09:00", "Europe/Paris", now), false);
  });

  test("isDueNow respects a custom windowMinutes", () => {
    const now = new Date("2026-09-12T07:08:00Z"); // 09:08 Europe/Paris
    assert.equal(isDueNow("09:00", "Europe/Paris", now, 10), true);
    assert.equal(isDueNow("09:00", "Europe/Paris", now, 5), false);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test supabase/functions/send-reminders/reminderLogic.test.js`
  Expected: FAIL — `Cannot find module './reminderLogic.js'`.

- [ ] **Step 3: Write `reminderLogic.js`** — this is the exact `localParts`/`isDueNow` code already in `index.ts` today, moved verbatim (no logic changes) and exported:

  ```js
  // Extrait heure/minute/date locales via Intl.formatToParts — contrat garanti
  // par la spec ECMAScript, contrairement à un aller-retour toLocaleString/Date.
  export function localParts(timezone, now) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return {
      dateKey: `${get("year")}-${get("month")}-${get("day")}`,
      minutesOfDay: Number(get("hour")) * 60 + Number(get("minute")),
    };
  }

  const WINDOW_MINUTES = 5;

  export function isDueNow(target, timezone, now, windowMinutes = WINDOW_MINUTES) {
    if (!target) return false;
    const [th, tm] = target.split(":").map(Number);
    const { minutesOfDay } = localParts(timezone, now);
    const diff = minutesOfDay - (th * 60 + tm);
    return diff >= 0 && diff < windowMinutes;
  }
  ```

  Note: this file has no TypeScript type annotations and no Deno-specific syntax (no `Deno.*`, no `npm:`/`https://` imports) — it is plain, portable ECMAScript, which is exactly why both Deno (via relative import) and Node (via `node --test`) can run it unmodified.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test supabase/functions/send-reminders/reminderLogic.test.js`
  Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 5: Update `index.ts` to import from the new file instead of defining these functions inline**

  Remove the existing `localParts` function definition, the `WINDOW_MINUTES` constant, and the existing `isDueNow` function definition from `index.ts` (they are being replaced by the import below — do not leave duplicate definitions in the file). In their place, and everywhere else in the file left exactly as-is, add this import near the top of the file, alongside the existing `import` statements:

  ```ts
  import { localParts, isDueNow } from "./reminderLogic.js";
  ```

  Every call site in `index.ts` that already calls `localParts(...)` or `isDueNow(...)` needs no changes — same names, same signatures, same behavior, just imported instead of defined locally.

- [ ] **Step 6: Verify by reading, in your report**

  Read the full updated `index.ts` back and confirm in your report: (a) `localParts`, `WINDOW_MINUTES`, and `isDueNow` no longer have local definitions in this file, (b) the new import line is present, (c) every call site that used these functions before (the morning-reminder loop and the per-task-reminder loop) is textually unchanged and still compiles as valid TypeScript, (d) nothing else in the file changed. Also run `node --check supabase/functions/send-reminders/reminderLogic.js` and confirm no output (success) — `index.ts` itself cannot be checked with `node --check` since it's TypeScript for a Deno runtime, not something this repo's Node tooling executes directly; the reasoning trace in this step is that file's verification instead.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/functions/send-reminders/reminderLogic.js supabase/functions/send-reminders/reminderLogic.test.js supabase/functions/send-reminders/index.ts
  git commit -m "$(cat <<'EOF'
  Extract isDueNow/localParts into a portable module and unit-test them

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 8: Deploy the backend (controller/human-driven — not a subagent task)

**Files:** none in this repo (deployment configuration lives in the Supabase project, not in git — `supabase/functions/send-reminders/index.ts` was already written and code-reviewed before Plan 1 started, and Task 7 just gave its pure logic real unit tests; no further code changes needed here).

**Interfaces:** none.

This task cannot be delegated to a coding subagent: it requires live interaction with the Supabase dashboard and handling secrets that must never be committed to the repo. The controller (or the user, guided step by step) does this directly.

- [ ] **Step 1: Generate a `CRON_SECRET`**

  Run: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
  Save the output — it's needed in Steps 2 and 4.

- [ ] **Step 2: Deploy the Edge Function via the Supabase Dashboard**

  Dashboard → Edge Functions → Create a new function named `send-reminders` → paste the full contents of `supabase/functions/send-reminders/index.ts` → Deploy.

- [ ] **Step 3: Set Edge Function secrets**

  Dashboard → Edge Functions → `send-reminders` → Secrets (or Project Settings → Edge Functions, depending on dashboard version). Set:
  - `VAPID_PUBLIC_KEY` = `BDZI4YXGXEpAmM_f6Q3nJOyPBiWSkENx0UIcHtfnMDK_XaG3dBH3ZsR2F_e1-ekWWvxREcMfKUKrAnngoggUVrI` (same value hardcoded in `push.js` — must match exactly, or the client and server will disagree about which key pair is in use)
  - `VAPID_PRIVATE_KEY` = the private key generated alongside the public key above (provided directly by the controller when this task executes — paired with the public key already in `push.js`; never commit this value anywhere in the repo)
  - `CRON_SECRET` = the value generated in Step 1

- [ ] **Step 4: Enable `pg_cron`/`pg_net` and schedule the reminder check**

  Dashboard → Database → Extensions → enable `pg_cron` and `pg_net` if not already enabled. Then, in the SQL Editor, run (substituting your actual project ref, anon key, and the `CRON_SECRET` from Step 1):

  ```sql
  select cron.schedule(
    'send-reminders-every-minute',
    '* * * * *',
    $$
    select net.http_post(
      url := 'https://<project-ref>.functions.supabase.co/send-reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <anon-key>',
        'Content-Type', 'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      )
    );
    $$
  );
  ```

  This is the exact template already documented in the spec (`docs/superpowers/specs/2026-09-04-mon-app-taches-design.md`, "Notifications push" section) — the values are per-deployment secrets, deliberately not committed to any file, so they're filled in live when this step is actually run rather than hardcoded here.

- [ ] **Step 5: Set up the cron-job.org keep-alive ping**

  Per the spec's "Maintien en activité du projet Supabase" section: create a free account at cron-job.org, add a daily job hitting a lightweight Supabase REST endpoint (e.g. `https://<project-ref>.supabase.co/rest/v1/user_settings?select=user_id&limit=1` with the `apikey` header set to the anon key) to keep the free-tier project from auto-pausing after 7 days of inactivity.

- [ ] **Step 6: Verify the Edge Function responds**

  Run (substituting your project ref, anon key, and `CRON_SECRET`):
  ```bash
  curl -i -X POST "https://<project-ref>.functions.supabase.co/send-reminders" \
    -H "Authorization: Bearer <anon-key>" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: <CRON_SECRET>"
  ```
  Expected: `HTTP/2 200` with body `ok`. A `401 unauthorized` means the `CRON_SECRET` sent doesn't match what was set in Step 3 — re-check both.

No commit — this task configures the Supabase project, not the repo.

---

### Task 9: Real-device end-to-end verification (human-driven — not a subagent task)

**Files:** none.

**Interfaces:** none — this validates the deployed result of every prior task, including the backend deployed in Task 8.

This task cannot be delegated to a subagent: it requires a real browser, a real iPhone/Mac, and waiting for an actual push notification to arrive.

- [ ] **Step 1: Push and wait for redeploy**

  Push the merged `main` branch to `origin` (or merge this plan's branch first, per the usual finishing-a-development-branch flow) and wait ~1 minute for GitHub Pages to rebuild.

- [ ] **Step 2: Enable notifications**

  Open the deployed app, sign in, go to Réglages, click "Activer les notifications". The browser should show its native permission prompt — accept it. Expected: the button now reads "Désactiver les notifications", and a new row appears in Supabase's `push_subscriptions` table (check the Table Editor) with your device's endpoint.

- [ ] **Step 3: Test a per-task reminder**

  On the main screen, capture a task, then set its reminder time (the new time input on the task row) to a time 6-7 minutes from now (giving the cron job, which runs every minute, and the 5-minute due-window room to fire within the test). Wait. Expected: within a few minutes, a real push notification appears (even if the app/tab is closed), showing the task's text. Clicking it should focus or open the app.

- [ ] **Step 4: Test the morning reminder**

  In Réglages, set "Heure du rappel matinal" to a time a few minutes from now. Wait. Expected: a push notification titled "Tes priorités du jour" arrives around that time (within the 5-minute window).

- [ ] **Step 5: Test sign-out unsubscribe**

  Sign out. Expected: the row in `push_subscriptions` for this device is deleted (check the Table Editor). Sign back in — Réglages should show "Activer les notifications" again (not "Désactiver"), since the subscription is gone.

- [ ] **Step 6: Install on iPhone if not already installed**

  Web Push on iOS requires the app to be installed via Safari's "Sur l'écran d'accueil" (Plan 2's Task 8 covered this) — a push sent to a plain Safari tab will not work on iOS. Confirm notifications arrive on the installed iPhone app specifically, not just on Mac.

- [ ] **Step 7: Report back**

  Note which steps passed and which didn't. Any failure here means a real, unresolved bug in Tasks 1-8 or a misconfiguration in Task 8's deployment steps — surfacing it now, against the real backend, is exactly this task's job.

No commit — this task validates, it doesn't change code (unless a real bug is found, in which case it goes back through the fix loop against whichever earlier task it belongs to).

---

## Self-Review Notes

- **Spec coverage:** This plan implements the spec's full "Notifications push" section (VAPID keys, client subscribe/unsubscribe, service worker `push` handler, server-side `pg_cron` + Edge Function trigger — the Edge Function itself was already written and code-reviewed pre-Plan-1, this plan deploys it), the "Maintien en activité" section (cron-job.org keep-alive, Task 8 Step 5), the "Tests" section's `isDueNow` requirement (Task 7 — previously an untested gap, now closed without needing a Deno runtime), and the Réglages bullet under "Interface" (heure du rappel matinal, activation des notifications, heure de rappel par tâche depuis la carte de la tâche, déconnexion désabonne le push). Deliberately scoped out (see "Scope of this plan" above, not a gap): relocating the already-shipped Export/Déconnexion buttons into the new Réglages screen. Also not a gap: the spec's "résolution de conflits last-write-wins" testing bullet has no corresponding pure function to test — conflict resolution is an emergent property of plain sequential UPDATEs plus the server-owned `updated_at` trigger, not a decision function the client calls (confirmed during Plan 2's final review); there is nothing to extract or test here.
- **Placeholder scan:** no TBD/TODO in any code block. Task 8's SQL template uses `<project-ref>`/`<anon-key>`/`<CRON_SECRET>` placeholders, but this is the same pattern the spec itself already uses for this exact SQL (per-deployment secrets that must never be committed to a file, not a laziness placeholder) — every other task's code blocks contain complete, real, runnable content, including the real VAPID public key value (Task 4) and Task 7's test values (independently verified against a real `Intl.DateTimeFormat` run before being written into this plan, catching and fixing one wrong expected value in the Auckland test case).
- **Type consistency:** `syncLogic.js`'s new `"setReminderTime"` case (Task 1) uses `{ id, reminderTime }`, matching exactly what Task 2's `updateReminderTime` constructs and what Task 6's `wireTaskRows` addition passes. `settings.js`'s three exports (Task 3) are consumed with matching names/arities in Task 6's `renderSettingsView`. `push.js`'s two exports (Task 4) are consumed with matching names/arities in Task 6's `renderSettingsView` and sign-out handler. Column names used in `settings.js` (`morning_reminder_time`, `notifications_enabled`, `timezone`) and `push.js` (`user_id`, `endpoint`, `p256dh`, `auth_key`) match `supabase/migrations/0001_init.sql` exactly — verified by reading that file directly while writing this plan.
