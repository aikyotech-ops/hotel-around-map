-- Brute-force protection for the admin password: every failed /api/login or requireAdmin
-- check is recorded per source IP, so repeated guessing can be rate-limited even though the
-- password itself has no expiry (see safeEqual/requireAdmin in worker/index.ts).
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);
