/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { MultiLangString, Spot, SpotCategory } from '../types';
import type { Bindings } from './bindings';
import {
  categoryExists,
  clearFailedLogins,
  countRecentFailedLogins,
  deleteCategory,
  deleteSpot,
  getCalendarEvents,
  getCategories,
  getHotelConfig,
  getSpots,
  getStats,
  incrementPv,
  insertCategory,
  insertSpot,
  LOGIN_ATTEMPT_MAX,
  purgeOldLoginAttempts,
  recordFailedLogin,
  updateCategory,
  updateHotelConfig,
  updateSpot,
  type HotelConfig,
} from './db';
import { runExternalRefresh } from './external-sources';
import { geocodeAddress } from './geocode';

const app = new Hono<{ Bindings: Bindings }>();

// Security headers on every response. X-Frame-Options blocks the admin login screen from
// being embedded in a hidden iframe elsewhere (clickjacking); nosniff stops browsers from
// MIME-sniffing an uploaded file into something executable.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// ---- Admin authentication ----
// The CMS sends the admin password in this header on every data-changing request.
// The password itself lives in the ADMIN_PASSWORD secret (never in the repo):
//   - local dev:  .dev.vars (gitignored)
//   - production: `wrangler secret put ADMIN_PASSWORD`
// If the secret is missing we fail closed (503) rather than fall back to a default.
const ADMIN_TOKEN_HEADER = 'x-admin-token';

// Cloudflare sets this on every request; it can't be spoofed by the client (Cloudflare
// overwrites any client-supplied value at the edge before the request reaches the Worker).
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') || 'unknown';
}

// Rate-limit checks are best-effort: if migration 0007 (login_attempts table) hasn't been
// applied yet, fail OPEN (don't block legitimate admin usage over a missing audit table) but
// log it so the gap is visible.
async function isRateLimited(db: D1Database, ip: string): Promise<boolean> {
  try {
    return (await countRecentFailedLogins(db, ip)) >= LOGIN_ATTEMPT_MAX;
  } catch (e) {
    console.error('[rate-limit] check failed, allowing request:', e);
    return false;
  }
}

async function noteFailedLogin(db: D1Database, ip: string): Promise<void> {
  try {
    await recordFailedLogin(db, ip);
  } catch (e) {
    console.error('[rate-limit] failed to record attempt:', e);
  }
}

// Constant-time string comparison so the password can't be guessed byte-by-byte
// from response timing differences.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const configured = c.env.ADMIN_PASSWORD;
  if (!configured) {
    return c.json({ error: '管理パスワードが未設定です。管理者に ADMIN_PASSWORD の設定を依頼してください。' }, 503);
  }
  const ip = getClientIp(c);
  if (await isRateLimited(c.env.DB, ip)) {
    return c.json({ error: '認証の試行回数が多すぎます。15分ほど待ってから再度お試しください。' }, 429);
  }
  const provided = c.req.header(ADMIN_TOKEN_HEADER);
  if (!provided || !safeEqual(provided, configured)) {
    await noteFailedLogin(c.env.DB, ip);
    return c.json({ error: '認証に失敗しました。再度ログインしてください。' }, 401);
  }
  await next();
};

app.post('/api/login', async (c) => {
  const configured = c.env.ADMIN_PASSWORD;
  if (!configured) {
    return c.json({ error: '管理パスワードが未設定です。管理者に ADMIN_PASSWORD の設定を依頼してください。' }, 503);
  }
  const ip = getClientIp(c);
  if (await isRateLimited(c.env.DB, ip)) {
    return c.json({ error: '認証の試行回数が多すぎます。15分ほど待ってから再度お試しください。' }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const password = (body as { password?: unknown }).password;
  if (typeof password !== 'string' || !safeEqual(password, configured)) {
    await noteFailedLogin(c.env.DB, ip);
    return c.json({ error: 'パスワードが正しくありません。' }, 401);
  }
  try { await clearFailedLogins(c.env.DB, ip); } catch (e) { console.error('[rate-limit] failed to clear attempts:', e); }
  return c.json({ success: true });
});

// ---- Input validation helpers ----

function parseCoord(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// Only allow real web links; blocks javascript: and other executable URL schemes.
function asSafeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function sanitizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (u): u is string => typeof u === 'string' && (u.startsWith('/uploads/') || /^https?:\/\//i.test(u))
  );
}

const LANG_KEYS = ['ja', 'en', 'zh_cn', 'zh_tw', 'ko'] as const;

function sanitizeMultiLang(value: unknown): MultiLangString {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const out = {} as MultiLangString;
  for (const key of LANG_KEYS) {
    out[key] = typeof src[key] === 'string' ? (src[key] as string) : '';
  }
  return out;
}

// Colors are interpolated into a raw `style="background-color: ..."` HTML string on the
// client (map pins), so only a strict hex format is accepted — anything else could break
// out of the attribute. Emoji are similarly interpolated into raw pin HTML, so length-cap
// them and reject HTML-special characters.
function sanitizeHexColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function sanitizeEmoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 8 || /[<>&"']/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

function sanitizeDateString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

// ---- Hotel configuration ----
app.get('/api/hotel', async (c) => {
  const hotel = await getHotelConfig(c.env.DB);
  return c.json(hotel);
});

app.post('/api/hotel', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name } = body as { name?: unknown };
  const latitude = parseCoord((body as { latitude?: unknown }).latitude, -90, 90);
  const longitude = parseCoord((body as { longitude?: unknown }).longitude, -180, 180);
  if (typeof name !== 'string' || name.trim() === '' || latitude === null || longitude === null) {
    return c.json({ error: 'Invalid hotel data' }, 400);
  }
  const updated: HotelConfig = { name: name.trim(), latitude, longitude };
  await updateHotelConfig(c.env.DB, updated);
  return c.json(updated);
});

// ---- Address geocoding (free, Japan-only, no API key; CMS-only so kept behind auth) ----
app.get('/api/geocode', requireAdmin, async (c) => {
  const address = c.req.query('q');
  if (!address || address.trim() === '') {
    return c.json({ error: 'q (address) parameter is required' }, 400);
  }
  try {
    const results = await geocodeAddress(address.trim());
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: '住所検索に失敗しました', details: e?.message || String(e) }, 500);
  }
});

// ---- Local event calendar (auto-fetched, no reliable venue coordinates) ----
app.get('/api/events', async (c) => {
  return c.json(await getCalendarEvents(c.env.DB));
});

// ---- Spot categories (staff-managed, extensible; drives pin color/emoji + filter chips) ----
app.get('/api/categories', async (c) => {
  return c.json(await getCategories(c.env.DB));
});

app.post('/api/categories', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const b = body as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  const color = sanitizeHexColor(b.color);
  const emoji = sanitizeEmoji(b.emoji);
  if (!label || !color || !emoji) {
    return c.json({ error: 'カテゴリ名・色・絵文字はすべて必須です' }, 400);
  }
  const existingCount = (await getCategories(c.env.DB)).length;
  const newCategory: SpotCategory = { id: 'cat-' + Date.now(), label, color, emoji, sortOrder: existingCount };
  await insertCategory(c.env.DB, newCategory);
  return c.json(newCategory, 201);
});

app.put('/api/categories/:id', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const b = body as Record<string, unknown>;
  const patch: Partial<SpotCategory> = {};
  if (typeof b.label === 'string' && b.label.trim()) patch.label = b.label.trim();
  const color = sanitizeHexColor(b.color);
  if (color) patch.color = color;
  const emoji = sanitizeEmoji(b.emoji);
  if (emoji) patch.emoji = emoji;
  const updated = await updateCategory(c.env.DB, c.req.param('id'), patch);
  if (!updated) return c.json({ error: 'Category not found' }, 404);
  return c.json(updated);
});

app.delete('/api/categories/:id', requireAdmin, async (c) => {
  const result = await deleteCategory(c.env.DB, c.req.param('id'));
  if (result === 'not_found') return c.json({ error: 'Category not found' }, 404);
  if (result === 'in_use') return c.json({ error: 'このカテゴリを使用しているスポットがあるため削除できません。先にスポットの種類を変更してください。' }, 409);
  return c.json({ success: true });
});

// ---- Spots CRUD ----
app.get('/api/spots', async (c) => {
  return c.json(await getSpots(c.env.DB));
});

app.post('/api/spots', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = sanitizeMultiLang((body as { name?: unknown }).name);
  const latitude = parseCoord((body as { latitude?: unknown }).latitude, -90, 90);
  const longitude = parseCoord((body as { longitude?: unknown }).longitude, -180, 180);
  const b = body as Record<string, unknown>;
  const type = typeof b.type === 'string' ? b.type : '';

  if (!name.ja.trim() || latitude === null || longitude === null) {
    return c.json({ error: 'Spot Japanese name, latitude, and longitude are required (coordinates must be valid numbers)' }, 400);
  }
  if (!type || !(await categoryExists(c.env.DB, type))) {
    return c.json({ error: '有効な種類（カテゴリ）を選択してください' }, 400);
  }

  const newSpot: Spot = {
    id: 'spot-' + Date.now(),
    type,
    name,
    description: sanitizeMultiLang(b.description),
    latitude,
    longitude,
    tags: sanitizeTags(b.tags),
    image_urls: sanitizeImageUrls(b.image_urls),
    event_start_at: sanitizeDateString(b.event_start_at),
    event_end_at: sanitizeDateString(b.event_end_at),
    status: b.status === 'inactive' ? 'inactive' : 'active',
    created_at: new Date().toISOString(),
    google_maps_url: asSafeHttpUrl(b.google_maps_url),
  };

  await insertSpot(c.env.DB, newSpot);
  return c.json(newSpot, 201);
});

// Only copy validated, known fields out of the request body into the update patch.
async function sanitizeSpotPatch(db: D1Database, body: Record<string, unknown>): Promise<Partial<Spot>> {
  const patch: Partial<Spot> = {};
  if (typeof body.type === 'string' && (await categoryExists(db, body.type))) patch.type = body.type;
  if ('name' in body) patch.name = sanitizeMultiLang(body.name);
  if ('description' in body) patch.description = sanitizeMultiLang(body.description);
  const latitude = parseCoord(body.latitude, -90, 90);
  if (latitude !== null) patch.latitude = latitude;
  const longitude = parseCoord(body.longitude, -180, 180);
  if (longitude !== null) patch.longitude = longitude;
  if ('tags' in body) patch.tags = sanitizeTags(body.tags);
  if ('image_urls' in body) patch.image_urls = sanitizeImageUrls(body.image_urls);
  if ('event_start_at' in body) patch.event_start_at = sanitizeDateString(body.event_start_at);
  if ('event_end_at' in body) patch.event_end_at = sanitizeDateString(body.event_end_at);
  if ('status' in body) patch.status = body.status === 'inactive' ? 'inactive' : 'active';
  if ('google_maps_url' in body) patch.google_maps_url = asSafeHttpUrl(body.google_maps_url);
  return patch;
}

app.put('/api/spots/:id', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const b = body as Record<string, unknown>;
  // Reject an explicitly-submitted but invalid/deleted category outright, rather than
  // silently dropping it from the patch and leaving the spot on its old (possibly
  // now-deleted) category with no error shown to staff.
  if ('type' in b && (typeof b.type !== 'string' || !(await categoryExists(c.env.DB, b.type)))) {
    return c.json({ error: '有効な種類（カテゴリ）を選択してください' }, 400);
  }
  const patch = await sanitizeSpotPatch(c.env.DB, b);
  if (patch.name && !patch.name.ja.trim()) {
    return c.json({ error: 'Spot Japanese name is required' }, 400);
  }
  const updated = await updateSpot(c.env.DB, c.req.param('id'), patch);
  if (!updated) return c.json({ error: 'Spot not found' }, 404);
  return c.json(updated);
});

app.delete('/api/spots/:id', requireAdmin, async (c) => {
  const ok = await deleteSpot(c.env.DB, c.req.param('id'));
  if (!ok) return c.json({ error: 'Spot not found' }, 404);
  return c.json({ success: true, message: 'Deleted successfully' });
});

// ---- Stats ----
app.get('/api/stats', async (c) => {
  return c.json(await getStats(c.env.DB));
});

app.post('/api/stats/pv', async (c) => {
  const pvCount = await incrementPv(c.env.DB);
  return c.json({ success: true, pvCount });
});

// ---- Image upload (Cloudflare Workers KV) ----
app.post('/api/upload', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];

  if (!(file instanceof File)) {
    return c.json({ error: '画像ファイルが見つかりません' }, 400);
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    return c.json({ error: '対応していない画像形式です（JPEG/PNG/WEBP/GIFのみ）' }, 400);
  }
  if (file.size > 15 * 1024 * 1024) {
    return c.json({ error: 'ファイルサイズは15MBまでです' }, 400);
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const key = `spot-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    metadata: { contentType: file.type },
  });

  return c.json({ url: `/uploads/${key}` });
});

app.get('/uploads/:key', async (c) => {
  const result = await c.env.IMAGES.getWithMetadata(c.req.param('key'), 'arrayBuffer');
  if (!result.value) return c.notFound();
  const metadataType = (result.metadata as { contentType?: string } | null)?.contentType;
  // Only ever serve image content types from this endpoint, whatever was stored.
  const contentType = metadataType && /^image\//.test(metadataType) ? metadataType : 'application/octet-stream';
  return new Response(result.value, {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// ---- Auto-pickup of nearby event info without an AI API key (Dogo Onsen-area RSS feeds) ----
app.post('/api/spots/external-refresh', requireAdmin, async (c) => {
  try {
    const result = await runExternalRefresh(c.env.DB);
    return c.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[CONCIERGE SERVER] External refresh failed:', e);
    return c.json({ error: '周辺イベント情報の自動取得に失敗しました', details: e?.message || String(e) }, 500);
  }
});

export default {
  fetch: app.fetch,
  // Daily Cron Trigger (see wrangler.jsonc) keeps the local event calendar fresh automatically,
  // and piggybacks the login_attempts table cleanup so it never grows unbounded.
  async scheduled(_controller: ScheduledController, env: Bindings) {
    await runExternalRefresh(env.DB);
    try { await purgeOldLoginAttempts(env.DB); } catch (e) { console.error('[rate-limit] cleanup failed:', e); }
  },
} satisfies ExportedHandler<Bindings>;
