-- Spot "type" becomes a staff-managed, extensible list of categories (each with its own
-- color + emoji) instead of a fixed restaurant/event/sightseeing enum, so a hotel can add
-- categories beyond the original three. Map pins and the guest-facing filter chips both
-- read color/emoji from this table, so they can never drift out of sync with each other.
CREATE TABLE IF NOT EXISTS spot_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Seed the three categories every existing spot already uses, with the same colors the
-- app used to hardcode, so existing data keeps rendering identically after this migration.
INSERT INTO spot_categories (id, label, color, emoji, sort_order, created_at) VALUES
  ('restaurant', 'グルメ', '#10b981', '🍴', 0, '2026-07-09T00:00:00.000Z'),
  ('event', 'イベント', '#f43f5e', '🎉', 1, '2026-07-09T00:00:00.000Z'),
  ('sightseeing', '観光スポット', '#a855f7', '📍', 2, '2026-07-09T00:00:00.000Z');
