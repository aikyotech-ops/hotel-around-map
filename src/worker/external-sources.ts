/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auto-pickup of nearby event info that doesn't depend on a paid AI API key:
 * - Local events: RSS feeds from two Dogo Onsen-area sites (real, verified syndication feeds)
 */

import { XMLParser } from 'fast-xml-parser';
import type { CalendarEvent } from '../types';
import { replaceCalendarEvents, touchStatsUpdated } from './db';

// Verified live RSS feeds, run by two different operators, covering the Dogo Onsen area:
// - dogo.or.jp: the official area guide (tourism association), "event" category
// - dogo.jp: the Dogo Onsen Consortium, which directly operates Honkan / Asuka-no-yu /
//   Tsubaki-no-yu, so it covers bathhouse-specific notices (fee changes, closures, art
//   exhibitions) that the area guide doesn't always carry.
const EVENT_FEED_URLS = [
  'https://www.dogo.or.jp/event_news-category/event/feed/',
  'https://dogo.jp/feed/',
];

// eventDate is a calendar date with no time-of-day meaning, so it must be serialized as
// a plain YYYY-MM-DD string rather than a UTC instant (toISOString()). The Workers runtime's
// local timezone is UTC, so a UTC-midnight instant renders as the previous calendar date for
// any guest whose device timezone is behind UTC (e.g. an American or European tourist who
// hasn't changed their phone's clock) once the client formats it with toLocaleDateString.
function toDateOnlyString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Some WordPress feeds (including this one) emit numeric character references like "&#038;"
// for "&" inside <link> query strings instead of plain text, which would otherwise end up
// literally embedded in the href.
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

// Many of this feed's titles embed the actual event date in Japanese, e.g. "（6月28日）",
// which is the only reliable signal for whether the event itself is still upcoming (the
// RSS pubDate is just when the announcement was posted, often weeks/months earlier).
const JP_DATE_IN_TITLE = /(\d{1,2})月(\d{1,2})日/;

function resolveEventDate(title: string, pubDate: Date | null): Date | null {
  const match = title.match(JP_DATE_IN_TITLE);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const baseYear = (pubDate ?? new Date()).getFullYear();
  let candidate = new Date(baseYear, month - 1, day);

  // If the parsed date is more than ~2 months before the post date, it's almost certainly
  // referring to next year (e.g. a December post announcing a January event).
  if (pubDate && candidate.getTime() < pubDate.getTime() - 60 * 24 * 60 * 60 * 1000) {
    candidate = new Date(baseYear + 1, month - 1, day);
  }
  return candidate;
}

interface ParsedRssItem {
  title: string;
  link: string;
  summary: string;
  pubDate: Date | null;
  eventDate: Date | null;
  isUpcoming: boolean;
}

// The event-listing pages on dogo.or.jp (post_type=event) render the actual event date
// in a "開催期間" (or 開催日/期間) info-table row, e.g.:
//   <th>開催期間</th><td>2026年7月25日（土）</td>
// unlike the RSS titles, which in practice rarely embed the date. Fetching the linked page
// is the only reliable way to get the real date for these.
const TABLE_DATE_ROW = /<th[^>]*>\s*(?:開催期間|開催日|期間)\s*<\/th>\s*<td[^>]*>([\s\S]{0,120}?)<\/td>/;
// WordPress generates the <meta description> from the same info table, so it's a safe
// fallback when the table markup itself isn't found (e.g. a template change).
const META_DESCRIPTION = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/;
const JP_DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;

async function fetchEventDateFromPage(link: string): Promise<Date | null> {
  if (!link) return null;
  try {
    const res = await fetch(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HotelConciergeBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Scoped to the info-table's own value cell (or the meta description generated from
    // it) rather than searching the whole page, so an unrelated date elsewhere on the
    // page (e.g. a "related events" block) can't be picked up by mistake. This also
    // avoids stripping/scanning the entire HTML document just to find one short date.
    const tableRow = html.match(TABLE_DATE_ROW);
    const metaDesc = html.match(META_DESCRIPTION);
    const dateText = tableRow ? stripHtml(tableRow[1]) : metaDesc ? metaDesc[1] : null;
    const match = dateText?.match(JP_DATE);
    if (!match) return null;

    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    console.error('[external-refresh] failed to fetch event date page:', link, e);
    return null;
  }
}

async function fetchSingleRssFeed(feedUrl: string): Promise<ParsedRssItem[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HotelConciergeBot/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`RSS feed fetch failed (${feedUrl}) with status ${res.status}`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentCutoff = today.getTime() - 21 * 24 * 60 * 60 * 1000; // 3-week grace window

  const parsedItems = items.map((item: Record<string, unknown>) => {
    const title = decodeHtmlEntities(stripHtml(String(item.title ?? ''))) || '道後温泉エリアのイベント';
    const link = decodeHtmlEntities(String(item.link ?? '').trim());
    const summary = decodeHtmlEntities(stripHtml(String(item.description ?? ''))).slice(0, 200);
    const pubDateRaw = item.pubDate ? new Date(String(item.pubDate)) : null;
    const pubDate = pubDateRaw && !isNaN(pubDateRaw.getTime()) ? pubDateRaw : null;
    return { title, link, summary, pubDate, eventDate: resolveEventDate(title, pubDate) };
  });

  return Promise.all(parsedItems.map(async (item): Promise<ParsedRssItem> => {
    // The title-embedded date (if any) is trusted first; only fall back to scraping the
    // linked page when the title itself didn't carry a date.
    const eventDate = item.eventDate ?? await fetchEventDateFromPage(item.link);
    return {
      ...item,
      eventDate,
      // If neither the title nor the linked page had a date, fall back to how recently
      // the item was announced as a proxy for whether the event is still relevant.
      isUpcoming: eventDate ? eventDate.getTime() >= today.getTime() : !item.pubDate || item.pubDate.getTime() >= recentCutoff,
    };
  }));
}

// Returned as calendar listings (title/date/link only) rather than map-pinned spots, because
// these RSS feeds don't include reliable per-event venue coordinates. Guessing/anchoring a
// location for these previously caused event pins to show up at the wrong place on the map.
export async function fetchEventsFromRss(feedUrls: string[] = EVENT_FEED_URLS): Promise<CalendarEvent[]> {
  const results = await Promise.allSettled(feedUrls.map(fetchSingleRssFeed));

  const seenTitles = new Set<string>();
  const merged: ParsedRssItem[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.error('[external-refresh] RSS feed failed:', result.reason);
      continue;
    }
    for (const item of result.value) {
      if (seenTitles.has(item.title)) continue; // dedupe events reported by both feeds
      seenTitles.add(item.title);
      merged.push(item);
    }
  }

  if (merged.length === 0 && results.every((r) => r.status === 'rejected')) {
    throw new Error('All event RSS feeds failed: ' + results.map((r) => (r as PromiseRejectedResult).reason?.message || String((r as PromiseRejectedResult).reason)).join(' | '));
  }

  return merged
    .filter((e) => e.isUpcoming)
    .sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0))
    .slice(0, 10)
    .map((e, index): CalendarEvent => ({
      id: `calendar-event-${index}`,
      title: e.title,
      link: e.link || undefined,
      summary: e.summary || undefined,
      publishedAt: e.pubDate ? e.pubDate.toISOString() : undefined,
      eventDate: e.eventDate ? toDateOnlyString(e.eventDate) : undefined,
    }));
}

export interface ExternalRefreshResult {
  eventCount: number;
  eventError?: string;
}

export async function runExternalRefresh(db: D1Database): Promise<ExternalRefreshResult> {
  const result: ExternalRefreshResult = { eventCount: 0 };
  try {
    const calendarEvents = await fetchEventsFromRss();
    await replaceCalendarEvents(db, calendarEvents);
    result.eventCount = calendarEvents.length;
  } catch (e: any) {
    console.error('[external-refresh] RSS fetch failed:', e);
    result.eventError = e?.message || String(e);
  }
  await touchStatsUpdated(db);
  return result;
}
