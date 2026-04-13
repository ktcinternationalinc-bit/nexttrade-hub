-- ============================================
-- TREASURY RECONCILIATION — 64 Missing Entries
-- Excel target net: EGP 6,356,317.00
-- Current JSON seed net: EGP 6,291,612.00
-- Gap: EGP 64,705
-- 
-- Many entries are check+deposit PAIRS that
-- cancel out (zero net impact) but are real
-- transactions that should exist in the ledger.
--
-- Categories are NULL — your existing auto-rules
-- and manual categorizations are NOT touched.
-- ============================================

-- ─── STEP 1: Check current DB totals FIRST ───
SELECT COUNT(*) as entries, SUM(cash_in) as total_in, SUM(cash_out) as total_out, SUM(cash_in)-SUM(cash_out) as net FROM treasury;

-- ─── STEP 2: Insert missing entries ───

-- Opening balance (never imported)
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) SELECT '2014-04-08','','رصيد اول الفتره (Opening Balance)',2518.45,0,'import' WHERE NOT EXISTS (SELECT 1 FROM treasury WHERE description LIKE '%رصيد اول الفتره%');

-- 2014
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2014-06-08','1001','محمد فتحى',150,0,'import'), ('2014-12-01','','عهده للمخزن',0,3458,'import');

-- 2015
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2015-02-12','1056','محمد عبد الرسول',16000,0,'import'), ('2015-09-07','','تحويل امريكا 15000$عن طريق مصطفى عبد الباقى',0,120638,'import'), ('2015-09-08','','عهده المخزن',0,4978,'import');

-- 2016
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2016-08-02','','شراء 2660 $',0,23302,'import'), ('2016-04-20','','عهده المخزن',0,3443,'import'), ('2016-04-25','','سامح محمد',0,1628,'import'), ('2016-05-05','','عهده المخزن',0,3042,'import');

-- 2017 (biggest gap year)
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2017-03-05','','تحويل مبلغ 23550$',0,418012,'import'), ('2017-03-17','','عهده المخزن',0,7780,'import'), ('2017-10-11','','ا/ محمود نسيب ا/ محمد',0,3300,'import'), ('2017-10-19','1205','بصمه',16300,0,'import'), ('2017-12-02','1213','ثروت',15050,0,'import'), ('2017-12-05','','27000$ مصطفى عبد الباقى',0,470000,'import'), ('2017-12-20','','ابو طالب المخلص',0,245245,'import'), ('2017-12-20','1216','بصمه',160,0,'import'), ('2017-12-26','1211','محمد عبد الرسول ما يعادل 5613$ امريكا 124',101030,0,'import'), ('2017-12-26','','ما يعادل 3821$ محمد عبد الرسول من الكمبياله الرابعه',68770,0,'import');

-- 2018
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2018-01-04','1216','بصمه',59000,0,'import'), ('2018-01-06','1217','لطفى عبد اللطيف السيد',3265,0,'import'), ('2018-01-31','','شاحن تليفون ا/ محمد قنديل',0,75,'import'), ('2018-01-31','','علبه شيكولاته',0,125,'import'), ('2018-01-31','','جراج فندق قبارى رزق',0,85,'import');

-- 2019
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2019-04-18','1359','تمام',61300,0,'import'), ('2019-08-27','','عبد الباقى',0,428654,'import'), ('2019-08-27','','عبد الباقى تحت المصاريف',0,1346,'import'), ('2019-10-20','امريكا 243','عبد الباقى',0,400569,'import'), ('2019-10-20','امريكا 247','عبد الباقى',0,345559,'import'), ('2019-10-20','','عبد الباقى',0,3871,'import'), ('2019-11-25','امريكا 256','مصطفى عبد الباقى',0,383978,'import');

-- 2020
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2020-11-25','امريكا 256','مصطفى عبد الباقى',0,1022,'import');

-- 2021 (check+deposit pairs, net zero)
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2021-02-09','1580','ايماك شيك',547604,0,'import'), ('2021-02-09','1580','ايماك شيك',163293,0,'import'), ('2021-02-09','','الحاج مصطفى ايداع بنك',0,547604,'import'), ('2021-02-09','','الحاج مصطفى ايداع بنك',0,163293,'import');

-- 2022
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2022-04-24','','فطار المخزن زيارة استاذ محمد',0,1340,'import'), ('2022-06-14','','عمليه محمد عادل',0,6262,'import'), ('2022-06-24','','شيك ا/ محمدود نسيب ا/محمد قنديل',0,530000,'import'), ('2022-01-12','','كشف واشعه وتحاليل عبد الله',0,1302,'import');

-- 2023 (includes check+deposit pairs)
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2023-01-04','1759','ايماك',201098,0,'import'), ('2023-01-04','1759','ايماك',1746917,0,'import'), ('2023-01-04','','اايداع بالبنك شيك ايماك',0,1746917,'import'), ('2023-01-04','1759','ايماك',1549986,0,'import'), ('2023-01-04','','ايداع بالبنك شيك ايماك',0,1549986,'import'), ('2023-05-06','','مساهمه تكافليه ا/ خالد المحاسب',0,5058,'import'), ('2023-08-24','','ايداع ابو طالب',0,660667,'import'), ('2023-09-23','','كشف وعلاج عبد الله',0,466,'import'), ('2023-09-26','1842','محمد عبد الرسول',48788,0,'import'), ('2023-11-09','','شيك ايماك',3550925,0,'import'), ('2023-11-09','','ايداع شيك اماك حساب كى تى سى',0,3550925,'import');

-- 2024 (includes check+deposit pairs)
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2024-02-12','1887','سعد مصطفى',92,0,'import'), ('2024-04-13','','كشف وعلاج وجبس',0,1146,'import'), ('2024-05-02','1926','ايماك البيعه',6389120,0,'import'), ('2024-05-02','','ايداع بنك كى تى سى',0,6389120,'import'), ('2024-05-08','1929','ايماك البيعه',2769408,0,'import'), ('2024-05-08','','ايماك شيك',0,2769408,'import'), ('2024-08-27','1993','شيك ايمالك',1053442,0,'import'), ('2024-08-27','','ايداع شيك ايماك كى تى سى',0,1053442,'import');

-- 2025
INSERT INTO treasury (transaction_date, order_number, description, cash_in, cash_out, source) VALUES ('2025-06-22','2157','استلام شيك ايماك',5258264,0,'import'), ('2025-06-22','2157','ايداع شيك ايماك بالبنك',0,5258264,'import'), ('2025-07-17','','كشف وعلاج عبد الناصر',0,1468,'import'), ('2025-09-16','','مواصلات شيك ايهاب ابراهيم',0,60,'import'), ('2025-10-19','2236','ياسر عباده',212748,0,'import'), ('2025-10-19','2242','ياسر عباده',187252,0,'import');

-- ─── STEP 3: Re-check totals ───
SELECT COUNT(*) as entries, SUM(cash_in) as total_in, SUM(cash_out) as total_out, SUM(cash_in)-SUM(cash_out) as net FROM treasury;
-- Target: net should move closer to 6,356,317
