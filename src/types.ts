/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LanguageCode = 'ja' | 'en';

// Staff-managed, extensible spot category (replaces the old fixed restaurant/event/
// sightseeing enum). Map pins and the guest-facing filter chips both read color/emoji
// from here, so a pin's color always matches the chip that filters it.
export interface SpotCategory {
  id: string;
  label: string;
  color: string; // hex color, e.g. "#10b981" — applied via inline style since it's runtime data
  emoji: string;
  sortOrder: number;
}

// Curated palettes staff pick from when creating/editing a category (kept small and
// deliberately curated rather than a free-form color/emoji picker).
export const CATEGORY_COLOR_PALETTE = [
  '#10b981', '#f43f5e', '#a855f7', '#3b82f6', '#f59e0b',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#6366f1',
];

export const CATEGORY_EMOJI_PALETTE = [
  '🍴', '🍜', '🍣', '🍺', '☕', '🍰', '🎉', '🎆', '🎭', '⛩️',
  '🏯', '🌸', '♨️', '🗾', '🏖️', '🚶', '🛍️', '📷', '🎨', '📍',
];

export interface MultiLangString {
  ja: string;
  en: string;
}

export interface Spot {
  id: string;
  type: string; // references SpotCategory.id
  name: MultiLangString;
  description: MultiLangString;
  latitude: number;
  longitude: number;
  tags: string[]; // e.g., ['#スタッフ厳選', '#ご当地グルメ']
  image_urls: string[];
  // For events
  event_start_at?: string; // ISO string or YYYY-MM-DD
  event_end_at?: string;   // ISO string or YYYY-MM-DD
  status: 'active' | 'inactive';
  created_at: string;

  // Google Maps URL to open in external maps
  google_maps_url?: string;
}

// Single source of truth for the initial hotel: the worker uses it as the DB fallback and
// the client uses it as the placeholder until /api/hotel responds. Previously this was
// duplicated in three files, which risked them drifting apart when the hotel changes.
export interface HotelConfigData {
  name: string;
  latitude: number;
  longitude: number;
}

export const DEFAULT_HOTEL_CONFIG: HotelConfigData = {
  name: 'ラ・ロンコントル',
  latitude: 33.833395132000696,
  longitude: 132.76678651517162,
};

export interface SystemStats {
  pvCount: number;
  activeSpotCount: number;
  activeEventCount: number;
  lastUpdated: string;
}

// Auto-fetched local event listing (e.g. from an RSS feed) that doesn't have a reliable
// venue location, so it's shown in a calendar list instead of being pinned on the map.
export interface CalendarEvent {
  id: string;
  title: string;
  link?: string;
  summary?: string;
  publishedAt?: string;
  // When the event itself is actually held, parsed from the source title or the linked
  // page. Stored as a plain "YYYY-MM-DD" date (no time/timezone component) so it renders
  // the same calendar date for every viewer regardless of their device's timezone. Falls
  // back to publishedAt in the UI when neither source had a parseable date.
  eventDate?: string;
}

export const TAG_OPTIONS = [
  '#すべて',
  '#スタッフ厳選',
  '#ご当地グルメ',
  '#ランチ',
  '#ディナー',
  '#居酒屋',
  '#本日開催イベント',
  '#子連れ歓迎',
  '#徒歩5分以内'
];

export const TAG_LABEL_TRANSLATIONS: Record<string, Record<LanguageCode, string>> = {
  '#すべて': { ja: 'すべて', en: 'All' },
  '#スタッフ厳選': { ja: 'ホテル厳選', en: 'Hotel Pick' },
  '#ご当地グルメ': { ja: 'ご当地グルメ', en: 'Local Food' },
  '#ランチ': { ja: 'ランチ', en: 'Lunch' },
  '#ディナー': { ja: 'ディナー', en: 'Dinner' },
  '#居酒屋': { ja: '居酒屋', en: 'Izakaya' },
  '#本日開催イベント': { ja: '本日開催！', en: 'Happening Today!' },
  '#子連れ歓迎': { ja: '子連れ歓迎', en: 'Family Friendly' },
  '#徒歩5分以内': { ja: '徒歩5分以内', en: 'Within 5 min walk' },
};

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  ja: '日本語',
  en: 'English'
};

export const UI_TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  ja: {
    appTitle: 'ホテル周辺デジタルコンシェルジュ',
    backToMap: '地図へ戻る',
    categoryAll: 'すべて',
    routeGuidance: 'Google マップでルート案内',
    statusTodayEvent: '本日開催！',
    filterTitle: 'タグで絞り込む',
    cmsTitle: 'ホテル周辺 CMSポータル',
    gpsTrackingActive: 'GPS連動中',
    gpsTrackingInactive: '現在地を表示',
    gpsSimulateWalking: '疑似移動シミュレーション',
    noSpotsFound: '該当するスポットが見つかりません。別のタグをお試しください。',
    aboutApp: 'QRコード読取だけでログイン不要、旅をもっと快適に。',
    guestView: 'ゲスト用画面へ戻る',
    openInGoogleMaps: 'Googleマップで開く',
    selectLanguage: '言語を選択',
    eventCalendarButton: '周辺イベント情報',
    eventCalendarTitle: '周辺イベントカレンダー',
    eventCalendarSubtitle: '道後温泉公式エリアガイドの最新情報です。会場の正確な位置は各リンク先でご確認ください。',
    eventCalendarViewDetails: '詳細を見る',
    eventCalendarEmpty: '現在、取得できているイベント情報はありません。'
  },
  en: {
    appTitle: 'Hotel Neighborhood Digital Concierge',
    backToMap: 'Back to Map',
    categoryAll: 'All',
    routeGuidance: 'Route in Google Maps',
    statusTodayEvent: 'Happening Today!',
    filterTitle: 'Filter by tags',
    cmsTitle: 'Concierge CMS Portal',
    gpsTrackingActive: 'GPS Tracking Active',
    gpsTrackingInactive: 'Show Current Location',
    gpsSimulateWalking: 'Simulate Walking Tracker',
    noSpotsFound: 'No matching spots found. Please try another tag.',
    aboutApp: 'Scan the room QR and find local eats instantly without login.',
    guestView: 'Return to Guest Mode',
    openInGoogleMaps: 'Open in Google Maps',
    selectLanguage: 'Select Language',
    eventCalendarButton: 'Local Events',
    eventCalendarTitle: 'Local Event Calendar',
    eventCalendarSubtitle: 'Latest listings from the Dogo Onsen official area guide. Check each link for the exact venue.',
    eventCalendarViewDetails: 'View details',
    eventCalendarEmpty: 'No event information available right now.'
  }
};
