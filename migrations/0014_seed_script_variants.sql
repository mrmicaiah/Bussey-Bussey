-- Migration 0014 — seed starter script_variant rows (Studio44 Layer 1, §4.4)
--
-- The four placeholder framework lines from the approved prototype, one per stage,
-- author_kind = 'seed'. Grounded in master §9 (cold-calling best practices:
-- pattern-interrupt opener, pain-tied hook, open-ended discovery, two-times close;
-- "book, don't pitch").
--
-- Idempotent: `INSERT OR IGNORE` keys on the fixed string `id` (the PK), so
-- re-running this migration is a no-op for rows already present — same approach as
-- 0002_seed_pricing_components.sql. These seed ids are intentionally human-readable
-- and stable. To change a seed line's wording later, edit it in admin or write a
-- targeted migration — this seed never overwrites. `created_at` falls back to the
-- schema default; author_user_id and industry are left NULL.

INSERT OR IGNORE INTO script_variant (id, stage, body, author_kind, label, industry, is_active) VALUES
  ('seed_opener_27s',            'opener',    'Hi [name], I''ll be straight with you — this is a cold call. Give me 27 seconds to tell you why I rang, and if it''s not for you, you can hang up on me. Fair?',                                                              'seed', '27 seconds opener',        NULL, 1),
  ('seed_hook_hours_lost',       'hook',      'Most [industry] owners I talk to are quietly losing 10 to 15 hours a week to scheduling, compliance paperwork, and chasing people down. We build the system that takes that off your plate. Is that anywhere close to your week?', 'seed', 'Hours-lost hook',          NULL, 1),
  ('seed_discovery_open_qualify', 'discovery', 'Walk me through it — when something falls through the cracks today, where does it usually happen? Who''s handling that right now, and how are they doing it?',                                                          'seed', 'Open-qualify discovery',   NULL, 1),
  ('seed_close_two_times',       'close',     'Here''s what I''d suggest: a short, no-charge assessment where we map exactly where your time is going — no pitch, just a clear picture. I''ve got Tuesday at 10 or Thursday at 2. Which one''s easier for you?',          'seed', 'Two-times close',          NULL, 1);
