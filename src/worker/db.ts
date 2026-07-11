/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CalendarEvent, Spot, SpotCategory, SystemStats } from '../types';
import { DEFAULT_HOTEL_CONFIG } from '../types';

export type HotelConfig = typeof DEFAULT_HOTEL_CONFIG;

const DEFAULT_HOTEL: HotelConfig = DEFAULT_HOTEL_CONFIG;

export async function getHotelConfig(db: D1Database): Promise<HotelConfig> {
  const row = await db.prepare('SELECT name, latitude, longitude FROM hotel WHERE id = 1').first<HotelConfig>();
  return row ?? DEFAULT_HOTEL;
}

export async function updateHotelConfig(db: D1Database, hotel: HotelConfig): Promise<void> {
  await db.prepare(
    `INSERT INTO hotel (id, name, latitude, longitude) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude`
  ).bind(hotel.name, hotel.latitude, hotel.longitude).run();
}

function rowToSpot(row: Record<string, unknown>): Spot {
  return {
    id: row.id as string,
    type: row.type as Spot['type'],
    name: JSON.parse(row.name as string),
    description: JSON.parse(row.description as string),
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    tags: JSON.parse(row.tags as string),
    image_urls: JSON.parse(row.image_urls as string),
    event_start_at: (row.event_start_at as string) ?? undefined,
    event_end_at: (row.event_end_at as string) ?? undefined,
    status: row.status as Spot['status'],
    created_at: row.created_at as string,
    google_maps_url: (row.google_maps_url as string) ?? undefined,
  };
}

export async function getSpots(db: D1Database): Promise<Spot[]> {
  const { results } = await db.prepare('SELECT * FROM spots ORDER BY created_at ASC').all();
  return (results ?? []).map((row) => rowToSpot(row as Record<string, unknown>));
}

export async function getSpotById(db: D1Database, id: string): Promise<Spot | null> {
  const row = await db.prepare('SELECT * FROM spots WHERE id = ?').bind(id).first();
  return row ? rowToSpot(row as Record<string, unknown>) : null;
}

function bindSpot(stmt: D1PreparedStatement, spot: Spot): D1PreparedStatement {
  return stmt.bind(
    spot.id, spot.type,
    JSON.stringify(spot.name), JSON.stringify(spot.description),
    spot.latitude, spot.longitude,
    JSON.stringify(spot.tags), JSON.stringify(spot.image_urls),
    spot.event_start_at ?? null, spot.event_end_at ?? null,
    spot.status, spot.created_at, spot.google_maps_url ?? null
  );
}

export async function insertSpot(db: D1Database, spot: Spot): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO spots (id, type, name, description, latitude, longitude, tags, image_urls, event_start_at, event_end_at, status, created_at, google_maps_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await bindSpot(stmt, spot).run();
}

export async function updateSpot(db: D1Database, id: string, patch: Partial<Spot>): Promise<Spot | null> {
  const existing = await getSpotById(db, id);
  if (!existing) return null;

  const merged: Spot = {
    ...existing,
    ...patch,
    latitude: patch.latitude !== undefined && !isNaN(Number(patch.latitude)) ? Number(patch.latitude) : existing.latitude,
    longitude: patch.longitude !== undefined && !isNaN(Number(patch.longitude)) ? Number(patch.longitude) : existing.longitude,
  };

  await db.prepare(
    `UPDATE spots SET type=?, name=?, description=?, latitude=?, longitude=?, tags=?, image_urls=?, event_start_at=?, event_end_at=?, status=?, google_maps_url=? WHERE id=?`
  ).bind(
    merged.type,
    JSON.stringify(merged.name), JSON.stringify(merged.description),
    merged.latitude, merged.longitude,
    JSON.stringify(merged.tags), JSON.stringify(merged.image_urls),
    merged.event_start_at ?? null, merged.event_end_at ?? null,
    merged.status, merged.google_maps_url ?? null, id
  ).run();

  return merged;
}

export async function deleteSpot(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM spots WHERE id = ?').bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getStats(db: D1Database): Promise<SystemStats> {
  const statsRow = await db.prepare('SELECT pv_count, last_updated FROM stats WHERE id = 1')
    .first<{ pv_count: number; last_updated: string }>();
  const countsRow = await db.prepare(
    `SELECT COUNT(*) as activeSpotCount, SUM(CASE WHEN type = 'event' THEN 1 ELSE 0 END) as activeEventCount
     FROM spots WHERE status = 'active'`
  ).first<{ activeSpotCount: number; activeEventCount: number }>();

  return {
    pvCount: statsRow?.pv_count ?? 0,
    activeSpotCount: countsRow?.activeSpotCount ?? 0,
    activeEventCount: countsRow?.activeEventCount ?? 0,
    lastUpdated: statsRow?.last_updated ?? new Date().toISOString(),
  };
}

export async function incrementPv(db: D1Database): Promise<number> {
  await db.prepare('UPDATE stats SET pv_count = pv_count + 1, last_updated = ? WHERE id = 1')
    .bind(new Date().toISOString()).run();
  const row = await db.prepare('SELECT pv_count FROM stats WHERE id = 1').first<{ pv_count: number }>();
  return row?.pv_count ?? 0;
}

export async function touchStatsUpdated(db: D1Database): Promise<void> {
  await db.prepare('UPDATE stats SET last_updated = ? WHERE id = 1').bind(new Date().toISOString()).run();
}

// ---- Spot categories (staff-managed, extensible; drives pin color/emoji + filter chips) ----

export async function getCategories(db: D1Database): Promise<SpotCategory[]> {
  const { results } = await db.prepare('SELECT * FROM spot_categories ORDER BY sort_order ASC').all();
  return (results ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    color: row.color as string,
    emoji: row.emoji as string,
    sortOrder: row.sort_order as number,
  }));
}

export async function categoryExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM spot_categories WHERE id = ?').bind(id).first();
  return row !== null;
}

export async function insertCategory(db: D1Database, category: SpotCategory): Promise<void> {
  await db.prepare(
    'INSERT INTO spot_categories (id, label, color, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(category.id, category.label, category.color, category.emoji, category.sortOrder, new Date().toISOString()).run();
}

export async function updateCategory(db: D1Database, id: string, patch: Partial<SpotCategory>): Promise<SpotCategory | null> {
  const existing = (await getCategories(db)).find((c) => c.id === id);
  if (!existing) return null;
  const merged: SpotCategory = { ...existing, ...patch, id };
  await db.prepare(
    'UPDATE spot_categories SET label=?, color=?, emoji=?, sort_order=? WHERE id=?'
  ).bind(merged.label, merged.color, merged.emoji, merged.sortOrder, id).run();
  return merged;
}

// Refuses to delete a category still referenced by spots, so pins never end up pointing
// at a category that no longer exists.
export async function deleteCategory(db: D1Database, id: string): Promise<'deleted' | 'not_found' | 'in_use'> {
  const inUse = await db.prepare('SELECT 1 FROM spots WHERE type = ?').bind(id).first();
  if (inUse) return 'in_use';
  const res = await db.prepare('DELETE FROM spot_categories WHERE id = ?').bind(id).run();
  return (res.meta?.changes ?? 0) > 0 ? 'deleted' : 'not_found';
}

// ---- Calendar events (auto-fetched local listings without a reliable venue location) ----

export async function getCalendarEvents(db: D1Database): Promise<CalendarEvent[]> {
  const { results } = await db.prepare('SELECT * FROM calendar_events ORDER BY published_at DESC').all();
  return (results ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    link: (row.link as string) ?? undefined,
    summary: (row.summary as string) ?? undefined,
    publishedAt: (row.published_at as string) ?? undefined,
    eventDate: (row.event_date as string) ?? undefined,
  }));
}

export async function replaceCalendarEvents(db: D1Database, events: CalendarEvent[]): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const deleteStmt = db.prepare('DELETE FROM calendar_events');
  const insertStmt = db.prepare(
    'INSERT INTO calendar_events (id, title, link, summary, published_at, event_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  await db.batch([
    deleteStmt,
    ...events.map((e) => insertStmt.bind(e.id, e.title, e.link ?? null, e.summary ?? null, e.publishedAt ?? null, e.eventDate ?? null, fetchedAt)),
  ]);
}

// ---- Admin login rate limiting (brute-force protection) ----
// Applies to both /api/login and every requireAdmin-gated endpoint, since the admin
// password is sent as a bearer-style header on every request, not just at login — an
// attacker could otherwise skip the login form entirely and guess the header directly.

export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPT_MAX = 8;

export async function countRecentFailedLogins(db: D1Database, ip: string): Promise<number> {
  const cutoff = new Date(Date.now() - LOGIN_ATTEMPT_WINDOW_MS).toISOString();
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
  ).bind(ip, cutoff).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function recordFailedLogin(db: D1Database, ip: string): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, new Date().toISOString()).run();
}

export async function clearFailedLogins(db: D1Database, ip: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}

// Keeps the table from growing unbounded; called once a day from the existing RSS cron.
export async function purgeOldLoginAttempts(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - LOGIN_ATTEMPT_WINDOW_MS).toISOString();
  await db.prepare('DELETE FROM login_attempts WHERE attempted_at <= ?').bind(cutoff).run();
}
