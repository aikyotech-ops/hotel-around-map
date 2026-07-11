/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CalendarEvent } from './types';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Shared by GuestView and CmsView so the calendar-event date fallback (prefer the real
// event date, fall back to the RSS post date) can't drift between the two screens.
// eventDate is a plain YYYY-MM-DD string and must be parsed via local Date components
// (not `new Date(string)`, which parses date-only strings as UTC midnight and can shift
// the displayed date by a day depending on the viewer's timezone); publishedAt is a real
// timestamp and safe to parse normally.
export function formatCalendarEventDate(ev: CalendarEvent, locale: string): string {
  const raw = ev.eventDate ?? ev.publishedAt;
  if (!raw) return '';
  const dateOnly = raw.match(DATE_ONLY);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale);
}
