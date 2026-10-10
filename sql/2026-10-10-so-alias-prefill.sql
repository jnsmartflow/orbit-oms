-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-10 · Sales officer alias PREFILL — DATA only, no schema change.
-- RUN STATUS: NOT RUN. Owner decisions of 2026-10-10 applied (proposal:
-- docs/prompts/drafts/code-discovery-2026-10-10-so-alias-proposal.md).
-- Runs in ONE paste in the Supabase SQL Editor, top to bottom:
--   Part A — 11 EXACT aliases (key = so_alias_key(master.name)).
--   Part B — 21 CHECK aliases, each to the master the owner chose.
--   Part C — 15 NEW masters, then their 17 aliases.
--   Part D2 — "displayName" for 26 masters.
--   Part E — verify (read-only), the last statement.
-- RE-RUN SAFE: every alias insert uses ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING
-- (the real UNIQUE on "aliasKey"); a new master is created only when no master
-- already has its key; "displayName" is a plain SET. Masters are found by
-- NAME KEY (so_alias_key(name)) — an id is used only together with the name,
-- never alone. #19 "TEST — Smart Flow" and #21 "NULL" are never touched.
-- Telecaller mailboxes (suratakzonobel, suratdepot, suratorder) get NO alias — the code shows them
-- as "Telecaller".
-- Supabase SQL Editor rules: no BEGIN/COMMIT; "check" is reserved (not used as a name).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Part A — EXACT ──────────────────────────────────────────────────────────
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


-- ── Part B — CHECK, owner-decided ───────────────────────────────────────────
-- Pinned by id AND the master's name key, so a wrong id inserts nothing.
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Vishal'), 'Vishal', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- vishal → #16 Vishal Tayade · 224 bills · phones seen 8000094440
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Pal Shiv Kumar'), '(JSW) Pal Shiv Kumar', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- palshivkumar → #10 Shivkumar Pal · 123 bills · phones seen 8488843430
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Shiv Pal'), 'Shiv Pal', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shivpal → #10 Shivkumar Pal · 58 bills · phones seen 8488843430
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Tejas'), 'Tejas', m.id FROM sales_officer_master m WHERE m.id = 15 AND so_alias_key(m.name) = so_alias_key('Tejas Papaiya') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- tejas → #15 Tejas Papaiya · 45 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NARENDRA'), 'NARENDRA', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendra → #17 Narendra Hadiyal · 43 bills · phones seen 8866667582, 9099646041
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NARENDRA HARDIYAL'), 'NARENDRA HARDIYAL', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendrahardiyal → #17 Narendra Hadiyal · 18 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Narendra Suresh Hadiyal'), '(JSW) Narendra Suresh Hadiyal', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- narendrasureshhadiyal → #17 Narendra Hadiyal · 18 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('NAREDRA'), 'NAREDRA', m.id FROM sales_officer_master m WHERE m.id = 17 AND so_alias_key(m.name) = so_alias_key('Narendra Hadiyal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- naredra → #17 Narendra Hadiyal · 15 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('RAHUL - 9327132149'), 'RAHUL - 9327132149', m.id FROM sales_officer_master m WHERE m.id = 12 AND so_alias_key(m.name) = so_alias_key('Rahul Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- rahul → #12 Rahul Pal · 15 bills · phones seen 9327132149, 9537974869
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Aghera Abhi'), 'Aghera Abhi', m.id FROM sales_officer_master m WHERE m.id = 18 AND so_alias_key(m.name) = so_alias_key('Abhishek Aghera') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- agheraabhi → #18 Abhishek Aghera · 12 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('SHIKUMAR PAL'), 'SHIKUMAR PAL', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shikumarpal → #10 Shivkumar Pal · 9 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Shiv'), 'Shiv', m.id FROM sales_officer_master m WHERE m.id = 10 AND so_alias_key(m.name) = so_alias_key('Shivkumar Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- shiv → #10 Shivkumar Pal · 6 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('PUSHPENDRA'), 'PUSHPENDRA', m.id FROM sales_officer_master m WHERE m.id = 20 AND so_alias_key(m.name) = so_alias_key('Pushpendra Kumar') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- pushpendra → #20 Pushpendra Kumar · 4 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('ABHISHEK'), 'ABHISHEK', m.id FROM sales_officer_master m WHERE m.id = 18 AND so_alias_key(m.name) = so_alias_key('Abhishek Aghera') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- abhishek → #18 Abhishek Aghera · 3 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('RAVI -6353630445'), 'RAVI -6353630445', m.id FROM sales_officer_master m WHERE m.id = 13 AND so_alias_key(m.name) = so_alias_key('Ravi Dedania') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- ravi → #13 Ravi Dedania · 3 bills · phones seen 6353630445
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('LAKHAN - 7490804502'), 'LAKHAN - 7490804502', m.id FROM sales_officer_master m WHERE m.id = 14 AND so_alias_key(m.name) = so_alias_key('Lakhan Mali') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- lakhan → #14 Lakhan Mali · 2 bills · phones seen 7490804502
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Rahul Pla'), 'Rahul Pla', m.id FROM sales_officer_master m WHERE m.id = 12 AND so_alias_key(m.name) = so_alias_key('Rahul Pal') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- rahulpla → #12 Rahul Pal · 2 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('VISHAL TAYDE'), 'VISHAL TAYDE', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- vishaltayde → #16 Vishal Tayade · 1 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Dedania Ravi'), 'Dedania Ravi', m.id FROM sales_officer_master m WHERE m.id = 13 AND so_alias_key(m.name) = so_alias_key('Ravi Dedania') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- dedaniaravi → #13 Ravi Dedania · 0 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Mali Lakhan'), 'Mali Lakhan', m.id FROM sales_officer_master m WHERE m.id = 14 AND so_alias_key(m.name) = so_alias_key('Lakhan Mali') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- malilakhan → #14 Lakhan Mali · 0 bills
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Tayade Vishalkumar'), '(JSW) Tayade Vishalkumar', m.id FROM sales_officer_master m WHERE m.id = 16 AND so_alias_key(m.name) = so_alias_key('Vishal Tayade') ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;  -- tayadevishalkumar → #16 Vishal Tayade · 0 bills


-- ── Part C — NEW masters, then their aliases ────────────────────────────────
-- A master is created only if no master already has that name's key; each
-- alias then finds it by the same key (ORDER BY id LIMIT 1 keeps it to one).
-- Roopesh Jha · jharoopeshghanshyam + rupeshjha · 2072 bills
INSERT INTO sales_officer_master (name) SELECT 'Roopesh Jha' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Roopesh Jha'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Jha Roopesh Ghanshyam'), '(JSW) Jha Roopesh Ghanshyam', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Roopesh Jha') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Rupesh Jha'), 'Rupesh Jha', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Roopesh Jha') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Sunil Nishad · sunilnishad · 1669 bills
INSERT INTO sales_officer_master (name) SELECT 'Sunil Nishad' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Sunil Nishad'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('sunil nishad'), 'sunil nishad', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Sunil Nishad') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Pravesh Chitre · praveshchitre · 1194 bills
INSERT INTO sales_officer_master (name) SELECT 'Pravesh Chitre' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Pravesh Chitre'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Pravesh Chitre'), '(JSW) Pravesh Chitre', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Pravesh Chitre') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Vijendra Rajput · vijendrarajput · 1169 bills
INSERT INTO sales_officer_master (name) SELECT 'Vijendra Rajput' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Vijendra Rajput'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Vijendra Rajput'), 'Vijendra Rajput', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Vijendra Rajput') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Nirav Tailor · niravjayeshbhaitailor · 960 bills
INSERT INTO sales_officer_master (name) SELECT 'Nirav Tailor' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Nirav Tailor'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Nirav Jayeshbhai Tailor'), '(JSW) Nirav Jayeshbhai Tailor', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Nirav Tailor') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Bharat Upadhyay · bharatupadhyay · 796 bills
INSERT INTO sales_officer_master (name) SELECT 'Bharat Upadhyay' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Bharat Upadhyay'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Bharat Upadhyay'), 'Bharat Upadhyay', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Bharat Upadhyay') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Kundan Kumar Singh · kundankumarsingh · 618 bills
INSERT INTO sales_officer_master (name) SELECT 'Kundan Kumar Singh' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Kundan Kumar Singh'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Kundan Kumar Singh'), '(JSW) Kundan Kumar Singh', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Kundan Kumar Singh') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Karan Babariya · babariyakarankanubhai + babariyakaran · 477 bills
INSERT INTO sales_officer_master (name) SELECT 'Karan Babariya' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Karan Babariya'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Babariya Karan Kanubhai'), '(JSW) Babariya Karan Kanubhai', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Karan Babariya') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Babariya Karan'), 'Babariya Karan', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Karan Babariya') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Chirag Raut · chiragraut · 114 bills
INSERT INTO sales_officer_master (name) SELECT 'Chirag Raut' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Chirag Raut'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Chirag Raut'), 'Chirag Raut', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Chirag Raut') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Zubin Malek · zubinmalek · 35 bills
INSERT INTO sales_officer_master (name) SELECT 'Zubin Malek' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Zubin Malek'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('zubin malek'), 'zubin malek', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Zubin Malek') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Anand Tripathi · anandtripathi · 33 bills
INSERT INTO sales_officer_master (name) SELECT 'Anand Tripathi' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Anand Tripathi'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Anand Tripathi'), '(JSW) Anand Tripathi', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Anand Tripathi') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Aman Shukla · shuklaamandinesh · 32 bills
INSERT INTO sales_officer_master (name) SELECT 'Aman Shukla' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Aman Shukla'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('(JSW) Shukla Aman Dinesh'), '(JSW) Shukla Aman Dinesh', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Aman Shukla') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Bhaven Upadhyay · bhavenupadhyay · 27 bills
INSERT INTO sales_officer_master (name) SELECT 'Bhaven Upadhyay' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Bhaven Upadhyay'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Bhaven Upadhyay'), 'Bhaven Upadhyay', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Bhaven Upadhyay') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Divanshu Dubey · divanshudubey · 5 bills
INSERT INTO sales_officer_master (name) SELECT 'Divanshu Dubey' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Divanshu Dubey'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('Divanshu Dubey'), 'Divanshu Dubey', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Divanshu Dubey') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;

-- Neev · neev · 3 bills
INSERT INTO sales_officer_master (name) SELECT 'Neev' WHERE NOT EXISTS (SELECT 1 FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Neev'));
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId") SELECT so_alias_key('neev'), 'neev', m.id FROM (SELECT id FROM sales_officer_master WHERE so_alias_key(name) = so_alias_key('Neev') AND id NOT IN (19, 21) ORDER BY id LIMIT 1) m ON CONFLICT ON CONSTRAINT sales_officer_aliases_aliasKey_key DO NOTHING;


-- ── Part D2 — "displayName" (matched by the master's NAME KEY) ─────────────
UPDATE sales_officer_master SET "displayName" = 'Abhishek', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Abhishek Aghera') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Ajay', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Ajay Shah') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Lakhan', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Lakhan Mali') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Narendra', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Narendra Hadiyal') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Pushpendra', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Pushpendra Kumar') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Rahul Pal', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Rahul Pal') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Ravi Dedania', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Ravi Dedania') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Ravi Patel', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Ravi Patel') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Shiv Pal', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Shivkumar Pal') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Tejas', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Tejas Papaiya') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Vishal', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Vishal Tayade') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Roopesh', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Roopesh Jha') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Sunil', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Sunil Nishad') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Pravesh', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Pravesh Chitre') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Vijendra', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Vijendra Rajput') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Nirav', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Nirav Tailor') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Bharat', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Bharat Upadhyay') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Kundan', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Kundan Kumar Singh') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Karan', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Karan Babariya') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Chirag', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Chirag Raut') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Zubin', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Zubin Malek') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Anand', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Anand Tripathi') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Aman', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Aman Shukla') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Bhaven', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Bhaven Upadhyay') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Divanshu', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Divanshu Dubey') AND id NOT IN (19, 21);
UPDATE sales_officer_master SET "displayName" = 'Neev', "updatedAt" = now() WHERE so_alias_key(name) = so_alias_key('Neev') AND id NOT IN (19, 21);


-- ── Part E — VERIFY (read-only) ─────────────────────────────────────────────
-- "bills" = MAIL-ORDER bills: not-removed bills whose SO number's NEWEST mail
-- order spells this person (through an alias). Divisions 74/77 bills resolved by
-- the customer-master link are not counted here. Telecaller mailboxes excluded
-- from "still unmatched".
WITH newest AS (
  SELECT DISTINCT ON ("soNumber") "soNumber", "soName"
  FROM mo_orders
  WHERE "soNumber" IS NOT NULL
  ORDER BY "soNumber", "createdAt" DESC
),
mail_bills AS (
  SELECT so_alias_key(n."soName") AS k, count(*) AS bills
  FROM orders o
  JOIN newest n ON n."soNumber" = o."soNumber"
  WHERE o."isRemoved" = false
  GROUP BY 1
)
SELECT '1 master'::text AS section,
       ('#' || m.id::text || ' ' || m.name)::text AS name,
       m."displayName"::text AS display_name,
       count(a.id)::text AS aliases,
       coalesce(sum(b.bills), 0)::text AS bills
FROM sales_officer_master m
LEFT JOIN sales_officer_aliases a ON a."salesOfficerId" = m.id
LEFT JOIN mail_bills b ON b.k = a."aliasKey"
GROUP BY m.id, m.name, m."displayName"
UNION ALL
SELECT '2 total aliases', NULL::text, NULL::text, count(*)::text, NULL::text
FROM sales_officer_aliases
UNION ALL
SELECT '3 mail-order bills still unmatched', NULL::text, NULL::text, NULL::text, coalesce(sum(b.bills), 0)::text
FROM mail_bills b
WHERE b.k IS NOT NULL
  AND b.k NOT IN ('suratakzonobel', 'suratdepot', 'suratorder')
  AND NOT EXISTS (SELECT 1 FROM sales_officer_aliases a WHERE a."aliasKey" = b.k)
ORDER BY 1, 2;
