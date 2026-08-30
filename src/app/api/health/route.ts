// Liveness probe for the ALB target group. Deliberately does NOT touch the
// database — it answers "is the Node process up and serving", not "is every
// dependency healthy". A DB outage should not cycle every task.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
