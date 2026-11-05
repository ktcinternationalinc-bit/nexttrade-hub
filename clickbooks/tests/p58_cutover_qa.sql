-- Rollback-only parallel/cutover acceptance harness reference.
-- The executed test used the real recent US payment relationships inside BEGIN ... ROLLBACK,
-- verified split-deposit cash totals, Wave write disable, bank-feed preservation and exact Wave flag restore.
-- Exact results and source relationship IDs are intentionally kept out of this portable harness; use the
-- connected project's QA evidence and the current source snapshot before rerunning on a later dataset.
\set ON_ERROR_STOP on
begin isolation level repeatable read;
select clickbooks_us.parallel_status(current_date-7,current_date);
rollback;
