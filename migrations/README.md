# migrations

D1 schema migrations.

**Status:** empty. The first migration (`0001_initial_schema.sql`) will be generated from `specs/02-data-model.md` once that spec is approved as final — it is not generated yet by design (scaffolding-first review pass).

## Conventions

- Filenames: `NNNN_descriptive_name.sql` (e.g., `0001_initial_schema.sql`, `0002_add_totp_to_admin_user.sql`).
- Numbering is monotonic across the project; no gaps, no reuse.
- Each migration is idempotent where possible (use `IF NOT EXISTS` / `IF EXISTS`).
- One logical concern per migration. Splitting a big schema change across files is fine if it improves reviewability.

## Applying

From the worker workspace (`worker/`):

```sh
# Local D1 (used by `wrangler dev`)
wrangler d1 migrations apply bussey-bussey --local

# Remote D1 (production)
wrangler d1 migrations apply bussey-bussey --remote
```

The `migrations_dir` setting in `worker/wrangler.toml` points back here (`../migrations`).
