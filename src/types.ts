/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LanguageCode = 'ja' | 'en' | 'zh_cn' | 'zh_tw' | 'ko';

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
  zh_cn: string;
  zh_tw: string;
  ko: string;
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
  '#すべて': { ja: 'すべて', en: 'All', zh_cn: '全部', zh_tw: '全部', ko: '전체' },
  '#スタッフ厳選': { ja: 'ホテル厳選', en: 'Staff Pick', zh_cn: '酒店精选', zh_tw: '酒店精選', ko: '호텔 추천' },
  '#ご当地グルメ': { ja: 'ご当地グルメ', en: 'Local Food', zh_cn: '当地美食', zh_tw: '當地美食', ko: '현지 미식' },
  '#ランチ': { ja: 'ランチ', en: 'Lunch', zh_cn: '午餐', zh_tw: '午餐', ko: '런치' },
  '#ディナー': { ja: 'ディナー', en: 'Dinner', zh_cn: '晚餐', zh_tw: '晚餐', ko: '디너' },
  '#居酒屋': { ja: '居酒屋', en: 'Izakaya', zh_cn: '居酒屋', zh_tw: '居酒屋', ko: '이자카야' },
  '#本日開催イベント': { ja: '本日開催！', en: 'Happening Today!', zh_cn: '今日举办！', zh_tw: '今日舉辦！', ko: '오늘 개최!' },
  '#子連れ歓迎': { ja: '子連れ歓迎', en: 'Family Friendly', zh_cn: '欢迎亲子', zh_tw: '歡迎親子', ko: '아이 동반 환영' },
  '#徒歩5分以内': { ja: '徒歩5分以内', en: 'Within 5 min walk', zh_cn: '步行5分钟内', zh_tw: '步行5分鐘內', ko: '도보 5분 이내' },
};

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  ja: '日本語',
  en: 'English',
  zh_cn: '简体中文',
  zh_tw: '繁體中文',
  ko: '한국어'
};

export const UI_TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  ja: {
    appTitle: 'ホテル周辺デジタルコンシェルジュ',
    backToMap: '地図へ戻る',
    categoryAll: 'すべて',
    routeGuidance: 'Google マップでルート案内',
    routeGuidanceApple: 'iOS マップでルート案内',
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
    routeGuidanceApple: 'Route in Apple Maps',
    statusTodayEvent: 'Happening Today!',
    filterTitle: 'Filter by tags',
    cmsTitle: 'Concierge CMS Portal',
    gpsTrackingActive: 'GPS Tracking Active',
    gpsTrackingInactive: 'Show Current Location',
    gpsSimulateWalking: 'Simulate Walking Tracker',
    noSpotsFound: 'No matched spots. Try other tag filters.',
    aboutApp: 'Scan the room QR and find local eats instantly without login.',
    guestView: 'Return to Guest Mode',
    openInGoogleMaps: 'Open in Google Maps',
    selectLanguage: 'Select Language',
    eventCalendarButton: 'Local Events',
    eventCalendarTitle: 'Local Event Calendar',
    eventCalendarSubtitle: 'Latest listings from the Dogo Onsen official area guide. Check each link for the exact venue.',
    eventCalendarViewDetails: 'View details',
    eventCalendarEmpty: 'No event information available right now.'
  },
  zh_cn: {
    appTitle: '酒店周边数字向导',
    backToMap: '返回地图',
    categoryAll: '全部',
    routeGuidance: 'Google 地图路线导航',
    routeGuidanceApple: 'Apple 地图路线导航',
    statusTodayEvent: '今日举办！',
    filterTitle: '按标签过滤',
    cmsTitle: '酒店周边CMS管理系统',
    gpsTrackingActive: 'GPS 定位开启',
    gpsTrackingInactive: '显示当前位置',
    gpsSimulateWalking: '模拟步行移动',
    noSpotsFound: '没有找到符合条件的景点。请尝试其他标签。',
    aboutApp: '无需登录注册，扫码即刻获取酒店周边美食玩乐推荐。',
    guestView: '返回游客模式',
    openInGoogleMaps: '在Google地图中打开',
    selectLanguage: '选择语言',
    eventCalendarButton: '周边活动信息',
    eventCalendarTitle: '周边活动日历',
    eventCalendarSubtitle: '来自道后温泉官方地区指南的最新信息。具体举办地点请通过各链接确认。',
    eventCalendarViewDetails: '查看详情',
    eventCalendarEmpty: '目前没有可获取的活动信息。'
  },
  zh_tw: {
    appTitle: '酒店周邊數位向導',
    backToMap: '返回地圖',
    categoryAll: '全部',
    routeGuidance: 'Google 地圖路線導航',
    routeGuidanceApple: 'Apple 地圖路線導航',
    statusTodayEvent: '今日舉辦！',
    filterTitle: '依標籤過濾',
    cmsTitle: '酒店周邊CMS管理系統',
    gpsTrackingActive: 'GPS 定位開啟',
    gpsTrackingInactive: '顯示目前位置',
    gpsSimulateWalking: '模擬步行移動',
    noSpotsFound: '沒有找到符合條件的景點。請嘗試其他標籤。',
    aboutApp: '無需登入註冊，掃碼即刻獲取酒店周邊美食玩樂推薦。',
    guestView: '返回遊客模式',
    openInGoogleMaps: '在Google地圖中開啟',
    selectLanguage: '選擇語言',
    eventCalendarButton: '周邊活動資訊',
    eventCalendarTitle: '周邊活動日曆',
    eventCalendarSubtitle: '來自道後溫泉官方地區指南的最新資訊。具體舉辦地點請透過各連結確認。',
    eventCalendarViewDetails: '查看詳情',
    eventCalendarEmpty: '目前沒有可取得的活動資訊。'
  },
  ko: {
    appTitle: '호텔 주변 디지털 컨시에르지',
    backToMap: '지도로 돌아가기',
    categoryAll: '전체',
    routeGuidance: 'Google 지도로 길찾기',
    routeGuidanceApple: 'Apple 지도로 길찾기',
    statusTodayEvent: '오늘 개최!',
    filterTitle: '태그 필터',
    cmsTitle: '컨시에르지 CMS 포털',
    gpsTrackingActive: 'GPS 연동 중',
    gpsTrackingInactive: '현재 위치 보기',
    gpsSimulateWalking: '가상 이동 시뮬레이션',
    noSpotsFound: '해당하는 장소를 찾을 수 없습니다. 다른 태그를 눌러보세요.',
    aboutApp: '로그인 없이 객실 QR코드 리딩만으로 주변 명소와 맛집을 한눈에.',
    guestView: '게스트 화면으로 돌아가기',
    openInGoogleMaps: 'Google 지도에서 열기',
    selectLanguage: '언어 선택',
    eventCalendarButton: '주변 이벤트 정보',
    eventCalendarTitle: '주변 이벤트 캘린더',
    eventCalendarSubtitle: '도고온센 공식 지역 가이드의 최신 정보입니다. 정확한 개최 장소는 각 링크에서 확인해 주세요.',
    eventCalendarViewDetails: '자세히 보기',
    eventCalendarEmpty: '현재 가져올 수 있는 이벤트 정보가 없습니다.'
  }
};
