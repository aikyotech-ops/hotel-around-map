-- "Staff pick" vs "external" spot source distinction is removed: every spot was always
-- created as 'hotel_master' (there was no UI to set it otherwise, and no auto-pickup ever
-- created spots), so the column only ever held one value and the badge it drove is gone.
ALTER TABLE spots DROP COLUMN source;
