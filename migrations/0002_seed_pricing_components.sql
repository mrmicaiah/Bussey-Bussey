-- Migration 0002 — seed pricing_components from /data/pricing-components.csv
--
-- Idempotent: `INSERT OR IGNORE` keys on `code` (the natural PK), so re-running
-- this migration is a no-op for codes already present. To intentionally update
-- an existing component's rate, edit it in admin or write a targeted migration —
-- this seed never overwrites.
--
-- Row count: 25 (verified against data/pricing-components.csv).
-- `created_at` falls back to the schema default.

INSERT OR IGNORE INTO pricing_components (code, name, category, unit_type, unit_price, description, active) VALUES
  ('standard_table',           'Standard Table',              'table',        'per_item_setup', 350,  'Basic CRUD entity: fields, list view, detail view, simple relationships. ~2-4 hours.', 1),
  ('complex_table',             'Complex Table',               'table',        'per_item_setup', 850,  'Entity with status workflows, multiple relationships, validation logic, business rules. ~6-10 hours.', 1),
  ('user_role',                 'User Role',                   'role',         'per_item_setup', 300,  'Role definition with permission scoping and access rules. ~2-3 hours per role.', 1),
  ('simple_workflow',           'Simple Workflow',             'workflow',     'per_item_setup', 300,  'Single-trigger automation (e.g., notification on status change). ~2-3 hours.', 1),
  ('complex_workflow',          'Complex Workflow',            'workflow',     'per_item_setup', 700,  'Multi-step automation with branching, scheduling, or escalation logic. ~6-8 hours.', 1),
  ('standard_integration',      'Standard Integration',        'integration',  'per_item_setup', 1500, 'Well-documented API, single-direction sync (e.g., Stripe, QuickBooks read, email service). ~8-15 hours.', 1),
  ('complex_integration',       'Complex Integration',         'integration',  'per_item_setup', 3500, 'Bidirectional, custom auth, or legacy API integration (e.g., HHAeXchange, EVV systems). ~20-40 hours.', 1),
  ('ai_document_intelligence',  'AI Document Intelligence',    'ai',           'per_item_setup', 2200, 'Parse structured data from uploaded documents (credentials, IDs, licenses). ~12-20 hours.', 1),
  ('ai_smart_matching',         'AI Smart Matching',           'ai',           'per_item_setup', 2800, 'AI-driven recommendations or anomaly detection (caregiver matching, alert systems). ~15-25 hours.', 1),
  ('ai_conversational',         'AI Conversational Interface', 'ai',           'per_item_setup', 3500, 'Claude-powered chat interface for end users with structured tool calls. ~20-30 hours.', 1),
  ('standard_dashboard',        'Standard Dashboard',          'dashboard',    'per_item_setup', 600,  'KPI cards, charts, filtered list views. ~4-6 hours.', 1),
  ('complex_dashboard',         'Complex Dashboard',           'dashboard',    'per_item_setup', 1100, 'Multi-source data with drill-downs, exports, complex filtering. ~8-12 hours.', 1),
  ('scheduled_report',          'Scheduled Report',            'dashboard',    'per_item_setup', 500,  'Auto-generated PDF or email report on a cadence. ~3-5 hours.', 1),
  ('project_setup',             'Project Setup',               'setup',        'flat_setup',     2500, 'Kickoff, environment provisioning, initial documentation, deployment pipeline. Flat per project.', 1),
  ('migration_simple',          'Simple Data Migration',       'setup',        'flat_setup',     1000, 'Clean CSV import with field mapping. Flat fee.', 1),
  ('migration_complex',         'Complex Data Migration',      'setup',        'flat_setup',     3500, 'Extract from existing system, clean, transform, validate. Flat fee.', 1),
  ('training_session',          'Training Session',            'setup',        'per_item_setup', 500,  'Live training session with prep, delivery, and recording. ~2-3 hours each.', 1),
  ('platform_base_small',       'Platform Base (Small)',       'subscription', 'flat_monthly',   500,  'Monthly platform fee for agencies under 50 caregivers/users. Includes hosting, support, ongoing maintenance.', 1),
  ('platform_base_medium',      'Platform Base (Medium)',      'subscription', 'flat_monthly',   1000, 'Monthly platform fee for agencies 50-150 caregivers. Includes hosting, support, ongoing maintenance.', 1),
  ('platform_base_large',       'Platform Base (Large)',       'subscription', 'flat_monthly',   1800, 'Monthly platform fee for agencies 150-500 caregivers. Includes hosting, support, ongoing maintenance.', 1),
  ('platform_base_enterprise',  'Platform Base (Enterprise)',  'subscription', 'flat_monthly',   3000, 'Monthly platform fee for agencies 500+ caregivers. Includes hosting, support, dedicated attention. Custom pricing above base.', 1),
  ('ai_usage_basic',            'AI Usage Tier (Basic)',       'subscription', 'flat_monthly',   150,  'Monthly AI/API usage allowance for light document processing and basic conversational features.', 1),
  ('ai_usage_heavy',            'AI Usage Tier (Heavy)',       'subscription', 'flat_monthly',   400,  'Monthly AI/API usage allowance for high-volume document intelligence and frequent AI feature use.', 1),
  ('premium_support',           'Premium Support Tier',        'subscription', 'flat_monthly',   500,  'Priority response times, dedicated support hours, monthly office hours.', 1),
  ('custom_line_item',          'Custom Line Item',            'custom',       'per_item_setup', 0,    'Free-form line item. Name and price set per use.', 1);
