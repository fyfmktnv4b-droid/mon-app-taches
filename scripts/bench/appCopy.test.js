import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leftovers, prepareAppCopy, projectRef, REPO_ROOT, rewrite } from "./appCopy.js";

const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8");
const ref = projectRef(read("supabaseClient.js"));

test("rewrite points the Supabase address and the CSP at the fake server", () => {
  const html = rewrite(read("index.html"), ref, 4321);
  assert.match(html, new RegExp(`connect-src 'self' http://${ref}\\.supabase\\.co:4321 ws://${ref}\\.supabase\\.co:4321;`));
  assert.deepEqual(leftovers(html, ref, 4321), []);
});

test("leftovers does catch an address that was not rewritten", () => {
  assert.deepEqual(leftovers(`fetch("https://${ref}.supabase.co/rest/v1/")`, ref, 4321), [`https://${ref}.supabase.co`]);
  assert.equal(leftovers(`"${ref}.supabase.co:9999"`, ref, 4321).length, 1);
});

test("the app copy has no service worker, no test and no trace of the real address", async () => {
  const copy = await prepareAppCopy({ apiPort: 4321 });
  try {
    assert.ok(!copy.dir.startsWith(REPO_ROOT), "the copy must live outside the repository");
    assert.ok(existsSync(join(copy.dir, "index.html")));
    assert.ok(existsSync(join(copy.dir, "vendor", "supabase-js.esm.js")));
    assert.ok(!existsSync(join(copy.dir, "service-worker.js")));
    assert.ok(!existsSync(join(copy.dir, "assets.test.js")));
    assert.match(readFileSync(join(copy.dir, "supabaseClient.js"), "utf8"), new RegExp(`SUPABASE_URL = "http://${ref}\\.supabase\\.co:4321"`));
  } finally {
    await copy.cleanup();
  }
});
