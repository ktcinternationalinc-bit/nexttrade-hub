-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RI — simpler wires (Max, Nov 9 10:37: "how to even choose a freaking
-- bill. make it simple and user friendly")
--  Picking any open bill for an RTM / NextTrade wire marks it "paid through"
--  that company. This flag remembers which bills THE WIRE marked, so removing
--  the bill or cancelling the wire puts it back to "we pay it directly".
-- SAFE TO RE-RUN. Needs RG + RH first.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.wire_package_lines ADD COLUMN IF NOT EXISTS marked_paid_via boolean NOT NULL DEFAULT false;

SELECT 'wire_package_lines.marked_paid_via' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wire_package_lines' AND column_name = 'marked_paid_via') THEN 'OK' ELSE 'MISSING' END AS result;
