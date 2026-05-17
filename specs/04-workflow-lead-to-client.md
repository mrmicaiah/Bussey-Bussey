# 04 — Workflow: Lead to Client Conversion

A lead becomes a client when you've qualified them and a real opportunity exists. Conversion is an explicit admin action.

## Actors
- Admin user (you or team)

## When to Convert

Convert when:
- You've spoken to them or otherwise confirmed they're a real, interested prospect
- You have enough business info to start scoping work
- You're ready to create at least one opportunity for them

Don't convert prematurely. Leads can sit in qualified status indefinitely.

## Flow

```
Admin opens lead record
        │
        ▼
Reviews chat transcript / notes / contact info
        │
        ▼
Clicks "Convert to Client"
        │
        ▼
Form appears with prefilled fields from lead:
  • Company name
  • Primary contact name
  • Primary contact email
  • Primary contact phone
  • Industry
  • Billing address (blank, admin fills)
  • Notes (carried over from lead)
        │
        ▼
Admin reviews/edits, clicks "Create Client"
        │
        ▼
System creates client record. Sets client.origin_lead_id = lead.id.
System updates lead.status = converted. Lead is preserved as historical record.
        │
        ▼
Admin lands on new client page. Prompt: "Create first opportunity?"
```

## Form Fields (Conversion)

Required:
- Company name
- Primary contact name
- Primary contact email (or phone if no email)

Optional but recommended:
- Phone
- Industry (dropdown: home_health / landscape / other — extensible)
- Billing address
- Notes

## Manual Client Creation

Admin can also create a client directly (no originating lead) — for referrals, in-person meetings, or other entry paths. Same form, `origin_lead_id` null.

## Client Detail View (After Creation)

Shows:
- Header: company name, status, primary contact
- Tabs or sections:
  - **Overview**: contact info, industry, notes, key dates
  - **Opportunities**: list of all opportunities (with "New Opportunity" button)
  - **Documents**: signed contracts, change orders (once activated)
  - **Payments**: setup invoices, subscription status (once activated)
  - **Activity Log**: status changes, notes added, opportunities created, etc.
  - **Notes**: append-only notes with timestamps

## Status Transitions

Client statuses:
- `prospect` — created but no active opportunity yet, or all opportunities still open
- `active` — has at least one accepted opportunity with a live subscription
- `paused` — was active, subscription paused (manual or due to billing issue)
- `former` — was active, no longer working with Bussey

Status transitions are mostly automatic based on opportunity and subscription states, but admin can manually override.

## Out of Scope (v1)

- Multiple contacts per client (only primary in v1; can add structured contacts table later)
- Client tagging / segmentation
- Bulk client import
- Merging duplicate clients
