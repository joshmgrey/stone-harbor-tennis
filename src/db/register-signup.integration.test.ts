// Tests the register_signup PL/pgSQL function against a real Postgres with
// the migrations applied. The route's unit tests mock it, so this is what
// catches a regression in the function itself (e.g. dropping FOR UPDATE or
// an off-by-one in the capacity check).
//
// Skipped unless INTEGRATION_DATABASE_URL is set. CI's e2e job sets it to the
// least-privilege app role, so this also proves that role can run it.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.INTEGRATION_DATABASE_URL;

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
  const prefix = `it-${process.pid}-${Date.now()}`;
  const nameOf = (n: string | number) => `${prefix} ${n}`;

  const register = async (
    session: number,
    name: string,
    opts: {
      phone?: string | null;
      alternate?: boolean;
      capacity?: number;
      db?: pg.Pool | pg.PoolClient;
    } = {}
  ): Promise<Row> => {
    const { rows } = await (opts.db ?? pool).query<Row>(
      "SELECT * FROM register_signup($1, $2, $3, $4, $5)",
      [session, name, opts.phone ?? null, opts.alternate ?? false, opts.capacity ?? 4]
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const regularCount = async () => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM signups WHERE session_id = $1 AND NOT is_alternate",
      [sessionId]
    );
    return rows[0].n;
  };

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 25 });
  });

  beforeEach(async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sessions (date, start_time, end_time, courts)
       VALUES ('2099-01-01', '18:00', '20:00', 1) RETURNING id`
    );
    sessionId = rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(
      "DELETE FROM sessions WHERE date = '2099-01-01'"
    );
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
      await new Promise((r) => setTimeout(r, 300));
      expect(bDone).toBe(false); // blocked on A's session-row lock

      await a.query("COMMIT");
      expect((await b).status).toBe("full");
    } finally {
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

  it("returns not_found for a missing session", async () => {
    expect((await register(-1, nameOf("ghost"))).status).toBe("not_found");
  });

  it("never overwrites a phone already on file, but fills a missing one", async () => {
    await register(sessionId, nameOf("phone"), { phone: "555-0001" });
    await register(sessionId, nameOf("phone"), { phone: "555-9999" }); // already_playing
    await register(sessionId, nameOf("nophone"));
    await register(sessionId, nameOf("nophone"), { phone: "555-0002" });

    const { rows } = await pool.query<{ name: string; phone: string | null }>(
      "SELECT name, phone FROM players WHERE name = ANY($1) ORDER BY name",
      [[nameOf("nophone"), nameOf("phone")]]
    );
    expect(rows.map((r) => r.phone)).toEqual(["555-0002", "555-0001"]);
  });

  it("handles concurrent first signups under one new name without a unique violation", async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sessions (date, start_time, end_time, courts)
       VALUES ('2099-01-01', '18:00', '20:00', 1) RETURNING id`
    );
    const other = rows[0].id;

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
