-- The public README badge feature is removed: the SVG endpoints, the generator page and the
-- reach panel on /usage are all gone, so the tally table they fed has no reader and no writer
-- left. Dropped rather than orphaned — a table nothing writes is a table whose numbers silently
-- go stale while still looking live to anyone who opens the database.
DROP TABLE IF EXISTS "BadgeImpression";
