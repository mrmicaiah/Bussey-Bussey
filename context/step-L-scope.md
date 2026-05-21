# Step L — Calling List

Per spec 11. Simple outreach tool: CSV import → daily call cards → 
log outcomes → optional conversion to lead. No frills.

## Subtasks

### 1. CSV import (/admin/calling-list/import)

- Drag-and-drop or file picker for CSV upload
- File size limit 5 MB, row limit 5000 (configurable but defaulted)
- Backend validates: required columns (company_name + call_date + 
  one of email/phone), parses each row, creates calling_list_item 
  records
- Duplicate detection: by company_name + (email OR phone). On 
  duplicate, default behavior is skip; expose options in the UI 
  for "Skip / Update existing / Create anyway"
- Errors don't block the import — valid rows succeed, errors 
  reported per-row in a summary view
- Imported rows start in status='pending'
- Extra columns stored in calling_list_item.extra_fields (JSON)

### 2. Today view (/admin/calling-list/today)

The daily working surface:
- List of cards where call_date = today and status='pending'
- Sorted by priority then company_name (configurable, but ship with 
  this default)
- Progress indicator at top: "X of Y calls remaining today"
- Each card shows: company_name, contact_name, phone (click-to-call 
  link via tel:), email (mailto:), industry, source, notes
- Action buttons per card: [Log Call] [Reschedule] [Skip] [Convert 
  to Lead]

### 3. Log call modal

Click "Log Call" → modal opens:
- Outcome dropdown:
  - No answer
  - Left voicemail
  - Spoke briefly — not interested
  - Spoke briefly — interested, follow-up needed
  - Disqualified (wrong fit, business closed, etc.)
  - Spoke — qualified, convert to lead
- Notes (free text)
- Next action dropdown:
  - Done with this card → status='completed'
  - Reschedule for [date picker]
  - Convert to lead now
- Submit

On submit:
- calling_log row written (calling_list_item_id, called_at, 
  outcome, notes, next_action_date)
- calling_list_item.status updated based on outcome + next action
- If "Convert to lead now": creates lead row with data from 
  calling_list_item, sets calling_list_item.status='converted_to_lead'
- If reschedule: call_date updated, status stays pending
- audit cascade pattern

### 4. Historical list view (/admin/calling-list)

Full list, not just today:
- Filters: status, date range, industry, source
- Search by company name or contact
- Each card shows full call history (calling_log rows joined) with 
  expandable detail
- Bulk actions: reschedule, disqualify, archive (status='archived' 
  or similar — soft delete)

### 5. Lead conversion path

When calling_list_item converts to lead:
- New lead row created with source='calling_list'
- Status starts at 'contacted' (we just talked to them, even if 
  briefly)
- Lead.notes prefilled: "Converted from calling list on [date], 
  outcome: [outcome from calling_log]"
- calling_list_item.status='converted_to_lead'
- calling_list_item retains its row + history; linked via 
  calling_list_item.converted_to_lead_id (soft FK like the change 
  request pattern)
- audit cascade: lead.create.from_calling_list + 
  calling_list_item.converted

### 6. Stats and reporting

Lightweight stats on the calling list dashboard:
- Cards scheduled today: X
- Cards completed today: Y
- Cards remaining today: Z
- This week: total worked, conversion to lead %
- All-time: total worked, leads generated, clients converted 
  (traceable through lead → client chain)

Simple SELECT COUNT queries; no analytics infrastructure.

### 7. Schema (migration 0008)

- calling_list_item table: per spec 11 with the additional 
  extra_fields JSON column and converted_to_lead_id soft FK
- calling_log table: per spec 11
- Document both in migration comment

### 8. Smoke test

End-to-end:
1. Upload a CSV with 10 rows including 2 duplicates against 
   existing leads in D1 — verify duplicate detection logic, valid 
   rows imported, errors reported per-row
2. Visit Today view — verify cards filtered to today's call_date 
   correctly, sorted as expected
3. Log a call with outcome 'no answer' → verify calling_log row, 
   status='no_answer' (or whatever maps), card stays in today 
   view  
4. Log a call with outcome 'qualified, convert to lead' → verify 
   lead row created with source='calling_list', calling_list_item 
   status flipped, converted_to_lead_id set, audit cascade
5. Reschedule a card for next week → verify call_date updated, 
   card disappears from today view, appears in historical view 
   for that date
6. Test filters on historical view — by status, by date range, 
   by industry
7. Test bulk reschedule on 3 cards
8. Verify stats dashboard reflects all the activity
9. Plaintext password leak check: 0 (CSV import flow — uploaded 
   files can contain anything, so this matters)
10. audit_log clean across all operations

## Out of Scope for L
- Auto-dialer / VoIP
- Call recording / transcription  
- Team assignment per card (single-user assumption holds)
- SMS follow-ups from the system
- Email blasts to calling list
- AI-assisted notes / scoring (deferred for future Claude integration)

## Constraints
- All CSV uploads sanitized — never trust user-uploaded content
- Plaintext password leak check applied to uploaded data (CSVs can 
  contain credentials that shouldn't end up in audit_log)
- Lead conversion path mirrors the patterns from chat-sourced leads 
  (same structure, same status transitions)
- audit cascade pattern on every state change
