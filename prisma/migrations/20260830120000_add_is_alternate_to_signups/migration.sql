-- Alternate sign-ups. Additive and non-blocking (metadata-only in PG 11+):
-- the currently-running app selects explicit columns and is unaffected.
ALTER TABLE "signups" ADD COLUMN "is_alternate" BOOLEAN NOT NULL DEFAULT false;
