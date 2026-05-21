# templates/email

Transactional email templates.

## Files

- _(none yet — templates land as workflows are implemented)_

Planned templates (see `specs/12-architecture-backend.md` § "Email"):

- `new_lead.md` — new lead notification to admin
- `walkthrough_complete.md` — activation complete (client + admin)
- `change_order_proposed.md` — change order ready for review (client)
- `change_order_approved.md` — change order approved confirmation (client + admin)
- `payment_succeeded.md` — monthly payment receipt (client)
- `payment_failed.md` — payment failure with action needed (client + admin)
- `activation_credentials.md` — portal credentials handoff (client, sent when admin chooses Email option)
- `project_status_update.md` — optional status update (client)

## Format

Same convention as the contract template: Markdown with `{{variable}}` substitution. Rendered to HTML + plain-text at send time. The chosen provider (Resend) ingests the rendered HTML; we keep the plain-text fallback inline.

Every send is recorded in the `notification` table.
