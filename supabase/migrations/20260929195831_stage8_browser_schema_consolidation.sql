-- Hosted consolidation checkpoint.
--
-- The Stage 8 browser schema was reapplied idempotently after recovery to verify
-- indexes, RLS, grants, provider records and Realtime publication membership.
-- The replayable source is the foundation migration at 20260929194317.
select 1;
