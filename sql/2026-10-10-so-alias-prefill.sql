-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-10 · Sales officer alias PREFILL — DATA only, no schema change.
-- RUN STATUS: NOT RUN. Review docs/prompts/drafts/code-discovery-2026-10-10-
-- so-alias-proposal.md first.
--   Part A — 11 EXACT aliases (key = so_alias_key(master.name)): run as is.
--   Part B — 20 CHECK aliases: COMMENTED OUT, one per line — uncomment the ones you confirm.
--   Part C — 25 NEW PEOPLE: COMMENTED OUT — a sales_officer_master row, then its alias.
--   Part D — verify (read-only).
-- Every write is re-run safe: aliases use ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING
-- (the real UNIQUE on "aliasKey"); new master rows use WHERE NOT EXISTS on the key.
-- No id is hardcoded for a NEW person — the alias finds its master by key.
-- Keys come from the live so_alias_key() (v27.62). Telecaller mailboxes
-- (suratakzonobel, suratdepot, suratorder) get NO alias — the code shows them as "Telecaller".
-- Supabase SQL Editor rules: no BEGIN/COMMIT; "check" is reserved (not used as a name).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Part A — EXACT (run as is) ──────────────────────────────────────────────
-- Each master is found BY ITS OWN KEY, never by id, and #19 TEST / #21 "NULL" are excluded.
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Ravi Patel'), 'Ravi Patel', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'ravipatel' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #11 Ravi Patel · 2408 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Rahul Pal'), 'Rahul Pal', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'rahulpal' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #12 Rahul Pal · 210 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Lakhan Mali'), 'Lakhan Mali', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'lakhanmali' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #14 Lakhan Mali · 197 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Shivkumar Pal'), 'Shivkumar Pal', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'shivkumarpal' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #10 Shivkumar Pal · 99 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Vishal Tayade'), 'Vishal Tayade', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'vishaltayade' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #16 Vishal Tayade · 64 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Tejas Papaiya'), 'Tejas Papaiya', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'tejaspapaiya' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #15 Tejas Papaiya · 61 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Ravi Dedania'), 'Ravi Dedania', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'ravidedania' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #13 Ravi Dedania · 57 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Ajay Shah'), 'Ajay Shah', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'ajayshah' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #9 Ajay Shah · 28 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Abhishek Aghera'), 'Abhishek Aghera', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'abhishekaghera' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #18 Abhishek Aghera · 0 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Narendra Hadiyal'), 'Narendra Hadiyal', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'narendrahadiyal' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #17 Narendra Hadiyal · 0 bills

INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT so_alias_key('Pushpendra Kumar'), 'Pushpendra Kumar', m.id
FROM sales_officer_master m
WHERE so_alias_key(m.name) = 'pushpendrakumar' AND m.id NOT IN (19, 21)
ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- #20 Pushpendra Kumar · 0 bills


-- ── Part B — CHECK (commented out; uncomment the lines you confirm) ─────────
-- One line per alias. The master is pinned by id AND its key, so a wrong id inserts nothing.
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Vishal'), 'Vishal', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- vishal → #16 Vishal Tayade · first name / short form only · 224 bills · phone 8000094440
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Pal Shiv Kumar'), '(JSW) Pal Shiv Kumar', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- palshivkumar → #10 Shivkumar Pal · same letters, reordered · 123 bills · phone 8488843430
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Shiv Pal'), 'Shiv Pal', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shivpal → #10 Shivkumar Pal · initial or short form · 58 bills · phone 8488843430
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Tejas'), 'Tejas', m.id FROM sales_officer_master m WHERE m.id = 15 AND so_alias_key(m.name) = so_alias_key('Tejas Papaiya') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- tejas → #15 Tejas Papaiya · first name / short form only · 45 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NARENDRA'), 'NARENDRA', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendra → #17 Narendra Hadiyal · first name / short form only · 43 bills · phone 8866667582
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NARENDRA HARDIYAL'), 'NARENDRA HARDIYAL', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendrahardiyal → #17 Narendra Hadiyal · one-letter typo · 18 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Narendra Suresh Hadiyal'), '(JSW) Narendra Suresh Hadiyal', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendrasureshhadiyal → #17 Narendra Hadiyal · longer form of the name · 18 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('RAHUL - 9327132149'), 'RAHUL - 9327132149', m.id FROM sales_officer_master m WHERE m.id = 12 AND so_alias_key(m.name) = so_alias_key('Rahul Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- rahul → #12 Rahul Pal · first name / short form only · 15 bills · phone 9327132149
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Aghera Abhi'), 'Aghera Abhi', m.id FROM sales_officer_master m WHERE m.id = 18 AND so_alias_key(m.name) = so_alias_key('Abhishek Aghera') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- agheraabhi → #18 Abhishek Aghera · initial or short form · 12 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('SHIKUMAR PAL'), 'SHIKUMAR PAL', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shikumarpal → #10 Shivkumar Pal · one-letter typo · 9 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Shiv'), 'Shiv', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shiv → #10 Shivkumar Pal · first name / short form only · 6 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('PUSHPENDRA'), 'PUSHPENDRA', m.id FROM sales_officer_master m WHERE m.id = 20 AND so_alias_key(m.name) = so_alias_key('Pushpendra Kumar') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- pushpendra → #20 Pushpendra Kumar · first name / short form only · 4 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('ABHISHEK'), 'ABHISHEK', m.id FROM sales_officer_master m WHERE m.id = 18 AND so_alias_key(m.name) = so_alias_key('Abhishek Aghera') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- abhishek → #18 Abhishek Aghera · first name / short form only · 3 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('RAVI -6353630445'), 'RAVI -6353630445', m.id FROM sales_officer_master m WHERE m.id = 11 AND so_alias_key(m.name) = so_alias_key('Ravi Patel') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- ravi → #11 Ravi Patel · AMBIGUOUS — keep at most ONE of these · 3 bills · phone 6353630445
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('RAVI -6353630445'), 'RAVI -6353630445', m.id FROM sales_officer_master m WHERE m.id = 13 AND so_alias_key(m.name) = so_alias_key('Ravi Dedania') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- ravi → #13 Ravi Dedania · AMBIGUOUS — keep at most ONE of these · 3 bills · phone 6353630445
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('LAKHAN - 7490804502'), 'LAKHAN - 7490804502', m.id FROM sales_officer_master m WHERE m.id = 14 AND so_alias_key(m.name) = so_alias_key('Lakhan Mali') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- lakhan → #14 Lakhan Mali · first name / short form only · 2 bills · phone 7490804502
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Rahul Pla'), 'Rahul Pla', m.id FROM sales_officer_master m WHERE m.id = 12 AND so_alias_key(m.name) = so_alias_key('Rahul Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- rahulpla → #12 Rahul Pal · one-letter typo · 2 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('VISHAL TAYDE'), 'VISHAL TAYDE', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- vishaltayde → #16 Vishal Tayade · one-letter typo · 1 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Dedania Ravi'), 'Dedania Ravi', m.id FROM sales_officer_master m WHERE m.id = 13 AND so_alias_key(m.name) = so_alias_key('Ravi Dedania') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- dedaniaravi → #13 Ravi Dedania · words swapped · 0 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Mali Lakhan'), 'Mali Lakhan', m.id FROM sales_officer_master m WHERE m.id = 14 AND so_alias_key(m.name) = so_alias_key('Lakhan Mali') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- malilakhan → #14 Lakhan Mali · words swapped · 0 bills
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Tayade Vishalkumar'), '(JSW) Tayade Vishalkumar', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- tayadevishalkumar → #16 Vishal Tayade · longer form of the name · 0 bills


-- ── Part C — NEW PEOPLE (commented out; uncomment a person's PAIR of lines) ──
-- The master row is created only if no master already has that key; the alias
-- then finds it by key. Name = the cleanest spelling, title-cased — edit it
-- before you run if the person spells it differently.
-- jharoopeshghanshyam · 1916 bills · ⚠ may be the same person as rupeshjha — confirm before creating two
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Jha Roopesh Ghanshyam', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'jharoopeshghanshyam');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Jha Roopesh Ghanshyam'), '(JSW) Jha Roopesh Ghanshyam', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'jharoopeshghanshyam' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- sunilnishad · 1669 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Sunil Nishad', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'sunilnishad');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('sunil nishad'), 'sunil nishad', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'sunilnishad' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- praveshchitre · 1194 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Pravesh Chitre', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'praveshchitre');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Pravesh Chitre'), '(JSW) Pravesh Chitre', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'praveshchitre' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- vijendrarajput · 1169 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Vijendra Rajput', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'vijendrarajput');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Vijendra Rajput'), 'Vijendra Rajput', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'vijendrarajput' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- niravjayeshbhaitailor · 960 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Nirav Jayeshbhai Tailor', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'niravjayeshbhaitailor');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Nirav Jayeshbhai Tailor'), '(JSW) Nirav Jayeshbhai Tailor', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'niravjayeshbhaitailor' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- bharatupadhyay · 796 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Bharat Upadhyay', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'bharatupadhyay');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Bharat Upadhyay'), 'Bharat Upadhyay', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'bharatupadhyay' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- kundankumarsingh · 618 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Kundan Kumar Singh', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'kundankumarsingh');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Kundan Kumar Singh'), '(JSW) Kundan Kumar Singh', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'kundankumarsingh' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- babariyakarankanubhai · 249 bills · ⚠ maybe same as babariyakaran (longer form of the name)
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Babariya Karan Kanubhai', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'babariyakarankanubhai');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Babariya Karan Kanubhai'), '(JSW) Babariya Karan Kanubhai', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'babariyakarankanubhai' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- babariyakaran · 228 bills · ⚠ maybe same as babariyakarankanubhai (initial or short form)
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Babariya Karan', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'babariyakaran');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Babariya Karan'), 'Babariya Karan', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'babariyakaran' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- rupeshjha · 156 bills · ⚠ may be the same person as jharoopeshghanshyam (Roopesh / Rupesh Jha) — confirm before creating two
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Rupesh Jha', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'rupeshjha');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Rupesh Jha'), 'Rupesh Jha', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'rupeshjha' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- chiragraut · 114 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Chirag Raut', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'chiragraut');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Chirag Raut'), 'Chirag Raut', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'chiragraut' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- zubinmalek · 35 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Zubin Malek', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'zubinmalek');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('zubin malek'), 'zubin malek', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'zubinmalek' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- anandtripathi · 33 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Anand Tripathi', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'anandtripathi');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Anand Tripathi'), '(JSW) Anand Tripathi', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'anandtripathi' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- shuklaamandinesh · 32 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Shukla Aman Dinesh', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'shuklaamandinesh');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Shukla Aman Dinesh'), '(JSW) Shukla Aman Dinesh', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'shuklaamandinesh' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- bhavenupadhyay · 27 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Bhaven Upadhyay', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'bhavenupadhyay');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Bhaven Upadhyay'), 'Bhaven Upadhyay', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'bhavenupadhyay' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- naredra · 15 bills · ⚠ probably a typo of NARENDRA — see the narendra check rows
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Naredra', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'naredra');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NAREDRA'), 'NAREDRA', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'naredra' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- divanshudubey · 5 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Divanshu Dubey', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'divanshudubey');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Divanshu Dubey'), 'Divanshu Dubey', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'divanshudubey' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- neev · 3 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Neev', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'neev');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('neev'), 'neev', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'neev' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- dhanrajshah · 1 bills · ⚠ Dhanraj Shah is an Orbit staff user (dispatcher) — probably not an SO
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Dhanraj Shah', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'dhanrajshah');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Dhanraj Shah'), 'Dhanraj Shah', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'dhanrajshah' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- suratproject · 1 bills · ⚠ looks like a depot/project mailbox, not a person
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Surat Project', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'suratproject');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Surat Project'), 'Surat Project', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'suratproject' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- barotdilipranaji · 0 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Barot Dilip Ranaji', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'barotdilipranaji');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Barot Dilip Ranaji'), '(JSW) Barot Dilip Ranaji', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'barotdilipranaji' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- chitrakshbajaj · 0 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Chitraksh Bajaj', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'chitrakshbajaj');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Chitraksh Bajaj'), '(JSW) Chitraksh Bajaj', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'chitrakshbajaj' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- harshpatel · 0 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Harsh Patel', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'harshpatel');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Harsh Patel'), 'Harsh Patel', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'harshpatel' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- jayminshah · 0 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Jaymin Shah', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'jayminshah');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Jaymin Shah'), '(JSW) Jaymin Shah', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'jayminshah' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- shubhampatil · 0 bills
-- INSERT INTO sales_officer_master (name, phone) SELECT 'Shubham Patil', NULL WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = 'shubhampatil');
-- INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Shubham Patil'), 'Shubham Patil', m.id FROM sales_officer_master m WHERE so_alias_key(m.name) = 'shubhampatil' ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;


-- ── Part D — VERIFY (read-only) ─────────────────────────────────────────────
-- "unmatched" counts MAIL-ORDER bills only (the free-text path; divisions 74/77
-- mostly resolve through the master link): not-removed bills whose SO number's
-- NEWEST mail order has a spelling with no alias, telecaller mailboxes excluded.
WITH newest AS (
  SELECT DISTINCT ON ("soNumber") "soNumber", "soName"
  FROM mo_orders
  WHERE "soNumber" IS NOT NULL
  ORDER BY "soNumber", "createdAt" DESC
)
SELECT '1 aliases for #' || m.id::text || ' ' || m.name AS item, count(a.id)::text AS n
FROM sales_officer_master m
LEFT JOIN sales_officer_aliases a ON a."salesOfficerId" = m.id
GROUP BY m.id, m.name
UNION ALL
SELECT '2 total aliases', count(*)::text FROM sales_officer_aliases
UNION ALL
SELECT '3 mail-order bills still unmatched', count(*)::text
FROM orders o
JOIN newest n ON n."soNumber" = o."soNumber"
WHERE o."isRemoved" = false
  AND so_alias_key(n."soName") IS NOT NULL
  AND so_alias_key(n."soName") NOT IN ('suratakzonobel', 'suratdepot', 'suratorder')
  AND NOT EXISTS (SELECT 1 FROM sales_officer_aliases a WHERE a."aliasKey" = so_alias_key(n."soName"))
ORDER BY 1;
