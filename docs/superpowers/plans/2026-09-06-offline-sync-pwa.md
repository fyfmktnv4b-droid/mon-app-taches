# Offline Sync & PWA Installability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-deployed core app (Plan 1) work offline — edits queue locally and sync when the network returns — and installable as a real PWA on Mac and iPhone with a cache-first app shell.

**Architecture:** A pure-logic layer (`syncLogic.js`) decides what an offline edit does to the local task list; a thin IndexedDB wrapper (`storage.js`) persists a task cache and a mutation queue; `sync.js` orchestrates the two — try the network first, fall back to queue+cache on failure, replay the queue on reconnect. `app.js` is rewired to call `sync.js` instead of `tasks.js` directly. Separately, a generated app manifest + a cache-first service worker make the site installable and load offline after the first visit.

**Tech Stack:** Same as Plan 1 (vanilla JS, ES modules, no build step) plus the browser's native IndexedDB and Service Worker / Cache Storage APIs — no new libraries.

**Spec:** `docs/superpowers/specs/2026-09-04-mon-app-taches-design.md` (sections "Synchronisation & mode hors-ligne" and "PWA & installation")

## Scope of this plan vs. the rest of the spec

This is **Plan 2 of 3**. Plan 1 (done, deployed) built auth, CRUD, the Eisenhower UI, and export. Plan 3 (later) builds Web Push notifications, the full Réglages screen, and the Supabase keep-alive ping. This plan sits between them: it doesn't touch notifications or Réglages at all, and it doesn't touch the Supabase schema.

## Hard limitation: nothing here is testable with `node --test` or `curl`

Plan 1's tasks could fall back to `curl` against Supabase's REST API when no browser was available. **IndexedDB and Service Workers have no such fallback — they only exist inside a real browser.** Every task below draws a hard line: the *pure decision logic* (what should happen to a task list given a mutation) is extracted into `syncLogic.js` and gets real, automated tests. The *browser-API plumbing* around it (`storage.js`, `sync.js`'s orchestration, `service-worker.js`) can only be verified by `node --check` (syntax), by reading the code very carefully against the exact spec given in this plan, and — ultimately — by a human with a real browser. Task 8 is that human verification pass; it cannot be delegated to a subagent.

## Global Constraints

- Frontend is vanilla HTML/CSS/JS — no bundler, no build step, no `npm install` for anything the browser loads. (The one-off PNG-icon generator in Task 4 is a Node *build-time* utility that never ships to the browser — it doesn't violate this.)
- The Supabase JS client is loaded only via the jsdelivr ESM CDN — unchanged from Plan 1.
- Every Supabase table has RLS with `user_id = auth.uid()`; nothing in this plan touches the schema or bypasses RLS.
- **Any failed write is treated as offline**, unconditionally — no distinguishing "network error" from "server rejected it." This was decided during design specifically to keep the offline path simple: queue it, retry later.
- **Conflict resolution is last-write-wins** based on the server's `updated_at` (trigger-owned). No merge UI, ever — whichever write reaches Supabase last simply overwrites the row.
- **No real-time sync.** Sync happens only on: initial sign-in, the browser's `online` event, and the `focus` event. No WebSocket, no polling interval.
- The service worker caches **same-origin GET requests only**. Supabase requests (auth, REST) must never be served from cache — they always go straight to the network.
- The service worker's cache name embeds a version string (`CACHE_VERSION`) that **must be bumped by hand** on any deploy that changes a cached file — this is what makes the browser notice a new service-worker version and refresh its cache. This is a manual step, not automated (no build tool to hash files with); it must be documented visibly (a comment right above the constant, and a line in the README).

---

### Task 1: Pure sync logic (`syncLogic.js`), fully unit tested

**Files:**
- Create: `syncLogic.js`
- Test: `syncLogic.test.js`

**Interfaces:**
- Produces (used by Task 3):
  - `applyMutation(tasks: Task[], mutation: Mutation): Task[]` — returns a new array reflecting one optimistic local edit.
  - `resolveMutationIds(mutation: Mutation, idMap: Map<string, string>): Mutation` — rewrites a mutation's `id` if it refers to a temporary client-generated id that has since been replaced by a real server id.
  - `buildOptimisticTasks(rawText: string, userId: string, now?: string): Task[]` — turns raw captured text into full local task objects with a generated id, for immediate display before the server has seen them.
- `Mutation` shapes used throughout this plan:
  - `{ type: "create", rawText: string, tasks: Task[] }`
  - `{ type: "setTag", id: string, tagName: "urgent" | "important", value: boolean }`
  - `{ type: "setDone", id: string, done: boolean, completedAt: string | null }`
  - `{ type: "delete", id: string }`

- [ ] **Step 1: Write the failing tests** — `syncLogic.test.js`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { applyMutation, resolveMutationIds, buildOptimisticTasks } from "./syncLogic.js";

  function makeTask(overrides) {
    return {
      id: "1", text: "x", urgent: null, important: null,
      done: false, completed_at: null, created_at: "2026-09-01T00:00:00Z",
      ...overrides,
    };
  }

  test("applyMutation create appends the optimistic tasks", () => {
    const tasks = [makeTask({ id: "a" })];
    const newTasks = [makeTask({ id: "b" }), makeTask({ id: "c" })];
    const result = applyMutation(tasks, { type: "create", tasks: newTasks });
    assert.deepEqual(result.map((t) => t.id), ["a", "b", "c"]);
  });

  test("applyMutation setTag updates only the matching task", () => {
    const tasks = [makeTask({ id: "a", urgent: null }), makeTask({ id: "b", urgent: null })];
    const result = applyMutation(tasks, { type: "setTag", id: "a", tagName: "urgent", value: true });
    assert.equal(result.find((t) => t.id === "a").urgent, true);
    assert.equal(result.find((t) => t.id === "b").urgent, null);
  });

  test("applyMutation setDone sets done and completed_at together", () => {
    const tasks = [makeTask({ id: "a", done: false, completed_at: null })];
    const result = applyMutation(tasks, { type: "setDone", id: "a", done: true, completedAt: "2026-09-06T10:00:00Z" });
    assert.equal(result[0].done, true);
    assert.equal(result[0].completed_at, "2026-09-06T10:00:00Z");
  });

  test("applyMutation delete removes the matching task", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const result = applyMutation(tasks, { type: "delete", id: "a" });
    assert.deepEqual(result.map((t) => t.id), ["b"]);
  });

  test("applyMutation returns the list unchanged for an unknown mutation type", () => {
    const tasks = [makeTask({ id: "a" })];
    const result = applyMutation(tasks, { type: "unknown" });
    assert.deepEqual(result, tasks);
  });

  test("resolveMutationIds rewrites a task id that was remapped after a create synced", () => {
    const idMap = new Map([["temp-1", "real-1"]]);
    const mutation = { type: "setTag", id: "temp-1", tagName: "urgent", value: true };
    const resolved = resolveMutationIds(mutation, idMap);
    assert.equal(resolved.id, "real-1");
  });

  test("resolveMutationIds leaves the mutation unchanged when its id isn't in the map", () => {
    const idMap = new Map();
    const mutation = { type: "setTag", id: "real-2", tagName: "urgent", value: true };
    const resolved = resolveMutationIds(mutation, idMap);
    assert.equal(resolved.id, "real-2");
  });

  test("resolveMutationIds leaves create mutations unchanged (no id field to resolve)", () => {
    const idMap = new Map([["temp-1", "real-1"]]);
    const mutation = { type: "create", rawText: "x", tasks: [] };
    const resolved = resolveMutationIds(mutation, idMap);
    assert.deepEqual(resolved, mutation);
  });

  test("buildOptimisticTasks splits lines into full task-shaped objects with a generated id", () => {
    const tasks = buildOptimisticTasks("Tâche A\nTâche B", "user-1", "2026-09-06T08:00:00Z");
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, "Tâche A");
    assert.equal(tasks[0].user_id, "user-1");
    assert.equal(tasks[0].urgent, null);
    assert.equal(tasks[0].important, null);
    assert.equal(tasks[0].done, false);
    assert.equal(tasks[0].created_at, "2026-09-06T08:00:00Z");
    assert.ok(tasks[0].id && tasks[0].id !== tasks[1].id, "each task gets a distinct id");
  });

  test("buildOptimisticTasks drops blank lines", () => {
    const tasks = buildOptimisticTasks("Tâche A\n\n  \nTâche B", "user-1");
    assert.equal(tasks.length, 2);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test syncLogic.test.js`
  Expected: FAIL — `Cannot find module './syncLogic.js'`.

- [ ] **Step 3: Write the implementation** — `syncLogic.js`:

  ```js
  export function applyMutation(tasks, mutation) {
    switch (mutation.type) {
      case "create":
        return [...tasks, ...mutation.tasks];
      case "setTag":
        return tasks.map((t) =>
          t.id === mutation.id ? { ...t, [mutation.tagName]: mutation.value } : t
        );
      case "setDone":
        return tasks.map((t) =>
          t.id === mutation.id ? { ...t, done: mutation.done, completed_at: mutation.completedAt } : t
        );
      case "delete":
        return tasks.filter((t) => t.id !== mutation.id);
      default:
        return tasks;
    }
  }

  export function resolveMutationIds(mutation, idMap) {
    if (mutation.type === "create" || !idMap.has(mutation.id)) return mutation;
    return { ...mutation, id: idMap.get(mutation.id) };
  }

  export function buildOptimisticTasks(rawText, userId, now = new Date().toISOString()) {
    const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.map((text) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      text,
      urgent: null,
      important: null,
      done: false,
      completed_at: null,
      created_at: now,
    }));
  }
  ```

  Note: `crypto.randomUUID()` is a Web Crypto API global, available both in browsers and as a Node global (Node ≥19) — this is why it's used instead of `require("node:crypto")`, which wouldn't work when this same file is loaded by a browser.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test syncLogic.test.js`
  Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 5: Commit**

  ```bash
  git add syncLogic.js syncLogic.test.js
  git commit -m "$(cat <<'EOF'
  Add pure offline-sync decision logic with unit tests

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 2: IndexedDB wrapper (`storage.js`)

**Files:**
- Create: `storage.js`

**Interfaces:**
- Produces (used by Task 3):
  - `getCachedTasks(): Promise<Task[]>`
  - `setCachedTasks(tasks: Task[]): Promise<void>` — replaces the whole cache.
  - `getPendingMutations(): Promise<(Mutation & { queueId: number })[]>`
  - `enqueueMutation(mutation: Mutation): Promise<number>` — returns the assigned `queueId`.
  - `removeMutation(queueId: number): Promise<void>`

**No automated tests for this file** — IndexedDB doesn't exist in Node, and this repo has no npm dependency (like `fake-indexeddb`) to simulate it. Every function below opens its own transaction and completes all its `objectStore` calls **before** the first `await`, deliberately avoiding a documented IndexedDB pitfall: a transaction can auto-close if you `await` in the middle of it and then try to issue another request on it. This is the reason the code below looks slightly more repetitive than a naive version would — don't "clean it up" by adding awaits between store operations within the same transaction.

- [ ] **Step 1: Write `storage.js`**

  ```js
  const DB_NAME = "mon-app-taches";
  const DB_VERSION = 1;
  const TASKS_STORE = "tasks_cache";
  const QUEUE_STORE = "pending_mutations";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TASKS_STORE)) {
          db.createObjectStore(TASKS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  export async function getCachedTasks() {
    const db = await openDb();
    const tx = db.transaction(TASKS_STORE, "readonly");
    return requestToPromise(tx.objectStore(TASKS_STORE).getAll());
  }

  export async function setCachedTasks(tasks) {
    const db = await openDb();
    const tx = db.transaction(TASKS_STORE, "readwrite");
    const store = tx.objectStore(TASKS_STORE);
    store.clear();
    for (const task of tasks) {
      store.put(task);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  export async function getPendingMutations() {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, "readonly");
    return requestToPromise(tx.objectStore(QUEUE_STORE).getAll());
  }

  export async function enqueueMutation(mutation) {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    return requestToPromise(tx.objectStore(QUEUE_STORE).add(mutation));
  }

  export async function removeMutation(queueId) {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(queueId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  ```

- [ ] **Step 2: Syntax-check**

  Run: `node --check storage.js`
  Expected: no output (success). This only confirms the JS parses — it does NOT confirm the IndexedDB logic is correct, since `indexedDB` doesn't exist as a global in plain Node and this file will throw a `ReferenceError` if actually executed there. That's expected and fine.

- [ ] **Step 3: Trace through the logic by hand, in your report**

  Since this can't be run, write out in your report a step-by-step trace of what happens, in order, for: (a) `setCachedTasks([task1, task2])` called on a fresh empty database, and (b) `enqueueMutation({...})` followed immediately by `getPendingMutations()`. Name which IndexedDB events fire in which order and confirm the returned values match what the caller would expect.

- [ ] **Step 4: Commit**

  ```bash
  git add storage.js
  git commit -m "$(cat <<'EOF'
  Add IndexedDB wrapper for task cache and offline mutation queue

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 3: Sync orchestration (`sync.js`) + one `tasks.js` enhancement

**Files:**
- Create: `sync.js`
- Modify: `tasks.js`

**Interfaces:**
- Consumes: `applyMutation`, `resolveMutationIds`, `buildOptimisticTasks` (Task 1); `getCachedTasks`, `setCachedTasks`, `getPendingMutations`, `enqueueMutation`, `removeMutation` (Task 2); `supabase` (from `supabaseClient.js`); `createTasksFromLines`, `listTasks`, `setTag`, `setDone`, `deleteTask` (from `tasks.js`, one of them modified below).
- Produces (used by Task 7):
  - `loadTasks(): Promise<Task[]>` — network-first, falls back to cache.
  - `captureTasks(rawText: string): Promise<Task[]>`
  - `updateTag(id: string, tagName: "urgent" | "important", value: boolean): Promise<void>`
  - `updateDone(id: string, done: boolean): Promise<void>`
  - `removeTask(id: string): Promise<void>`
  - `flushQueue(): Promise<void>` — replays the pending mutation queue against Supabase; stops at the first failure to preserve order for the next attempt.
  - `initSync(afterSync: () => void): void` — wires `online` and `focus` listeners that call `flushQueue()` then `afterSync()`.

- [ ] **Step 1: Modify `tasks.js`** — change only the `setDone` function (everything else in the file stays exactly as-is). This lets a *replayed* mutation persist the timestamp from when the user actually acted, not from whenever the network happened to come back — without this, an offline "mark done" would silently drift its `completed_at` to the reconnect time instead of the actual completion time.

  Replace:
  ```js
  export async function setDone(id, done) {
    const { error } = await supabase
      .from("tasks")
      .update({ done, completed_at: done ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) throw error;
  }
  ```
  with:
  ```js
  export async function setDone(id, done, completedAt = done ? new Date().toISOString() : null) {
    const { error } = await supabase
      .from("tasks")
      .update({ done, completed_at: completedAt })
      .eq("id", id);
    if (error) throw error;
  }
  ```
  This is backward compatible: every existing call site that only passes `(id, done)` behaves exactly as before, since the third parameter defaults to the same computation the old hardcoded version did.

- [ ] **Step 2: Write `sync.js`**

  ```js
  import { supabase } from "./supabaseClient.js";
  import { createTasksFromLines, listTasks, setTag, setDone, deleteTask } from "./tasks.js";
  import { getCachedTasks, setCachedTasks, getPendingMutations, enqueueMutation, removeMutation } from "./storage.js";
  import { applyMutation, resolveMutationIds, buildOptimisticTasks } from "./syncLogic.js";

  export async function loadTasks() {
    try {
      const tasks = await listTasks();
      try {
        await setCachedTasks(tasks);
      } catch (_cacheErr) {
        // Caching is best-effort — the freshly fetched data is still valid to show.
      }
      return tasks;
    } catch (_networkErr) {
      return getCachedTasks();
    }
  }

  async function getCurrentUserId() {
    // getSession() reads the persisted session locally and works offline;
    // getUser() re-validates against the server and would fail offline —
    // wrong choice here, since this path only runs when we're already offline.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) throw new Error("Session expirée, reconnecte-toi.");
    return session.user.id;
  }

  export async function captureTasks(rawText) {
    try {
      return await createTasksFromLines(rawText);
    } catch (_err) {
      const userId = await getCurrentUserId();
      const optimisticTasks = buildOptimisticTasks(rawText, userId);
      if (optimisticTasks.length === 0) return [];
      await enqueueMutation({ type: "create", rawText, tasks: optimisticTasks });
      const cached = await getCachedTasks();
      await setCachedTasks(applyMutation(cached, { type: "create", tasks: optimisticTasks }));
      return optimisticTasks;
    }
  }

  export async function updateTag(id, tagName, value) {
    try {
      await setTag(id, tagName, value);
    } catch (_err) {
      const mutation = { type: "setTag", id, tagName, value };
      await enqueueMutation(mutation);
      const cached = await getCachedTasks();
      await setCachedTasks(applyMutation(cached, mutation));
    }
  }

  export async function updateDone(id, done) {
    const completedAt = done ? new Date().toISOString() : null;
    try {
      await setDone(id, done, completedAt);
    } catch (_err) {
      const mutation = { type: "setDone", id, done, completedAt };
      await enqueueMutation(mutation);
      const cached = await getCachedTasks();
      await setCachedTasks(applyMutation(cached, mutation));
    }
  }

  export async function removeTask(id) {
    try {
      await deleteTask(id);
    } catch (_err) {
      const mutation = { type: "delete", id };
      await enqueueMutation(mutation);
      const cached = await getCachedTasks();
      await setCachedTasks(applyMutation(cached, mutation));
    }
  }

  export async function flushQueue() {
    const idMap = new Map();
    const queue = await getPendingMutations();
    for (const mutation of queue) {
      const resolved = resolveMutationIds(mutation, idMap);
      try {
        if (resolved.type === "create") {
          const created = await createTasksFromLines(resolved.rawText);
          resolved.tasks.forEach((optimisticTask, i) => {
            if (created[i]) idMap.set(optimisticTask.id, created[i].id);
          });
        } else if (resolved.type === "setTag") {
          await setTag(resolved.id, resolved.tagName, resolved.value);
        } else if (resolved.type === "setDone") {
          await setDone(resolved.id, resolved.done, resolved.completedAt);
        } else if (resolved.type === "delete") {
          await deleteTask(resolved.id);
        }
        await removeMutation(mutation.queueId);
      } catch (_err) {
        break; // Still offline (or a real error) — stop, preserve remaining order for next attempt.
      }
    }
  }

  export function initSync(afterSync) {
    const trigger = () => {
      flushQueue().catch(() => {}).then(afterSync);
    };
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
  }
  ```

- [ ] **Step 3: Syntax-check**

  Run: `node --check sync.js` and `node --check tasks.js`
  Expected: no output from either (success).

- [ ] **Step 4: Trace through two scenarios by hand, in your report**

  1. **Offline capture then reconnect:** the network is down, the user types two lines and submits. Walk through `captureTasks` → what gets stored in the queue and the cache, what `render()` would show immediately. Then walk through what happens when `flushQueue()` runs after reconnecting: what gets sent to Supabase, what `idMap` ends up containing.
  2. **Tag change on a task that hasn't synced yet:** still offline from scenario 1, the user taps "Urgent" on one of the two just-captured tasks (which only exists as a temp id so far). Walk through `updateTag` (what mutation gets queued, using which id) and then `flushQueue` (how `resolveMutationIds` uses the `idMap` built while replaying the earlier "create" mutation to rewrite this "setTag" mutation's id to the real one before calling `setTag`).

  Write both traces out explicitly, step by step, in your report — this is the verification for logic that can't be executed here.

- [ ] **Step 5: Commit**

  ```bash
  git add sync.js tasks.js
  git commit -m "$(cat <<'EOF'
  Add offline-aware sync orchestration on top of storage.js and syncLogic.js

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 4: Generate PWA icons

**Files:**
- Create: `scripts/generate-icons.js`
- Create: `icons/icon-192.png`, `icons/icon-512.png` (generated binary output, committed)

**Interfaces:** none — this is a one-off Node build utility, never loaded by the browser or imported by any other file in this plan.

- [ ] **Step 1: Write `scripts/generate-icons.js`**

  ```js
  const fs = require("fs");
  const path = require("path");
  const zlib = require("zlib");

  let crcTable;
  function crc32(buf) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  function makeIcon(size, outPath) {
    const bg = [26, 26, 26];     // #1a1a1a — matches the app's header/theme color
    const accent = [34, 197, 94]; // #22c55e — matches the priority-quadrant highlight
    const raw = Buffer.alloc(size * (1 + size * 3));
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.32;

    for (let y = 0; y < size; y++) {
      const rowStart = y * (1 + size * 3);
      raw[rowStart] = 0; // filter type: None
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const inCircle = dx * dx + dy * dy <= r * r;
        const color = inCircle ? accent : bg;
        const px = rowStart + 1 + x * 3;
        raw[px] = color[0];
        raw[px + 1] = color[1];
        raw[px + 2] = color[2];
      }
    }

    const compressed = zlib.deflateSync(raw);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type: truecolor RGB
    ihdr[10] = 0; // compression method
    ihdr[11] = 0; // filter method
    ihdr[12] = 0; // interlace method

    const png = Buffer.concat([
      signature,
      chunk("IHDR", ihdr),
      chunk("IDAT", compressed),
      chunk("IEND", Buffer.alloc(0)),
    ]);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, png);
    console.log(`Wrote ${outPath} (${png.length} bytes)`);
  }

  makeIcon(192, "icons/icon-192.png");
  makeIcon(512, "icons/icon-512.png");
  ```

- [ ] **Step 2: Run it**

  Run: `node scripts/generate-icons.js`
  Expected output:
  ```
  Wrote icons/icon-192.png (... bytes)
  Wrote icons/icon-512.png (... bytes)
  ```

- [ ] **Step 3: Verify the PNGs are valid, without a browser**

  Run: `file icons/icon-192.png icons/icon-512.png`
  Expected:
  ```
  icons/icon-192.png: PNG image data, 192 x 192, 8-bit/color RGB, non-interlaced
  icons/icon-512.png: PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced
  ```
  The `file` command reads the actual PNG header bytes — if this reports the correct format and exact dimensions, the files are structurally valid PNGs, independent of any browser.

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/generate-icons.js icons/icon-192.png icons/icon-512.png
  git commit -m "$(cat <<'EOF'
  Generate PWA app icons (dark background, green accent circle)

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 5: `manifest.json` and HTML wiring

**Files:**
- Create: `manifest.json`
- Modify: `index.html`

**Interfaces:** none — static config consumed directly by the browser.

- [ ] **Step 1: Write `manifest.json`**

  ```json
  {
    "name": "Mes Tâches",
    "short_name": "Tâches",
    "start_url": "./index.html",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f7f7f8",
    "theme_color": "#1a1a1a",
    "icons": [
      { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  }
  ```

- [ ] **Step 2: Modify `index.html`** — add these lines inside `<head>`, right after the existing `<link rel="stylesheet" href="style.css">` line (everything else in `<head>` and the rest of the file stays exactly as-is):

  ```html
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
    <meta name="theme-color" content="#1a1a1a">
    <meta name="apple-mobile-web-app-capable" content="yes">
  ```

- [ ] **Step 3: Verify**

  Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('valid JSON')"`
  Expected: `valid JSON`

  Then read the updated `index.html` back and confirm the four new lines are present inside `<head>` and every pre-existing line (the `<section id="auth">` block, the `<section id="app">` block, the closing `<script>` tag) is untouched.

- [ ] **Step 4: Commit**

  ```bash
  git add manifest.json index.html
  git commit -m "$(cat <<'EOF'
  Add web app manifest and iOS/theme meta tags

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 6: Cache-first service worker (`service-worker.js`)

**Files:**
- Create: `service-worker.js`

**Interfaces:** none — runs in its own worker context, has no imports from and no exports to any other file in this repo.

- [ ] **Step 1: Write `service-worker.js`**

  ```js
  // Bump CACHE_VERSION (v1 -> v2 -> ...) on every deploy that changes any
  // file listed in ASSETS below. This is what makes the browser notice a
  // new service worker and refresh its cache — there's no build tool here
  // to hash files automatically, so this is a manual, required step.
  const CACHE_VERSION = "v1";
  const CACHE_NAME = `mon-app-taches-${CACHE_VERSION}`;

  const ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./supabaseClient.js",
    "./tasks.js",
    "./quadrants.js",
    "./export.js",
    "./sync.js",
    "./storage.js",
    "./syncLogic.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
    );
    self.clients.claim();
  });

  self.addEventListener("fetch", (event) => {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const sameOrigin = new URL(event.request.url).origin === self.location.origin;
          if (event.request.method === "GET" && response.ok && sameOrigin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  });
  ```

- [ ] **Step 2: Syntax-check**

  Run: `node --check service-worker.js`
  Expected: no output (success). As with `storage.js`, this only confirms the JS parses — `self`, `caches`, and `indexedDB`-style globals don't exist in plain Node, so this file cannot actually run outside a service worker context.

- [ ] **Step 3: Confirm every listed asset exists on disk**

  Run:
  ```bash
  for f in index.html style.css app.js supabaseClient.js tasks.js quadrants.js export.js sync.js storage.js syncLogic.js manifest.json icons/icon-192.png icons/icon-512.png; do
    test -f "$f" && echo "OK: $f" || echo "MISSING: $f"
  done
  ```
  Expected: every line says `OK:` — a single `MISSING:` means `cache.addAll` will reject during `install` and the service worker will never activate at all. This is the most common way a service worker silently fails, so don't skip this check.

- [ ] **Step 4: Commit**

  ```bash
  git add service-worker.js
  git commit -m "$(cat <<'EOF'
  Add cache-first service worker for offline app-shell loading

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 7: Wire `app.js` to `sync.js` and register the service worker

**Files:**
- Modify: `app.js` (full replacement)

**Interfaces:**
- Consumes: `loadTasks, captureTasks, updateTag, updateDone, removeTask, flushQueue, initSync` (Task 3, `sync.js`); everything else unchanged from Plan 1.

- [ ] **Step 1: Replace `app.js` entirely** with:

  ```js
  import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
  import { loadTasks, captureTasks, updateTag, updateDone, removeTask, flushQueue, initSync } from "./sync.js";
  import { getQuadrant, getPriorityTasks, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
  import { tasksToExportJson } from "./export.js";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js");
    });
  }

  const authSection = document.getElementById("auth");
  const appSection = document.getElementById("app");
  const authForm = document.getElementById("auth-form");
  const authError = document.getElementById("auth-error");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const signUpButton = document.getElementById("auth-signup");
  const signOutButton = document.getElementById("sign-out");
  const exportButton = document.getElementById("export-json");
  const appError = document.getElementById("app-error");
  const mainView = document.getElementById("main-view");
  const navMain = document.getElementById("nav-main");
  const navHistory = document.getElementById("nav-history");

  let currentView = "main";
  let wasSignedIn = null;

  async function showApp() {
    authSection.hidden = true;
    appSection.hidden = false;
    mainView.innerHTML = "";
    try {
      await flushQueue();
    } catch (_err) {
      // Still offline (or a real error) — render() falls back to cache as needed.
    }
    render();
  }

  function showAuth() {
    authSection.hidden = false;
    appSection.hidden = true;
    mainView.innerHTML = "";
  }

  function showAppError(err) {
    console.error(err);
    appError.textContent = (err && err.message) ? err.message : "Une erreur est survenue.";
  }

  function clearAppError() {
    appError.textContent = "";
  }

  async function safely(fn) {
    try {
      await fn();
    } catch (err) {
      showAppError(err);
      return;
    }
    render();
  }

  function todayDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

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

  function historyRowHtml(task) {
    const date = task.completed_at ? task.completed_at.slice(0, 10) : "";
    return `
      <div class="task-row">
        <span class="task-text">${escapeHtml(task.text)}</span>
        <span class="task-date">${date}</span>
      </div>
    `;
  }

  function quadrantHtml(title, tasks, extraClass = "") {
    return `
      <div class="quadrant ${extraClass}">
        <div class="quadrant-title">${title}</div>
        ${tasks.map(taskRowHtml).join("") || '<p class="empty">Rien ici</p>'}
      </div>
    `;
  }

  function wireTaskRows(container) {
    container.querySelectorAll(".task-row[data-id]").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".task-done").addEventListener("change", (event) => {
        safely(() => updateDone(id, event.target.checked));
      });
      row.querySelector(".task-urgent").addEventListener("click", () => {
        const active = row.querySelector(".task-urgent").dataset.active === "true";
        safely(() => updateTag(id, "urgent", !active));
      });
      row.querySelector(".task-important").addEventListener("click", () => {
        const active = row.querySelector(".task-important").dataset.active === "true";
        safely(() => updateTag(id, "important", !active));
      });
      row.querySelector(".task-delete").addEventListener("click", () => {
        safely(() => removeTask(id));
      });
    });
  }

  async function renderMainView() {
    const allTasks = await loadTasks();
    const { active } = splitActiveAndArchived(allTasks, todayDateString());
    const unsorted = getUnsorted(active);
    const sorted = getSorted(active);
    const priority = getPriorityTasks(sorted);
    const q2 = getQuadrant(sorted, false, true);
    const q3 = getQuadrant(sorted, true, false);
    const q4 = getQuadrant(sorted, false, false);

    mainView.innerHTML = `
      <form id="capture-form">
        <textarea id="capture-input" rows="3" placeholder="Une tâche par ligne..."></textarea>
        <button type="submit">Ajouter</button>
      </form>

      <h2>À trier (${unsorted.length})</h2>
      <div id="unsorted-list">${unsorted.map(taskRowHtml).join("") || '<p class="empty">Rien à trier</p>'}</div>

      <h2>★ Priorités du jour</h2>
      <div id="priority-list">${priority.map(taskRowHtml).join("") || '<p class="empty">Aucune priorité pour l’instant</p>'}</div>

      <h2>Matrice complète</h2>
      <div class="matrix">
        ${quadrantHtml("Urgent + Important", priority, "q1")}
        ${quadrantHtml("Important, pas urgent", q2)}
        ${quadrantHtml("Urgent, pas important", q3)}
        ${quadrantHtml("Ni urgent ni important", q4)}
      </div>
    `;

    document.getElementById("capture-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("capture-input");
      safely(() => captureTasks(input.value));
    });

    wireTaskRows(mainView);
  }

  async function renderHistoryView() {
    const allTasks = await loadTasks();
    const { archived } = splitActiveAndArchived(allTasks, todayDateString());
    archived.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

    mainView.innerHTML = `
      <h2>Historique</h2>
      <div id="history-list">${archived.map(historyRowHtml).join("") || '<p class="empty">Aucune tâche archivée</p>'}</div>
    `;
  }

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

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authError.textContent = "";
    try {
      await signIn(emailInput.value, passwordInput.value);
    } catch (err) {
      authError.textContent = err.message;
    }
  });

  signUpButton.addEventListener("click", async () => {
    authError.textContent = "";
    try {
      await signUp(emailInput.value, passwordInput.value);
    } catch (err) {
      authError.textContent = err.message;
    }
  });

  signOutButton.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (err) {
      showAppError(err);
    }
  });

  exportButton.addEventListener("click", () => {
    safely(async () => {
      const tasks = await loadTasks();
      const json = tasksToExportJson(tasks);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mes-taches-${todayDateString()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  });

  onAuthStateChange((session) => {
    const nowSignedIn = !!session;
    if (nowSignedIn === wasSignedIn) return;
    wasSignedIn = nowSignedIn;
    if (nowSignedIn) showApp();
    else showAuth();
  });

  initSync(render);
  ```

- [ ] **Step 2: Syntax-check**

  Run: `node --check app.js`
  Expected: no output (success).

- [ ] **Step 3: Confirm nothing from Plan 1 was dropped**

  Read the file back and confirm, by comparing against this step's code above line by line: the `tasks.js` import is gone (replaced by `sync.js`), every function call that used to go to `tasks.js` (`listTasks`, `createTasksFromLines`, `setTag`, `setDone`, `deleteTask`) now calls the corresponding `sync.js` function (`loadTasks`, `captureTasks`, `updateTag`, `updateDone`, `removeTask`), and the auth wiring, `escapeHtml`, the read-only history rendering, and the export handler are otherwise unchanged from before this task.

- [ ] **Step 4: Commit**

  ```bash
  git add app.js
  git commit -m "$(cat <<'EOF'
  Wire app.js to offline-aware sync.js and register the service worker

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GwHSRPoE6vUHDnXcT8xvid
  EOF
  )"
  ```

---

### Task 8: Deploy and verify in a real browser (human-driven — not a subagent task)

**Files:** none.

**Interfaces:** none — this validates the deployed result of every prior task.

This task cannot be delegated to a subagent: it requires a real browser with DevTools, and a real iPhone. Push the branch, wait for GitHub Pages to redeploy, then work through this checklist yourself:

- [ ] **Step 1: Push and wait for redeploy**

  Push the merged `main` branch to `origin` (or merge this plan's branch first, per the usual finishing-a-development-branch flow) and wait ~1 minute for GitHub Pages to rebuild.

- [ ] **Step 2: Confirm the service worker activates**

  Open the deployed URL, sign in. Open DevTools → Application (Chrome) or Develop → Show Web Inspector → Storage (Safari) → Service Workers. Expected: one worker listed, status "activated and is running".

- [ ] **Step 3: Confirm the cache is populated**

  DevTools → Application → Cache Storage. Expected: a cache named `mon-app-taches-v1` containing every file listed in `service-worker.js`'s `ASSETS`.

- [ ] **Step 4: Test offline app-shell loading**

  DevTools → Network tab → check "Offline". Reload the page. Expected: the app still loads (sign-in screen or main screen, whichever you left it on) — proof the cache-first strategy works, not just "the app happens to still be in a browser tab."

- [ ] **Step 5: Test offline capture and reconnect sync**

  Still in "Offline" mode, on the main screen, type a task and submit. Expected: it appears immediately under "À trier". Uncheck "Offline", then click into the page (to trigger a `focus` event) or reload. Expected: within a few seconds, check the Supabase dashboard's Table Editor for the `tasks` table — the task should now have a real row with a proper UUID (not the temporary one it was optimistically shown with).

- [ ] **Step 6: Install on Mac**

  In Chrome or Edge, look for an install icon in the address bar (or Menu → "Install Mes Tâches..."). Install it. Expected: it opens in its own window without browser chrome, and an icon appears in the Dock/Applications.

- [ ] **Step 7: Install on iPhone**

  In Safari, open the same URL. Tap Share → "Sur l'écran d'accueil". Expected: the app icon (dark background, green circle) appears on the home screen, and tapping it launches the app full-screen, without Safari's address bar.

- [ ] **Step 8: Report back**

  Note which steps passed and which didn't. Any failure here means a real, unresolved bug in Tasks 1–7 — surfacing it now, in a real browser, is exactly this task's job.

No commit — this task validates, it doesn't change code (unless a real bug is found, in which case it goes back through the fix loop against whichever earlier task it belongs to).

---

## Self-Review Notes

- **Spec coverage:** This plan implements the spec's full "Synchronisation & mode hors-ligne" section (offline queue, last-write-wins via server-owned `updated_at`, no realtime, resync on load/focus, failed-write-is-offline) and "PWA & installation" section (manifest, cache-first service worker, install on Mac/iPhone, version-bump update mechanism). Deliberately out of scope: Notifications push, Réglages screen, Supabase keep-alive — all Plan 3.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command with expected output. The two files that can't be executed in this environment (`storage.js`, `service-worker.js`) are explicitly called out as such rather than given fake "PASS" test steps.
- **Type consistency:** `syncLogic.js`'s three exports (`applyMutation`, `resolveMutationIds`, `buildOptimisticTasks`) are used with matching names/arities in Task 3's `sync.js`. `storage.js`'s five exports are used identically in Task 3. `sync.js`'s seven exports (`loadTasks`, `captureTasks`, `updateTag`, `updateDone`, `removeTask`, `flushQueue`, `initSync`) are used identically in Task 7's `app.js`. The `Mutation` shape (`type`, plus `id`/`rawText`/`tasks`/`tagName`/`value`/`done`/`completedAt` depending on `type`) is used consistently across Tasks 1, 2, and 3. `tasks.js`'s `setDone` signature change (Task 3) is backward compatible with its only other caller within this plan (`sync.js`'s own `flushQueue`, which passes all three arguments).
