-- RUN on live 2026-10-10 · result: 28 masters (15 new, #22–#36), 53 aliases,
--   2 mail-order bills unmatched (dhanrajshah, suratproject — skipped on purpose)
-- Earlier version failed (42704): unquoted mixed-case name after ON CONFLICT ON CONSTRAINT.
--   This file uses ON CONFLICT ("aliasKey") instead. Do not revert.
-- Part 1 originally inserted NULL employeeCode, which broke 8 read paths (Prisma requires it);
--   fixed live the same day by Part 1b. Part 1 now writes '' directly.

-- 2026-10-10 · Sales officer alias PREFILL (owner decisions applied) · data only
-- Re-run safe. #19 TEST and #21 NULL never touched.

-- ── 1. New SOs (only if not already there) ───────────────────────────────
INSERT INTO sales_officer_master (name, "employeeCode", "updatedAt")
SELECT v.n, '', now()
FROM (VALUES
  ('Roopesh Jha'), ('Sunil Nishad'), ('Pravesh Chitre'), ('Vijendra Rajput'),
  ('Nirav Tailor'), ('Bharat Upadhyay'), ('Kundan Kumar Singh'), ('Karan Babariya'),
  ('Chirag Raut'), ('Zubin Malek'), ('Anand Tripathi'), ('Aman Shukla'),
  ('Bhaven Upadhyay'), ('Divanshu Dubey'), ('Neev')
) AS v(n)
WHERE NOT EXISTS (
  SELECT 1 FROM sales_officer_master m WHERE so_alias_key(m.name) = so_alias_key(v.n)
);

-- ── 1b. Safety: no NULL employeeCode (app requires a string) ───────────────
UPDATE sales_officer_master SET "employeeCode" = '', "updatedAt" = now()
WHERE "employeeCode" IS NULL;

-- ── 2. Spellings → person (person found by name, never by id) ──────────────
INSERT INTO sales_officer_aliases ("aliasKey", "rawExample", "salesOfficerId")
SELECT DISTINCT ON (so_alias_key(v.raw)) so_alias_key(v.raw), v.raw, p.id
FROM (VALUES
  ('Ravi Patel','Ravi Patel'), ('Rahul Pal','Rahul Pal'), ('Lakhan Mali','Lakhan Mali'),
  ('Shivkumar Pal','Shivkumar Pal'), ('Vishal Tayade','Vishal Tayade'),
  ('Tejas Papaiya','Tejas Papaiya'), ('Ravi Dedania','Ravi Dedania'), ('Ajay Shah','Ajay Shah'),
  ('Abhishek Aghera','Abhishek Aghera'), ('Narendra Hadiyal','Narendra Hadiyal'),
  ('Pushpendra Kumar','Pushpendra Kumar'),
  ('Vishal','Vishal Tayade'), ('VISHAL TAYDE','Vishal Tayade'), ('(JSW) Tayade Vishalkumar','Vishal Tayade'),
  ('(JSW) Pal Shiv Kumar','Shivkumar Pal'), ('Shiv Pal','Shivkumar Pal'),
  ('SHIKUMAR PAL','Shivkumar Pal'), ('Shiv','Shivkumar Pal'),
  ('Tejas','Tejas Papaiya'),
  ('NARENDRA','Narendra Hadiyal'), ('NARENDRA HARDIYAL','Narendra Hadiyal'),
  ('(JSW) Narendra Suresh Hadiyal','Narendra Hadiyal'), ('NAREDRA','Narendra Hadiyal'),
  ('RAHUL - 9327132149','Rahul Pal'), ('Rahul Pla','Rahul Pal'),
  ('Aghera Abhi','Abhishek Aghera'), ('ABHISHEK','Abhishek Aghera'),
  ('PUSHPENDRA','Pushpendra Kumar'),
  ('RAVI -6353630445','Ravi Dedania'), ('Dedania Ravi','Ravi Dedania'),
  ('LAKHAN - 7490804502','Lakhan Mali'), ('Mali Lakhan','Lakhan Mali'),
  ('Roopesh Jha','Roopesh Jha'), ('(JSW) Jha Roopesh Ghanshyam','Roopesh Jha'), ('Rupesh Jha','Roopesh Jha'),
  ('sunil nishad','Sunil Nishad'), ('(JSW) Pravesh Chitre','Pravesh Chitre'),
  ('Vijendra Rajput','Vijendra Rajput'),
  ('Nirav Tailor','Nirav Tailor'), ('(JSW) Nirav Jayeshbhai Tailor','Nirav Tailor'),
  ('Bharat Upadhyay','Bharat Upadhyay'), ('(JSW) Kundan Kumar Singh','Kundan Kumar Singh'),
  ('Karan Babariya','Karan Babariya'), ('(JSW) Babariya Karan Kanubhai','Karan Babariya'),
  ('Babariya Karan','Karan Babariya'),
  ('Chirag Raut','Chirag Raut'), ('zubin malek','Zubin Malek'),
  ('(JSW) Anand Tripathi','Anand Tripathi'),
  ('Aman Shukla','Aman Shukla'), ('(JSW) Shukla Aman Dinesh','Aman Shukla'),
  ('Bhaven Upadhyay','Bhaven Upadhyay'), ('Divanshu Dubey','Divanshu Dubey'), ('neev','Neev')
) AS v(raw, person)
JOIN LATERAL (
  SELECT m.id FROM sales_officer_master m
  WHERE so_alias_key(m.name) = so_alias_key(v.person) AND m.id NOT IN (19, 21)
  ORDER BY m.id LIMIT 1
) p ON true
WHERE so_alias_key(v.raw) IS NOT NULL
ORDER BY so_alias_key(v.raw), p.id
ON CONFLICT ("aliasKey") DO NOTHING;

-- ── 3. Short names ────────────────────────────────────────────────────────
UPDATE sales_officer_master m
SET "displayName" = v.d, "updatedAt" = now()
FROM (VALUES
  ('Abhishek Aghera','Abhishek'), ('Ajay Shah','Ajay'), ('Lakhan Mali','Lakhan'),
  ('Narendra Hadiyal','Narendra'), ('Pushpendra Kumar','Pushpendra'), ('Rahul Pal','Rahul Pal'),
  ('Ravi Dedania','Ravi Dedania'), ('Ravi Patel','Ravi Patel'), ('Shivkumar Pal','Shiv Pal'),
  ('Tejas Papaiya','Tejas'), ('Vishal Tayade','Vishal'), ('Roopesh Jha','Roopesh'),
  ('Sunil Nishad','Sunil'), ('Pravesh Chitre','Pravesh'), ('Vijendra Rajput','Vijendra'),
  ('Nirav Tailor','Nirav'), ('Bharat Upadhyay','Bharat'), ('Kundan Kumar Singh','Kundan'),
  ('Karan Babariya','Karan'), ('Chirag Raut','Chirag'), ('Zubin Malek','Zubin'),
  ('Anand Tripathi','Anand'), ('Aman Shukla','Aman'), ('Bhaven Upadhyay','Bhaven'),
  ('Divanshu Dubey','Divanshu'), ('Neev','Neev')
) AS v(full_name, d)
WHERE so_alias_key(m.name) = so_alias_key(v.full_name) AND m.id NOT IN (19, 21);

-- ── 4. Verify (read-only, last statement) ─────────────────────────────────
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
       ('#' || m.id::text || ' ' || coalesce(m.name, 'NULL'))::text AS name,
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
