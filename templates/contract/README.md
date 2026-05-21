# templates/contract

Master Service Agreement template, rendered into a signable contract at opportunity activation.

## Files

- `master.md` — the canonical contract template. **Not yet authored.** Lawyer review required before first use.

## Format

Markdown with `{{variable}}` substitution and signature markers:

- `{{variable_name}}` — replaced with values from `contract.body_source.variables` (client info, opportunity name, setup total, monthly total, term language, etc.).
- `{{sign_here:label}}` — replaced at render time with an interactive signature component in the portal. Each instance generates a `document_signature` row when filled.
- `{{initial_here:label}}` — same, for initials.

## Rendering pipeline

1. `master.md` + variables → Markdown processor → HTML.
2. HTML token-walk replaces `{{sign_here:...}}` / `{{initial_here:...}}` markers with interactive Svelte components in the portal.
3. After signing, the HTML is frozen and rendered to PDF via Cloudflare Browser Rendering API, stored in R2 (`contract.pdf_r2_key`).

## Versioning

`contract.template_version` records which version of `master.md` was used. Bump the version (in the file's frontmatter — TBD field) any time terms change, so we can always re-render the exact document the client signed.

See `specs/07-workflow-acceptance-and-activation.md` § "Contract Generation" for the full flow.
