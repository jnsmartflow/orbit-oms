# code-discovery-2026-10-10-so-alias-proposal.md
# Sales officer alias PREFILL proposal — for owner review. Status: PROPOSAL, nothing written.
# Source: read-only queries against live, 2026-10-10 06:41 UTC. Keys from the LIVE so_alias_key() (v27.62).

## What was read
- **Free-text SO sources** (the only two that exist — SAP import and `orders` carry no SO name):
  - `mo_orders.soName` — 16090 mail orders.
  - `delivery_point_contacts.name` where the contact role is "Sales Officer" — 1265 contacts (the challan cascade's step c).
- **103 distinct raw spellings** → **60 keys** (0 dropped as NULL/empty; 1 junk key `null` — a contact literally named "NULL" — skipped).
- **Bills** = not-removed orders (all time, 18052 bills) the Floor SO rule would name with that spelling: divisions 74/77 → the ship-to's first SO contact, only when it has no PRIMARY master link; every other bill → its SO number's NEWEST mail order.
- **Matched against** `sales_officer_master` minus #19 "TEST — Smart Flow" and #21 "NULL". `sales_officer_aliases` holds **0** rows today.

## Totals
| Group | Keys | Bills covered |
|---|---|---|
| exact (auto, Part A) | 11 | 3124 |
| check (you confirm, Part B) | 20 | 586 |
| new person (no master row, Part C) | 25 | 9221 |
| telecaller mailbox (code rule, no alias) | 3 | 709 |
| **all** | **59** | **13640** |

## Matching rules
- **exact** — key = so_alias_key(master.name), exactly one master.
- **check** — one master is CLOSE: one-letter typo (OSA distance 1, so a swap of two letters counts), words swapped, same letters reordered, initial / first name / short form, or a longer form of the name. More than one master close → **AMBIGUOUS**, no person proposed.
- **new person** — nothing close. "Maybe same as" flags two new keys that look like one person.
- A spelling with a 10-digit number gives the **suggested phone**.

## The proposal
| key | example raw spellings | proposed person | confidence | bills | suggested phone | why / note |
|---|---|---|---|---|---|---|
| `vishal` | Vishal · VISHAL · VISHAL - 8000094440 | #16 Vishal Tayade | check | 224 | 8000094440 | first name / short form only; seen 2026-03-26 → 2026-05-25 |
| `palshivkumar` | (JSW) Pal Shiv Kumar · (JSW) Pal Shiv Kumar  > · Pal Shiv Kumar - 8488843430 · Pal Shiv Kumar | #10 Shivkumar Pal | check | 123 | 8488843430 | same letters, reordered; seen 2026-04-13 → 2026-10-08 |
| `shivpal` | Shiv Pal · SHIV PAL · SHIV PAL - 8488843430 · Shiv pal · +1 more | #10 Shivkumar Pal | check | 58 | 8488843430 | initial or short form; seen 2026-03-26 → 2026-09-18 |
| `tejas` | Tejas · TEJAS | #15 Tejas Papaiya | check | 45 |  | first name / short form only; seen 2026-03-26 → 2026-06-20 |
| `narendra` | NARENDRA · Narendra · NARENDRA - 8866667582 · NARENDRA - 9099646041 | #17 Narendra Hadiyal | check | 43 | 8866667582 | first name / short form only; seen 2026-03-26 → 2026-07-17 |
| `narendrahardiyal` | NARENDRA HARDIYAL | #17 Narendra Hadiyal | check | 18 |  | one-letter typo; seen 2026-04-29 → 2026-04-29 |
| `narendrasureshhadiyal` | (JSW) Narendra Suresh Hadiyal | #17 Narendra Hadiyal | check | 18 |  | longer form of the name; seen 2026-04-22 → 2026-10-07 |
| `rahul` | RAHUL - 9327132149 · RAHUL - 9537974869 · Rahul - 9327132149 · Rahul | #12 Rahul Pal | check | 15 | 9327132149 | first name / short form only; seen 2026-04-23 → 2026-06-13 |
| `agheraabhi` | Aghera Abhi | #18 Abhishek Aghera | check | 12 |  | initial or short form; seen 2026-07-18 → 2026-10-07 |
| `shikumarpal` | SHIKUMAR PAL | #10 Shivkumar Pal | check | 9 |  | one-letter typo; seen 2026-05-14 → 2026-05-25 |
| `shiv` | Shiv | #10 Shivkumar Pal | check | 6 |  | first name / short form only; seen 2026-06-06 → 2026-09-21 |
| `pushpendra` | PUSHPENDRA · Pushpendra | #20 Pushpendra Kumar | check | 4 |  | first name / short form only; seen 2026-07-30 → 2026-08-27 |
| `abhishek` | ABHISHEK | #18 Abhishek Aghera | check | 3 |  | first name / short form only; seen 2026-08-06 → 2026-09-02 |
| `ravi` | RAVI -6353630445 · RAVI - 6353630445 | #11 Ravi Patel (first name / short form only); #13 Ravi Dedania (first name / short form only) | check | 3 | 6353630445 | AMBIGUOUS — more than one master fits; pick one or none; seen 2026-05-04 → 2026-05-05 |
| `lakhan` | LAKHAN - 7490804502 | #14 Lakhan Mali | check | 2 | 7490804502 | first name / short form only; seen 2026-04-30 → 2026-04-30 |
| `rahulpla` | Rahul Pla | #12 Rahul Pal | check | 2 |  | one-letter typo; seen 2026-06-12 → 2026-06-12 |
| `vishaltayde` | VISHAL TAYDE | #16 Vishal Tayade | check | 1 |  | one-letter typo; seen 2026-07-31 → 2026-07-31 |
| `dedaniaravi` | Dedania Ravi | #13 Ravi Dedania | check | 0 |  | words swapped; seen 2026-03-26 → 2026-03-26 |
| `malilakhan` | Mali Lakhan | #14 Lakhan Mali | check | 0 |  | words swapped; seen 2026-04-18 → 2026-04-18 |
| `tayadevishalkumar` | (JSW) Tayade Vishalkumar | #16 Vishal Tayade | check | 0 |  | longer form of the name; seen 2026-05-29 → 2026-05-29 |
| `jharoopeshghanshyam` | (JSW) Jha Roopesh Ghanshyam | NEW: Jha Roopesh Ghanshyam | new person | 1916 |  | no master row fits; may be the same person as rupeshjha — confirm before creating two; seen 2026-04-13 → 2026-10-09 |
| `sunilnishad` | sunil nishad | NEW: Sunil Nishad | new person | 1669 |  | no master row fits; seen 2026-04-13 → 2026-10-09 |
| `praveshchitre` | (JSW) Pravesh Chitre | NEW: Pravesh Chitre | new person | 1194 |  | no master row fits; seen 2026-04-13 → 2026-10-09 |
| `vijendrarajput` | Vijendra Rajput | NEW: Vijendra Rajput | new person | 1169 |  | no master row fits; seen 2026-04-12 → 2026-10-09 |
| `niravjayeshbhaitailor` | (JSW) Nirav Jayeshbhai Tailor | NEW: Nirav Jayeshbhai Tailor | new person | 960 |  | no master row fits; seen 2026-04-13 → 2026-10-09 |
| `bharatupadhyay` | Bharat Upadhyay | NEW: Bharat Upadhyay | new person | 796 |  | no master row fits; seen 2026-04-13 → 2026-10-09 |
| `kundankumarsingh` | (JSW) Kundan Kumar Singh | NEW: Kundan Kumar Singh | new person | 618 |  | no master row fits; seen 2026-04-13 → 2026-10-09 |
| `babariyakarankanubhai` | (JSW) Babariya Karan Kanubhai | NEW: Babariya Karan Kanubhai | new person | 249 |  | no master row fits; maybe same as babariyakaran (longer form of the name); seen 2026-04-13 → 2026-10-09 |
| `babariyakaran` | Babariya Karan | NEW: Babariya Karan | new person | 228 |  | no master row fits; maybe same as babariyakarankanubhai (initial or short form); seen 2026-07-07 → 2026-10-09 |
| `rupeshjha` | Rupesh Jha | NEW: Rupesh Jha | new person | 156 |  | no master row fits; may be the same person as jharoopeshghanshyam (Roopesh / Rupesh Jha) — confirm before creating two; seen 2026-04-14 → 2026-09-26 |
| `chiragraut` | Chirag Raut | NEW: Chirag Raut | new person | 114 |  | no master row fits; seen 2026-05-15 → 2026-09-30 |
| `zubinmalek` | zubin malek | NEW: Zubin Malek | new person | 35 |  | no master row fits; seen 2026-06-24 → 2026-10-06 |
| `anandtripathi` | (JSW) Anand Tripathi · Anand Tripathi | NEW: Anand Tripathi | new person | 33 |  | no master row fits; seen 2026-09-01 → 2026-10-09 |
| `shuklaamandinesh` | (JSW) Shukla Aman Dinesh | NEW: Shukla Aman Dinesh | new person | 32 |  | no master row fits; seen 2026-08-05 → 2026-10-09 |
| `bhavenupadhyay` | Bhaven Upadhyay | NEW: Bhaven Upadhyay | new person | 27 |  | no master row fits; seen 2026-09-19 → 2026-10-09 |
| `naredra` | NAREDRA | NEW: Naredra | new person | 15 |  | no master row fits; probably a typo of NARENDRA — see the narendra check rows; seen 2026-06-19 → 2026-06-29 |
| `divanshudubey` | Divanshu Dubey | NEW: Divanshu Dubey | new person | 5 |  | no master row fits; seen 2026-06-25 → 2026-07-06 |
| `neev` | neev | NEW: Neev | new person | 3 |  | no master row fits; seen 2026-10-03 → 2026-10-03 |
| `dhanrajshah` | Dhanraj Shah | NEW: Dhanraj Shah | new person | 1 |  | no master row fits; Dhanraj Shah is an Orbit staff user (dispatcher) — probably not an SO; seen 2026-07-13 → 2026-07-13 |
| `suratproject` | Surat Project | NEW: Surat Project | new person | 1 |  | no master row fits; looks like a depot/project mailbox, not a person; seen 2026-05-25 → 2026-08-27 |
| `barotdilipranaji` | (JSW) Barot Dilip Ranaji | NEW: Barot Dilip Ranaji | new person | 0 |  | no master row fits; seen 2026-06-08 → 2026-09-29 |
| `chitrakshbajaj` | (JSW) Chitraksh Bajaj | NEW: Chitraksh Bajaj | new person | 0 |  | no master row fits; seen 2026-04-18 → 2026-04-21 |
| `harshpatel` | Harsh Patel | NEW: Harsh Patel | new person | 0 |  | no master row fits; seen 2026-04-15 → 2026-10-01 |
| `jayminshah` | (JSW) Jaymin Shah | NEW: Jaymin Shah | new person | 0 |  | no master row fits; seen 2026-04-15 → 2026-07-06 |
| `shubhampatil` | Shubham Patil | NEW: Shubham Patil | new person | 0 |  | no master row fits; seen 2026-05-07 → 2026-05-07 |
| `ravipatel` | Ravi Patel · (JSW) Ravi Patel · Ravi Patel | #11 Ravi Patel | exact | 2408 |  | key = so_alias_key(master.name); seen 2026-04-13 → 2026-10-09 |
| `rahulpal` | Rahul Pal · (JSW) Rahul Pal · Rahulpal · RAHUL PAL · +5 more | #12 Rahul Pal | exact | 210 | 9714487000 | key = so_alias_key(master.name); seen 2026-03-26 → 2026-10-09 |
| `lakhanmali` | Lakhan Mali · LAKHAN MALI · Lakhan mali · LAKHAN MALI - 7490804502 · +2 more | #14 Lakhan Mali | exact | 197 | 7490804502 | key = so_alias_key(master.name); seen 2026-03-26 → 2026-10-10 |
| `shivkumarpal` | Shivkumar Pal · SHIVKUMAR PAL · SHIVKUMAR  PAL | #10 Shivkumar Pal | exact | 99 |  | key = so_alias_key(master.name); seen 2026-04-18 → 2026-10-10 |
| `vishaltayade` | Vishal Tayade · VISHAL TAYADE | #16 Vishal Tayade | exact | 64 |  | key = so_alias_key(master.name); seen 2026-04-19 → 2026-10-09 |
| `tejaspapaiya` | Tejas Papaiya · TEJAS PAPAIYA | #15 Tejas Papaiya | exact | 61 |  | key = so_alias_key(master.name); seen 2026-03-26 → 2026-10-07 |
| `ravidedania` | Ravi Dedania · RAVI DEDANIA · Ravi dedania · RAVI DEDANIA - 6353630445 | #13 Ravi Dedania | exact | 57 | 6353630445 | key = so_alias_key(master.name); seen 2026-03-26 → 2026-10-10 |
| `ajayshah` | Ajay Shah · AJAY SHAH | #9 Ajay Shah | exact | 28 |  | key = so_alias_key(master.name); seen 2026-03-26 → 2026-05-25 |
| `abhishekaghera` | Abhishek Aghera | #18 Abhishek Aghera | exact | 0 |  | key = so_alias_key(master.name); seen 2026-08-08 → 2026-10-05 |
| `narendrahadiyal` | Narendra Hadiyal | #17 Narendra Hadiyal | exact | 0 |  | key = so_alias_key(master.name); seen 2026-08-10 → 2026-10-07 |
| `pushpendrakumar` | Pushpendra Kumar | #20 Pushpendra Kumar | exact | 0 |  | key = so_alias_key(master.name); seen 2026-10-05 → 2026-10-05 |
| `suratakzonobel` | Surat Akzonobel | — | telecaller | 579 |  | depot mailbox — shown as Telecaller by code; seen 2026-05-09 → 2026-10-09 |
| `suratdepot` | Surat Depot · (JSW) Surat Depot | — | telecaller | 72 |  | depot mailbox — shown as Telecaller by code; seen 2026-04-13 → 2026-10-08 |
| `suratorder` | Surat Order | — | telecaller | 58 |  | depot mailbox — shown as Telecaller by code; seen 2026-04-16 → 2026-10-06 |

Skipped: `null` (NULL, 0 bills).

## Next
Run `sql/2026-10-10-so-alias-prefill.sql` Part A as is; uncomment the Part B / Part C lines you confirm; run the verify SELECT at the foot.
