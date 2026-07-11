-- The RSS pubDate is when the announcement was posted, not when the event actually
-- happens. external-sources.ts already parses the real event date out of the title
-- (e.g. "（6月28日）") but had nowhere to store it, so the UI was showing the post
-- date for every event instead of the date it's actually held on.
ALTER TABLE calendar_events ADD COLUMN event_date TEXT;
