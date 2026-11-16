// Tests the register_signup PL/pgSQL function against a real Postgres with
// the migrations applied. The route's unit tests mock it, so this is what
// catches a regression in the function itself (e.g. dropping FOR UPDATE or
// an off-by-one in the capacity check).
//
// Skipped unless INTEGRATION_DATABASE_URL is set. CI's e2e job sets it to the
// least-privilege app role, so this also proves that role can run it. It only
// deletes the sessions and players it created itself.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.INTEGRATION_DATABASE_URL;

const PLAYERS_PER_COURT = 4;

type Row = {
  status: string;
  signup_id: number | null;
  player_id: number | null;
  player_name: string | null;
};

describe.skipIf(!url)("register_signup (real Postgres)", () => {
  // Concurrency needs real parallel connections, not one serialized client.
  let pool: pg.Pool;
  let sessionId: number;
  const createdSessions: number[] = [];
  const prefix = `it-${process.pid}-${Date.now()}`;
  const nameOf = (n: string | number) => `${prefix} ${n}`;

  const newSession = async (courts = 1) => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sessions (date, start_time, end_time, courts)
       VALUES ('2099-01-01', '18:00', '20:00', $1) RETURNING id`,
      [courts]
    );
    createdSessions.push(rows[0].id);
    return rows[0].id;
  };

  const register = async (
    session: number,
    name: string,
    opts: { phone?: string | null; alternate?: boolean; db?: pg.Pool | pg.PoolClient } = {}
  ): Promise<Row> => {
    const { rows } = await (opts.db ?? pool).query<Row>(
      "SELECT * FROM register_signup($1, $2, $3, $4, $5)",
      [session, name, opts.phone ?? null, opts.alternate ?? false, PLAYERS_PER_COURT]
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const regularCount = async (session = sessionId) => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM signups WHERE session_id = $1 AND NOT is_alternate",
      [session]
    );
    return rows[0].n;
  };

  const phoneOf = async (name: string) => {
    const { rows } = await pool.query<{ phone: string | null }>(
      "SELECT phone FROM players WHERE name = $1",
      [name]
    );
    return rows[0]?.phone;
  };

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 25 });
  });

  beforeEach(async () => {
    sessionId = await newSession(); // 1 court: capacity 4
  });

  afterAll(async () => {
    if (!pool) return;
    // Signups cascade with their sessions.
    await pool.query("DELETE FROM sessions WHERE id = ANY($1)", [createdSessions]);
    await pool.query("DELETE FROM players WHERE name LIKE $1", [`${prefix}%`]);
    await pool.end();
  });

  it("makes a signup for the last spot wait for an uncommitted one (row lock)", async () => {
    for (let i = 1; i <= 3; i++) await register(sessionId, nameOf(`lock ${i}`));

    // A takes the last spot but hasn't committed. Without FOR UPDATE, B's
    // count wouldn't see A's insert and B would also get in (5 of 4).
    const a = await pool.connect();
    try {
      await a.query("BEGIN");
      expect((await register(sessionId, nameOf("A"), { db: a })).status).toBe("created");

      let bDone = false;
      const b = register(sessionId, nameOf("B")).finally(() => {
        bDone = true;
      });

      // Wait until B is either finished or observed blocked on a lock in
      // Postgres, rather than guessing with a fixed delay.
      const deadline = Date.now() + 10_000;
      let bBlocked = false;
      while (!bDone && !bBlocked && Date.now() < deadline) {
        const { rows } = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query LIKE '%register_signup%'`
        );
        bBlocked = rows[0].n > 0;
        if (!bBlocked) await new Promise((r) => setTimeout(r, 20));
      }
      expect(bDone).toBe(false); // finished without waiting: no lock
      expect(bBlocked).toBe(true);

      await a.query("COMMIT");
      expect((await b).status).toBe("full");
    } finally {
      // On an early failure, release A's lock so B (and the run) don't hang.
      await a.query("ROLLBACK").catch(() => {});
      a.release();
    }
    expect(await regularCount()).toBe(4);
  });

  it("lets exactly one of 20 concurrent signups take the last spot", async () => {
    for (let i = 1; i <= 3; i++) {
      expect((await register(sessionId, nameOf(`seed ${i}`))).status).toBe("created");
    }

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => register(sessionId, nameOf(`racer ${i}`)))
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === "created")).toHaveLength(1);
    expect(statuses.filter((s) => s === "full")).toHaveLength(19);
    expect(await regularCount()).toBe(4);
  });

  it("admits alternates past capacity and rejects duplicates", async () => {
    for (let i = 1; i <= 4; i++) await register(sessionId, nameOf(`full ${i}`));

    expect((await register(sessionId, nameOf("late"))).status).toBe("full");
    expect((await register(sessionId, nameOf("alt"), { alternate: true })).status).toBe(
      "created"
    );
    expect((await register(sessionId, nameOf("alt"), { alternate: true })).status).toBe(
      "already_alternate"
    );
    expect((await register(sessionId, nameOf("full 1"))).status).toBe("already_playing");
  });

  it("uses the session's current courts, read under the lock", async () => {
    const twoCourts = await newSession(2); // capacity 8
    for (let i = 1; i <= 4; i++) await register(twoCourts, nameOf(`courts ${i}`));

    await pool.query("UPDATE sessions SET courts = 1 WHERE id = $1", [twoCourts]);

    expect((await register(twoCourts, nameOf("courts 5"))).status).toBe("full");
    expect(await regularCount(twoCourts)).toBe(4);
  });

  it("returns not_found for a missing session", async () => {
    expect((await register(-1, nameOf("ghost"))).status).toBe("not_found");
  });

  it("never overwrites a phone, and only fills a missing one on a successful signup", async () => {
    // Existing phone survives a rejected (duplicate) request with another number.
    await register(sessionId, nameOf("phone"), { phone: "555-0001" });
    await register(sessionId, nameOf("phone"), { phone: "555-9999" });
    expect(await phoneOf(nameOf("phone"))).toBe("555-0001");

    // A rejected request can't attach a phone to a player who has none...
    await register(sessionId, nameOf("nophone"));
    await register(sessionId, nameOf("nophone"), { phone: "555-0002" });
    expect(await phoneOf(nameOf("nophone"))).toBeNull();

    // ...but their own successful signup elsewhere fills it in.
    const other = await newSession();
    expect((await register(other, nameOf("nophone"), { phone: "555-0003" })).status).toBe(
      "created"
    );
    expect(await phoneOf(nameOf("nophone"))).toBe("555-0003");
  });

  it("handles concurrent first signups under one new name without a unique violation", async () => {
    const other = await newSession();

    const results = await Promise.all([
      register(sessionId, nameOf("twin")),
      register(other, nameOf("twin")),
      register(sessionId, nameOf("twin")),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      "already_playing",
      "created",
      "created",
    ]);
    const ids = new Set(results.filter((r) => r.player_id).map((r) => r.player_id));
    expect(ids.size).toBe(1);
  });
});
