# 11 — Workflow: Calling List

Simple outreach tool. Upload a CSV of leads with a call date assigned to each. Daily report shows today's cards. Work them, log outcomes.

## Actors
- Admin user (uploads CSV, works the daily list, logs calls)

## Flow

```
Admin prepares CSV externally (assigns call_date to each row)
        │
        ▼
Upload CSV via admin → Calling List → Import
        │
        ▼
System parses, validates, creates calling_list_item records
        │
        ▼
Import summary: X records imported, Y errors (with detail)
        │
        ▼
Each day, admin opens Calling List → Today
        │
        ▼
Report shows today's cards (where call_date = today)
        │
        ▼
Admin works through each card:
  • Call them
  • Log outcome and notes
  • Set next action (reschedule / convert to lead / disqualify)
        │
        ▼
Cards move to completed/rescheduled/converted based on action
```

## CSV Format

Expected columns (case-insensitive header match):

| Column | Required | Notes |
|---|---|---|
| company_name | yes | Business name |
| contact_name | recommended | Person to ask for |
| contact_email | one of email/phone required | |
| contact_phone | one of email/phone required | |
| industry | optional | Free text or matches existing industry codes |
| source | optional | Where the lead came from |
| call_date | yes | YYYY-MM-DD format |
| notes | optional | Free text |

Extra columns are stored in a flexible JSON field. Missing required columns flagged in import errors.

## Import Behavior

- File size limit: configurable (default 5 MB)
- Row limit: configurable (default 5000 per import)
- Duplicate detection: by company_name + (email or phone). On duplicate, options:
  - Skip (default)
  - Update existing
  - Create anyway
- Errors don't block the import; valid rows succeed, errors reported per row
- Imported rows start in status `pending`

## Daily Report (Today's Calls)

View: list of cards where `call_date = today` and `status = pending`

Each card shows:
- Company name
- Contact name + role
- Phone (clickable on mobile / for click-to-call)
- Email (clickable)
- Industry
- Notes
- Source
- Action buttons: [Log Call] [Reschedule] [Skip] [Convert to Lead]

Sorted by: priority (if specified) → company name. Configurable.

Progress indicator at top: "X of Y calls remaining today."

## Logging a Call

Click "Log Call" → modal opens:
- Outcome: dropdown
  - No answer
  - Left voicemail
  - Spoke briefly — not interested
  - Spoke briefly — interested, follow-up needed
  - Disqualified (wrong fit, business closed, etc.)
  - Spoke — qualified, convert to lead
- Notes: free text
- Next action: dropdown
  - Done with this card (status → completed)
  - Reschedule for [date]
  - Convert to lead now
- Submit

On submit:
- `calling_log` record written
- `calling_list_item.status` updated
- If "Convert to lead": creates a `lead` record with data from the calling_list_item; sets calling_list_item.status = converted_to_lead
- If "Reschedule": call_date updated to new date, status stays pending

## Statuses

Calling list item statuses:
- `pending` — not yet called, scheduled for call_date
- `called` — called at least once, outcome logged, work continuing
- `completed` — done with this card (good or bad outcome)
- `no_answer` — tried, no contact made
- `followup` — needs another touch later (auto-rescheduled or manually)
- `disqualified` — not a fit, stop calling
- `converted_to_lead` — promoted into a lead record

## Historical View

Full list view (not just today):
- Filters: status, date range, industry, source
- Search by company name or contact
- See full call history per card (multiple calling_log records over time)
- Bulk actions: reschedule, disqualify, archive

## Lead Conversion from Calling List

When a calling_list_item converts to a lead:
- New `lead` record created with data copied from calling_list_item
- Lead status starts at `new` (or `contacted` since we just talked to them)
- Lead has note: "Converted from calling list on [date], original outcome: [...]"
- calling_list_item retained for history, status = converted_to_lead, linked to new lead

From here, the standard lead → client → opportunity flow takes over.

## Stats and Reporting

Simple stats visible on calling list dashboard:
- Cards scheduled today: X
- Cards completed today: Y
- Cards remaining: Z
- This week: total worked, conversion to lead %
- All-time: total worked, leads generated, clients converted (traceable through chain)

No deep analytics in v1.

## Out of Scope (v1)

- Auto-dialing / VoIP integration
- Call recording
- Email blast from calling list
- AI-assisted call notes (e.g., transcription) — designed for, not built
- Team assignment (each card assigned to a specific caller) — single-user assumption in v1
- SMS follow-ups from the system
