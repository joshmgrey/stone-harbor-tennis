// Load test for the signup race condition.
//
// Fires N signup POSTs concurrently at a single session that has exactly one
// open spot, then reports how many were accepted (201) vs. cleanly rejected
// (409 "session is full"). A correct implementation lets exactly one through.
//
//   BASE_URL     default http://localhost:3000
//   SESSION_ID   default 1
//   CONCURRENCY  default 20
//
//   node scripts/load-test-signup.js

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_ID = process.env.SESSION_ID ?? "1";
const N = Number(process.env.CONCURRENCY ?? 20);

async function signup(i) {
  let res;
  try {
    res = await fetch(`${BASE}/api/sessions/${SESSION_ID}/signups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `LoadTest Player ${i}`, phone: "555-0000" }),
    });
  } catch (err) {
    return { status: 0, message: `request failed: ${err.message}` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  const message =
    body?.error ?? (res.status === 201 ? "signed up" : JSON.stringify(body));
  return { status: res.status, message };
}

(async () => {
  console.log(
    `Firing ${N} concurrent signups at ${BASE}/api/sessions/${SESSION_ID}/signups\n`
  );

  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => signup(i + 1))
  );

  results.forEach((r, i) => {
    console.log(`  #${String(i + 1).padStart(2)}  ${r.status}  ${r.message}`);
  });

  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  console.log("\nTotals by status:", byStatus);

  const created = byStatus[201] ?? 0;
  if (created === 1) {
    console.log("\nPASS: exactly 1 signup succeeded; the rest were rejected.");
    process.exit(0);
  } else {
    console.log(
      `\nFAIL: expected exactly 1 success, got ${created}. The capacity check is racy.`
    );
    process.exit(1);
  }
})();
