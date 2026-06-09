# Skill — Lead sourcing (calling-list CSV producer)

**Purpose:** Given an industry category and a geographic area, produce a CSV of business
candidates ready to import into Studio44's calling-list as `calling_list_item` rows.

**Who runs this today:** the Claude Code worker, dispatched by the operator (Micaiah) or
the manager chat. Later: Alice, autonomously, when she's wired at Layer 4.

**What this skill does NOT do:** import the CSV into Studio44. The operator imports manually
via `/admin/calling-list/import` until the bulk-import endpoint is built. This skill stops at
"clean CSV on disk."

---

## 1. The end-to-end shape

```
Operator says:           "I want to call <category> in <geography>, ~<N> leads"
                                       ↓
Skill plans:             clarifying constraints, prepares a Places search strategy
                                       ↓
Skill executes:          places_search (multiple queries to broaden coverage)
                                       ↓
Skill filters:           drop too-large, no-phone, wrong-practice, duplicates
                                       ↓
Skill enriches (light):  light web reads for partner names / decision-maker IF time allows
                                       ↓
Skill formats:           CSV in Studio44's exact calling-list import shape
                                       ↓
Skill writes file:       save to ./generated/calling-list/<batch-name>.csv
                                       ↓
Skill reports:           summary stats + spot-check rows + the file path
                                       ↓
Operator imports:        manual upload at /admin/calling-list/import?mode=skip
```

---

## 2. Inputs the skill needs from the operator

Before running, the skill needs five things. If any are missing, ASK before doing work.

1. **Industry/category** — natural-language description. Examples: "small law firms",
   "HVAC contractors", "independent dental practices", "boutique marketing agencies".
2. **Geographic area** — specific metro or region. Examples: "Austin TX metro",
   "DC metro region", "Tampa Bay area".
3. **Target row count** — how many candidates. Default 100 if not specified.
4. **Practice-area or sub-category bias** (optional) — e.g. for law firms: "estate planning,
   immigration, family law; AVOID criminal defense and personal injury." If not specified,
   the skill chooses sensible defaults for the industry and tells the operator what it
   picked.
5. **Batch identifier** — a short stable string used as the `source` column on every row and
   as part of the filename. Default format: `<tool>_<area>_<category>_<YYYY_MM>` →
   `places_austin_law_2026_06`. The operator can override.

When ambiguity remains, ASK before searching. Bad inputs produce bad lists.

---

## 3. Output file specification

### 3.1 File location and name

- Directory: `./generated/calling-list/` (create if missing).
- Filename: `<batch-id>_<YYYY-MM-DD>.csv` — e.g.
  `places_austin_law_2026_06_2026-06-09.csv`.

### 3.2 CSV format — EXACT, validated against the calling-list import

This format was verified by code inspection of
`worker/src/routes/admin/calling-list.ts` and `worker/src/services/csv.ts`. Deviations
will cause silent row rejections or import failure.

**Header (exact order, exact lowercase spelling):**

```
company_name,contact_name,contact_email,contact_phone,industry,source,call_date,notes
```

**Per-column rules:**

| Column | Required | Format | Notes |
|---|---|---|---|
| `company_name` | YES | non-empty after trim | preserve original capitalization exactly — never normalize case |
| `contact_name` | optional | free text | full name; leave blank if not reasonably findable, do not guess |
| `contact_email` | conditional | free text, no email-format validation | at least ONE of email/phone must be present per row |
| `contact_phone` | conditional | `(XXX) XXX-XXXX` — area code in parens, single space, three-dash-four | at least ONE of email/phone required; phone is strongly preferred for cold calling |
| `industry` | optional but recommended | exact stable string per batch | reuse the same string verbatim across batches (e.g. always "Legal Services") |
| `source` | optional but recommended | the batch identifier | e.g. `places_austin_law_2026_06` |
| `call_date` | YES | `YYYY-MM-DD` per row | the date the card surfaces in the calling queue; use today unless operator says otherwise |
| `notes` | optional | single line, max 200 chars | NO newlines, NO unescaped quotes, NO carriage returns; aim for a concrete one-liner where research surfaces something |

### 3.3 CSV mechanics (the parser is unforgiving on a few points)

- Header row is mandatory.
- Every row must have exactly the same column count as the header. Mismatch = row
  rejected by the import.
- Quote any field containing a comma using double-quotes, e.g.
  `"estate planning, immigration, 4 attorneys"`.
- Doubled-quote a literal quote inside a quoted field (`""`). Better: just don't use
  literal quotes inside notes — strip them out at generation time.
- **No embedded newlines anywhere.** Every row is exactly one physical line. The parser
  doesn't support multi-line quoted fields.
- Whitespace inside values is preserved (only header lowercasing happens). Don't pad with
  extra spaces.
- Body must be <5MB and <5000 data rows. A 100-row CSV is comfortably within limits.

### 3.4 Industry string discipline

The `industry` column is free text on the database, but the calling-list list view filters
by exact string equality. Pick ONE canonical string per industry and use it identically on
every row, every batch.

Established canonical strings (extend as needed, document below in §6):

| Industry | Canonical string |
|---|---|
| Small law firms | `Legal Services` |
| HVAC / plumbing / electrical | `Trades — HVAC/Plumbing/Electrical` |
| Independent medical/dental | `Healthcare — Independent Practice` |
| Independent CPA / bookkeeping | `Accounting & Bookkeeping` |

If introducing a new industry not in this table, ADD it to the table in this skill file
before running, so future batches stay consistent.

### 3.5 Phone format discipline

Exact-match dedupe means phone format must be byte-identical across batches.

**Canonical format:** `(XXX) XXX-XXXX` (e.g. `(512) 555-1234`).

- Area code in parens, no leading 1.
- Single ASCII space after the closing paren.
- Three digits, ASCII hyphen, four digits.
- No extensions. If Places returns `+15125551234 ext 102`, write `(512) 555-1234` and
  put the ext info in notes if relevant.

Normalize from any input format. If a phone can't be confidently normalized to this shape,
exclude the row.

---

## 4. Execution steps

### Step 1 — Confirm inputs

Re-read the five inputs from §2. If any are missing or ambiguous, ASK before searching.
A wasted Places search isn't free.

### Step 2 — Plan search queries

A single `places_search` call returns up to 10 results. To get N candidates with quality
diversity, plan **multiple queries** covering the geographic area and the practice-area
sub-categories. Examples for "100 small law firms in Austin metro":

```
- "small law firms Austin TX"
- "estate planning attorneys Austin TX"
- "immigration lawyers Austin TX"
- "family law attorneys Austin TX"
- "small business lawyers Austin TX"
- "real estate attorneys Austin TX"
- "tax attorneys Austin TX"
- "small law firms Round Rock TX"
- "estate planning attorneys Cedar Park TX"
- "immigration lawyers Georgetown TX"
```

Spreading across sub-areas and sub-categories avoids returning the same 10 dominant firms
on every query. The `places_search` tool supports `queries: [{query, max_results}]` — pass
all queries in ONE multi-query call (it dedupes automatically across queries).

For each query, request `max_results: 10` (the maximum). Plan enough queries to expect
roughly 2x the target after dedupe — so for 100 leads, aim for 200 raw results.

### Step 3 — Execute `places_search` once with the full query plan

One tool call with the full `queries[]` array. The tool dedupes by `place_id` across
queries. Don't fire queries one at a time.

### Step 4 — Filter to candidates that meet our quality bar

Per result, KEEP only if all of:

- Has a phone number (Places returns these reliably for businesses).
- Name doesn't match a known large/national firm. Maintain an exclusion list (see §6).
  Example for legal: Baker Botts, DLA Piper, K&L Gates, Norton Rose Fulbright, Akin Gump,
  Locke Lord, Jackson Walker, Greenberg Traurig, Holland & Knight, Bracewell.
- The Places business `type` is plausibly in the target category. For law: `lawyer`,
  `legal_services`, `law_firm` all good; `library` no.
- Not a chain franchise of an explicitly excluded sub-practice (per operator's brief).
  E.g. for the legal example: avoid firms whose Places category is clearly
  `personal_injury_attorney` or `criminal_justice_attorney`.

DROP if any are true:

- No phone number.
- Permanently closed (Places signals `business_status: CLOSED_PERMANENTLY`).
- Name suggests big-firm branch (use the exclusion list).
- Practice area conflicts with operator's brief.

### Step 5 — Light enrichment for `contact_name` (optional, time-permitting)

For each kept row, OPTIONAL light web fetch of the firm's website to find a principal
attorney's name from the About/Team page. Stop quickly per firm — don't deep-research.
If a name isn't surfaced in the first reasonable read, leave `contact_name` blank.

This step is OPTIONAL because it's slow. For a 100-row batch, skip it on the first pass
and let the operator/Alice add names later if useful. For a 10-20 row pilot, including it
makes the cards meaningfully better.

### Step 6 — Generate concise notes per row

The `notes` field is most useful when it captures something concrete a salesperson would
want to know before dialing. For each row, write a single line that tries to convey:

- Practice focus (1-3 areas) — from Places business categories or website-skim
- Size hint if available — "boutique", "solo", "small partnership" — but only if confident
- Optional distinguishing detail — "bilingual ES", "downtown location", "20+ years"

NEVER write:

- Generic praise ("highly respected", "trusted local firm")
- Filler when nothing is known — leave blank instead
- Multi-line content — must be ONE physical line
- Literal quotes inside the cell — strip them out

Examples of good notes:

- `estate planning + small business, 4 attorneys, downtown Austin`
- `immigration practice, solo, bilingual ES, 15+ years`
- `family law boutique, Cedar Park, 3 attorneys`

Examples of bad notes (don't do):

- `Highly respected and trusted firm with excellent service` — generic, no concrete info
- `Estate planning firm with several attorneys serving the Austin area` — verbose, vague
- An empty string is BETTER than fluff. Leave blank if research truly surfaces nothing.

### Step 7 — Final dedupe within the batch

Before writing the CSV, dedupe ROWS within the result set:

- By exact `company_name` (case-sensitive, byte-identical)
- By exact `contact_phone` (canonical format)

The import has dedupe against existing DB rows, but it doesn't check intra-CSV duplicates
robustly. Don't ship dupes within the file.

### Step 8 — Validate before writing

For each row, check:

- `company_name` non-empty
- `contact_phone` matches `^\(\d{3}\) \d{3}-\d{4}$`
- `call_date` matches `^\d{4}-\d{2}-\d{2}$`
- `notes` is one line, no quotes, no commas (or properly quoted), ≤200 chars
- All 8 columns present per row

Drop any row that fails. Report the count of dropped rows in the summary.

### Step 9 — Write the CSV

Save to `./generated/calling-list/<batch-id>_<YYYY-MM-DD>.csv`. UTF-8, LF newlines, no BOM.

### Step 10 — Report summary

Output a structured summary to the user:

```
Lead sourcing complete.

Batch: <batch-id>
File: <full path>
Industry: <canonical industry string>
Geography: <area description>
Search queries issued: <N>
Raw Places results: <N>
After filtering: <N>
After dedupe: <N>
Validation drops: <N>
Final row count: <N>

Spot-check (first 3 rows):
  1. <company_name> | <contact_phone> | <notes>
  2. <company_name> | <contact_phone> | <notes>
  3. <company_name> | <contact_phone> | <notes>

Industry-string used: "<exact string>"
Phone format: (XXX) XXX-XXXX
Source tag: <batch-id>

To import: upload at /admin/calling-list/import with mode=skip.
```

---

## 5. Failure modes and how to handle them

### Not enough Places results

If the multi-query plan returns fewer than the target row count after filtering:

1. First, widen sub-category queries within the same metro.
2. Then widen the geographic ring (add adjacent towns/suburbs).
3. Report the gap honestly: "asked for 100, got 73 after filtering" — better to ship fewer
   real ones than pad to 100 with garbage.

NEVER fabricate rows to reach a target count.

### A query returns no results

The geography or sub-category combo may be wrong. Log the empty query but continue with
others. Report empty queries in the summary so the operator can adjust the next batch.

### Places returns a result with no phone

Drop it — calling cards without phones are useless. Report the count of dropped-for-no-phone
rows in the summary.

### Unsure if a firm is a big-firm branch

If unsure, KEEP it but flag in notes: `verify-not-bigfirm`. The operator can spot-check.
Better to keep and flag than drop and miss.

### A row's phone is in an unusual format

Try to normalize:
- `512.555.1234` → `(512) 555-1234`
- `+15125551234` → `(512) 555-1234`
- `5125551234` → `(512) 555-1234`
- `(512)555-1234` (no space) → `(512) 555-1234`
- `512-555-1234` → `(512) 555-1234`

If genuinely can't be confidently normalized (e.g. extension included or non-US format),
drop the row.

---

## 6. Maintenance — update this section as needed

### Industry canonical strings

| Industry | Canonical string |
|---|---|
| Small law firms | `Legal Services` |
| HVAC / plumbing / electrical contractors | `Trades — HVAC/Plumbing/Electrical` |
| Independent medical/dental practices | `Healthcare — Independent Practice` |
| Independent CPA / bookkeeping | `Accounting & Bookkeeping` |

### Big-firm exclusion list (legal)

Skip Austin metro branches of:
Baker Botts, DLA Piper, K&L Gates, Norton Rose Fulbright, Akin Gump, Locke Lord,
Jackson Walker, Greenberg Traurig, Holland & Knight, Bracewell, Vinson & Elkins,
Fish & Richardson, Jones Day, Sidley Austin, Latham & Watkins, Kirkland & Ellis,
Skadden, Weil Gotshal, Wilson Sonsini.

Extend this list when new big-firm branches show up in Places results.

### Big-firm exclusion list (other industries)

Build per-industry as the skill is run against new categories.

---

## 7. Future migration to Alice (Layer 4)

When Alice is wired:

- This same skill applies, with these adaptations:
  - Output target changes from `./generated/calling-list/<file>.csv` to a JSON payload
    POSTed to a future `POST /api/admin/calling-list/import` endpoint (or whatever shape
    the bulk-import endpoint takes when built).
  - The "ASK before searching" prompts in §2 become Alice's conversational clarifying
    questions instead of skill-side blocks.
  - The "report summary" in §10 becomes Alice's natural-language summary back to the
    operator.

The CORE LOGIC (search, filter, dedupe, validate, the canonical format rules) is unchanged.
This skill is durable; only the input/output adapters swap.

---

## 8. Quick-reference checklist for the running session

Before declaring complete:

- [ ] All 5 inputs confirmed (§2)
- [ ] Multi-query `places_search` issued (§3)
- [ ] Filtering done per §4 — Step 4
- [ ] Notes written per §4 — Step 6 (no generic praise; blank if nothing concrete)
- [ ] Intra-batch dedupe done (§4 — Step 7)
- [ ] Validation pass done (§4 — Step 8)
- [ ] File written to correct path (§4 — Step 9)
- [ ] Summary reported with spot-check (§4 — Step 10)
