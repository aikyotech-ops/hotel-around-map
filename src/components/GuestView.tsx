/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { motion, AnimatePresence, useDragControls, useMotionValue, animate } from 'motion/react';
import { 
  MapPin, 
  Map as MapIcon, 
  Compass, 
  UtensilsCrossed, 
  Calendar, 
  Sparkles, 
  Check, 
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  User,
  Activity,
  Maximize2,
  Navigation,
  Globe,
  Info,
  ImageOff
} from 'lucide-react';
import { Spot, SpotCategory, CalendarEvent, LanguageCode, UI_TRANSLATIONS, LANGUAGE_LABELS, TAG_LABEL_TRANSLATIONS, DEFAULT_HOTEL_CONFIG } from '../types';
import { formatCalendarEventDate } from '../utils';

// Fallback for a spot whose category was somehow deleted out from under it.
const UNKNOWN_CATEGORY: SpotCategory = { id: '', label: '?', color: '#94a3b8', emoji: '❓', sortOrder: 999 };

// Spot names / hotel name are staff-entered text that gets inlined into Leaflet
// popup/tooltip HTML strings, so it must be escaped to keep any markup inert.
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);

// Only open real web links; blocks javascript: and other executable URL schemes.
const safeHttpUrl = (u?: string): string | null => {
  const trimmed = u?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

// Kyoto Gion Coordinates
interface Coords {
  lat: number;
  lng: number;
}

const LANG_STORAGE_KEY = 'concierge_lang';

// Fixed header (h-14 = 56px) + category filter bar height, both pinned above the spot
// detail sheet in z-index. The sheet's max-open height is capped to this so it can never
// be dragged up underneath them, which would hide its drag handle/close button and leave
// it stuck open.
const HEADER_AND_FILTER_BAR_HEIGHT_PX = 110;

export default function GuestView() {
  const [lang, setLang] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY) as LanguageCode | null;
      if (saved && saved in LANGUAGE_LABELS) return saved;
    } catch {}
    return 'ja';
  });
  const [isLangMenuOpen, setIsLangMenuOpen] = useState<boolean>(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {}
  }, [lang]);

  const [hotelConfig, setHotelConfig] = useState({ ...DEFAULT_HOTEL_CONFIG });

  const [spots, setSpots] = useState<Spot[]>([]);
  const [categories, setCategories] = useState<SpotCategory[]>([]);
  const getCategory = (id: string): SpotCategory => categories.find(c => c.id === id) ?? UNKNOWN_CATEGORY;
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const visibleSpots = typeFilter === 'all' ? spots : spots.filter(s => s.type === typeFilter);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetY = useMotionValue(0);
  const dragControls = useDragControls();
  const calendarDragControls = useDragControls();
  const sheetContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedSpot) {
      sheetY.set(window.innerHeight);
      setSheetVisible(true);
      animate(sheetY, window.innerHeight * 0.46, { type: 'spring', damping: 25, stiffness: 220 });
    }
  }, [selectedSpot]);

  // Keeps the spot detail sheet's content area draggable-from-anywhere while still
  // letting long content scroll natively. touch-action must be correct *before* a touch
  // begins (real touch devices don't honor changing it mid-gesture), so it's kept in sync
  // here — via the sheet's position and the content's scroll position — instead of being
  // decided inside the pointerdown handler itself. Only claim the touch for dragging the
  // sheet while it isn't fully expanded yet and its content hasn't been scrolled down;
  // once fully open, hand touches back to native scrolling so long descriptions work.
  useEffect(() => {
    const content = sheetContentRef.current;
    if (!content) return;
    const updateTouchAction = () => {
      const notFullyOpen = sheetY.get() > 1;
      content.style.touchAction = notFullyOpen && content.scrollTop <= 0 ? 'none' : 'pan-y';
    };
    updateTouchAction();
    const unsubscribe = sheetY.on('change', updateTouchAction);
    content.addEventListener('scroll', updateTouchAction);
    return () => {
      unsubscribe();
      content.removeEventListener('scroll', updateTouchAction);
    };
  }, [sheetVisible]);

  // GPS State
  const [gpsActive, setGpsActive] = useState<boolean>(false);
  const [userLocation, setUserLocation] = useState<Coords>({
    lat: 33.8492, // Temporarily initialized, will sync with hotelConfig
    lng: 132.7850,
  });
  
  const [mapLoaded, setMapLoaded] = useState<boolean>(false);
  
  // Leaflet references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const userMarkerRef = useRef<L.Marker | null>(null);
  const hotelMarkerRef = useRef<L.Marker | null>(null);

  // Fetch Spots and Hotel coordinates from backend
  const fetchSpots = async () => {
    try {
      const hRes = await fetch('/api/hotel');
      if (hRes.ok) {
        const hData = await hRes.json();
        setHotelConfig(hData);
        // Sync user location to slightly southwest of the actual hotel config
        setUserLocation({
          lat: hData.latitude - 0.0007,
          lng: hData.longitude - 0.0015,
        });
      }

      const res = await fetch('/api/spots');
      if (res.ok) {
        const data = await res.json();
        // Filters active spots
        const activeSpots = data.filter((s: Spot) => s.status === 'active');
        setSpots(activeSpots);
      }

      const catRes = await fetch('/api/categories');
      if (catRes.ok) {
        setCategories(await catRes.json());
      }

      // Auto-fetched local events without a reliable venue location: shown as a calendar
      // list instead of map pins, so they're loaded separately from /api/spots.
      const evRes = await fetch('/api/events');
      if (evRes.ok) {
        setCalendarEvents(await evRes.json());
      }
    } catch (e) {
      console.error('Error fetching spots/hotel:', e);
    }
  };

  useEffect(() => {
    fetchSpots();

    // Register absolute Page View (PV) to Express Statistics store
    fetch('/api/stats/pv', { method: 'POST' }).catch(() => {});
  }, []);

  // Set up the Leaflet map instance once on mount. Deliberately does NOT depend on
  // hotelConfig.latitude/longitude: recreating the whole map every time hotel coordinates
  // change (e.g. once the real coords arrive shortly after the initial placeholder render)
  // raced with React StrictMode's double-invoked effects and threw
  // "Failed to execute 'removeChild' on 'Node'" while one create/destroy cycle was still
  // mid-flight. Position/name updates after the first mount are handled by the effect below,
  // which only moves the existing marker instead of tearing down and rebuilding the map.
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create Map
    const map = L.map(mapContainerRef.current, {
      zoomControl: false, // Customized buttons
      center: [hotelConfig.latitude, hotelConfig.longitude],
      zoom: 16,
    });

    mapInstanceRef.current = map;
    setMapLoaded(true);

    // Load beautiful Voyager tile layers (fast, high-resolution, travel-vibe)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    // Initial load hotel marker
    const hotelHtml = `
      <div class="relative flex items-center justify-center w-11 h-11 bg-indigo-900 rounded-full border-[3px] border-white shadow-xl scale-105 duration-200 animate-pulse">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
        <div class="absolute -bottom-1.5 w-2.5 h-2.5 bg-indigo-900 rotate-45 border-r border-b border-white"></div>
      </div>
    `;
    const hotelIcon = L.divIcon({
      html: hotelHtml,
      className: 'custom-hotel-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 40]
    });

    const hotelMarker = L.marker([hotelConfig.latitude, hotelConfig.longitude], { icon: hotelIcon })
      .addTo(map)
      .bindTooltip(escapeHtml(hotelConfig.name), { permanent: true, direction: 'top', className: 'text-xs font-bold px-2.5 py-1 rounded-md border-indigo-200 bg-indigo-50 text-indigo-900 shadow-sm shadow-indigo-500/10' });

    hotelMarkerRef.current = hotelMarker;

    return () => {
      // Clean up on component unmount
      map.remove();
      mapInstanceRef.current = null;
      hotelMarkerRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Move the existing hotel marker / map center when hotel coordinates change, instead of
  // recreating the whole map instance (see note on the effect above).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = hotelMarkerRef.current;
    if (!map || !marker) return;

    marker.setLatLng([hotelConfig.latitude, hotelConfig.longitude]);
    marker.setTooltipContent(escapeHtml(hotelConfig.name));
    map.panTo([hotelConfig.latitude, hotelConfig.longitude]);
  }, [hotelConfig.latitude, hotelConfig.longitude, hotelConfig.name, mapLoaded]);

  // Handle GPS location icon change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }

    const gpsHtml = `
      <div class="relative flex items-center justify-center w-8 h-8">
        <div class="absolute inset-0 gps-pulse-ring rounded-full"></div>
        <div class="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg z-10 flex items-center justify-center">
          <div class="w-2 h-2 bg-white rounded-full"></div>
        </div>
      </div>
    `;

    const gpsIcon = L.divIcon({
      html: gpsHtml,
      className: 'custom-gps-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: gpsIcon }).addTo(map);
    userMarkerRef.current = userMarker;

  }, [userLocation]);

  // Re-draw Pins on tag click / spot collection adjustments
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous markers
    (Object.values(markersRef.current) as any[]).forEach(m => {
      if (m && typeof m.remove === 'function') {
        m.remove();
      }
    });
    markersRef.current = {};

    // Add Pins: a uniform circular badge for every category (color + emoji come from the
    // category the spot references), since a per-type shape stops making sense once staff
    // can add an arbitrary number of categories — color and emoji are what stay distinctive.
    visibleSpots.forEach(spot => {
      const isSelected = selectedSpot?.id === spot.id;
      const category = getCategory(spot.type);

      const outerClass = isSelected
        ? 'scale-125 z-[999] ring-2 ring-offset-2 ring-indigo-600'
        : 'hover:scale-110 border-2 border-white';

      const pinHtml = `
        <div class="relative group duration-150 flex flex-col items-center">
          <div class="w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-lg leading-none ${outerClass}" style="background-color: ${escapeHtml(category.color)}">
            ${escapeHtml(category.emoji)}
          </div>
          <div class="absolute -bottom-1 w-2.5 h-2.5 rotate-45 z-0" style="background-color: ${escapeHtml(category.color)}"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: pinHtml,
        className: 'custom-spot-pin',
        iconSize: [40, 40],
        iconAnchor: [20, 36]
      });

      const googleMapsUrlStr = safeHttpUrl(spot.google_maps_url) || `https://www.google.com/maps/search/?api=1&query=${spot.latitude},${spot.longitude}`;
      const popupHtml = `
        <div class="p-1 font-sans text-slate-800" style="min-width: 120px;">
          <p class="font-bold text-xs mb-1">${escapeHtml(spot.name[lang] || spot.name.ja)}</p>
          <a href="${escapeHtml(googleMapsUrlStr)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-[10px] font-bold text-indigo-600 hover:underline">
            ${t('openInGoogleMaps')} ↗
          </a>
        </div>
      `;

      const marker = L.marker([spot.latitude, spot.longitude], { icon: customIcon })
        .addTo(map)
        .bindPopup(popupHtml, { closeButton: false, offset: [0, -24] })
        .on('click', () => {
          setSelectedSpot(spot);
          map.setView([spot.latitude - 0.001, spot.longitude], 17, { animate: true });
        });

      markersRef.current[spot.id] = marker;
    });

  }, [visibleSpots, selectedSpot, mapLoaded, hotelConfig, lang, categories]);

  // Track user real-time position with browser Geolocator
  const toggleGpsTracking = () => {
    if (gpsActive) {
      setGpsActive(false);
      // Re-center on hotel
      mapInstanceRef.current?.setView([hotelConfig.latitude, hotelConfig.longitude], 16, { animate: true });
    } else {
      setGpsActive(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const current: Coords = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude
            };
            setUserLocation(current);
            mapInstanceRef.current?.setView([current.lat, current.lng], 16, { animate: true });
          },
          (err) => {
            console.warn('Geolocation access failed. Proceed with synchronized hotel proximity coordinate updates instead.', err);
            // Default to hotel-adjacent coordinates
            const defaultSimCoords = {
              lat: hotelConfig.latitude - 0.0007,
              lng: hotelConfig.longitude - 0.0015
            };
            setUserLocation(defaultSimCoords);
            mapInstanceRef.current?.setView([defaultSimCoords.lat, defaultSimCoords.lng], 16, { animate: true });
          },
          { enableHighAccuracy: true }
        );
      }
    }
  };

  // Helper translations lookup
  const t = (key: string, variables: Record<string, any> = {}): string => {
    const translations = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS['ja'];
    let text = translations[key] || UI_TRANSLATIONS['ja'][key] || key;
    
    Object.keys(variables).forEach(vKey => {
      text = text.replace(`{${vKey}}`, String(variables[vKey]));
    });
    return text;
  };

  // Navigation Deeplink builder
  const closeSheet = () => {
    animate(sheetY, window.innerHeight, { type: 'spring', damping: 28, stiffness: 200 })
      .then(() => {
        setSelectedSpot(null);
        setSheetVisible(false);
      });
  };

  const handleNavigationRedirect = (spot: Spot) => {
    // Prefer registered Google Maps URL if available (http/https links only)
    const registeredUrl = safeHttpUrl(spot.google_maps_url);
    if (registeredUrl) {
      window.open(registeredUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const url = isIOS 
      ? `maps://?q=${spot.latitude},${spot.longitude}` 
      : `https://www.google.com/maps/search/?api=1&query=${spot.latitude},${spot.longitude}`;
    
    window.open(url, '_blank');
  };

  return (
    <div className="relative w-full h-[100dvh] bg-slate-900 flex flex-col overflow-hidden select-none">
      
      {/* 1. TOP MOBILE HEADER (fixed, always the topmost layer above any sheet/panel/menu) */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-5 shrink-0 z-[1500] shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-slate-800 tracking-tight text-sm leading-none">
            {hotelConfig.name}
          </h1>
        </div>

        {/* CONTROLS */}
        <div className="flex items-center gap-2 relative">
          {/* Local Event Calendar (auto-fetched, no venue coordinates so kept off the map) */}
          <button
            id="btn-guest-calendar-toggle"
            onClick={() => setIsCalendarOpen(true)}
            className="w-10 h-10 bg-slate-100 hover:bg-indigo-900 hover:text-white active:scale-95 duration-150 rounded flex items-center justify-center text-slate-600 border border-slate-200 transition-colors"
            title={t('eventCalendarButton')}
          >
            <Calendar className="w-5 h-5" />
          </button>

          {/* Language Selector */}
          <button
            id="btn-guest-lang-toggle"
            onClick={() => setIsLangMenuOpen(prev => !prev)}
            className="w-10 h-10 bg-slate-100 hover:bg-indigo-900 hover:text-white active:scale-95 duration-150 rounded flex items-center justify-center text-slate-600 border border-slate-200 transition-colors"
            title={t('selectLanguage')}
          >
            <Globe className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* LANGUAGE MENU (rendered above header/tag-bar stacking contexts, fixed to viewport) */}
      {isLangMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-[1199]"
            onClick={() => setIsLangMenuOpen(false)}
          />
          <div className="fixed top-[60px] right-14 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-[1200] min-w-[120px]">
            {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map(code => (
              <button
                key={code}
                id={`btn-lang-option-${code}`}
                onClick={() => {
                  setLang(code);
                  setIsLangMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors ${
                  lang === code ? 'bg-indigo-50 text-indigo-900 font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{LANGUAGE_LABELS[code]}</span>
                {lang === code && <Check className="w-3.5 h-3.5 text-indigo-600" />}
              </button>
            ))}
          </div>
        </>
      )}

      {/* EVENT CALENDAR PANEL (auto-fetched local listings without a reliable venue location,
          shown as a list instead of map pins so the date/title never gets paired with a
          guessed pin position) */}
      <AnimatePresence>
        {isCalendarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[1299]"
              onClick={() => setIsCalendarOpen(false)}
            />
            <motion.div
              id="event-calendar-panel"
              initial={{ y: '100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              drag="y"
              dragControls={calendarDragControls}
              dragListener={false}
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0.1, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 500) {
                  setIsCalendarOpen(false);
                }
              }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-[1300] overflow-hidden flex flex-col"
              style={{ maxHeight: '75dvh' }}
            >
              {/* Sheet handle: same drag-to-dismiss + close button affordance as the spot detail sheet */}
              <div
                className="relative h-10 w-full flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(e) => calendarDragControls.start(e)}
              >
                <div className="w-12 h-1.5 bg-slate-300 rounded-full"></div>
                <button
                  id="btn-calendar-close"
                  onClick={() => setIsCalendarOpen(false)}
                  className="absolute right-3 top-1.5 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 pb-3 border-b border-slate-100 shrink-0">
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-4.5 h-4.5 text-rose-500" />
                  {t('eventCalendarTitle')}
                </h2>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{t('eventCalendarSubtitle')}</p>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-3">
                {calendarEvents.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">{t('eventCalendarEmpty')}</p>
                ) : (
                  calendarEvents.map(ev => (
                    <div key={ev.id} className="border border-slate-100 rounded-2xl p-4">
                      <p className="text-sm font-bold text-slate-800 leading-snug">{ev.title}</p>
                      {ev.summary && (
                        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{ev.summary}</p>
                      )}
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-[10px] text-slate-400 font-medium">
                          {formatCalendarEventDate(ev, lang === 'ja' ? 'ja-JP' : 'en-US')}
                        </span>
                        {ev.link && (
                          <a
                            href={ev.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-[11px] font-bold text-indigo-600 hover:underline"
                          >
                            {t('eventCalendarViewDetails')} <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* CATEGORY FILTER CHIPS: lets guests show only one spot type on the map at a time */}
      <div
        aria-label={t('filterTitle')}
        className="fixed top-14 left-0 right-0 z-[1050] px-4 py-2.5 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm flex items-center gap-2 overflow-x-auto"
      >
        <button
          id="btn-type-filter-all"
          onClick={() => setTypeFilter('all')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
            typeFilter === 'all'
              ? 'bg-indigo-900 text-white border-indigo-900'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('categoryAll')}
        </button>
        {categories.map(cat => {
          const isActive = typeFilter === cat.id;
          return (
            <button
              key={cat.id}
              id={`btn-type-filter-${cat.id}`}
              onClick={() => setTypeFilter(cat.id)}
              style={isActive ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                isActive
                  ? 'text-white'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>{cat.emoji}</span>
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* 2. LEAFLET MAP ELEMENT */}
      <div 
        id="leaflet-base-map"
        ref={mapContainerRef} 
        className="w-full h-full z-10"
      />

      {/* 4. FLOATING GPS POSITIONING CONTROLS */}
      <div className="absolute right-4 bottom-52 flex flex-col space-y-3 z-[1000]">
        {/* GPS tracking */}
        <button
          id="btn-gps-geolocation"
          onClick={toggleGpsTracking}
          className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg border outline-none active:scale-90 transition-all duration-200 cursor-pointer ${
            gpsActive 
              ? 'bg-indigo-900 text-white border-indigo-950 shadow-indigo-950/20' 
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
          title={t('gpsTrackingInactive')}
        >
          <Compass className={`w-6 h-6 ${gpsActive ? 'animate-spin-slow' : ''}`} />
        </button>
      </div>

      {/* 5. DRAGGABLE BOTTOM SHEET: opens at 50%, drag handle freely, auto-close below 50%.
          Height is capped to leave room for the fixed header + filter bar (both z-indexed
          above this sheet) so the drag handle/close button can never be dragged up underneath
          them and become unreachable. */}
      {sheetVisible && selectedSpot && (
        <motion.div
          id="spot-detail-bottom-sheet"
          style={{ y: sheetY, height: `calc(100dvh - ${HEADER_AND_FILTER_BAR_HEIGHT_PX}px)` }}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0 }}
          dragElastic={{ top: 0.1, bottom: 0 }}
          onDragEnd={(_, info) => {
            const currentY = sheetY.get();
            const halfPx = window.innerHeight * 0.46;
            if (currentY > halfPx || info.velocity.y > 500) {
              closeSheet();
            }
          }}
          onPointerDownCapture={(e) => {
            // Let taps on real controls (buttons/links) work normally.
            const target = e.target as HTMLElement;
            if (target.closest('button, a, input, textarea, select')) return;
            const content = sheetContentRef.current;
            if (content && content.contains(target)) {
              // Mirrors the touch-action logic in the effect above: once the sheet is
              // fully open, or the content has been scrolled down, hand this touch to
              // native scrolling instead of the sheet drag.
              const notFullyOpen = sheetY.get() > 1;
              if (!notFullyOpen || content.scrollTop > 0) return;
            }
            dragControls.start(e);
          }}
          className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl border-t border-slate-100 shadow-2xl z-[1001] overflow-hidden flex flex-col"
        >
          {/* Sheet Handle */}
          <div className="relative h-10 w-full flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full"></div>
            <button
              id="btn-sheet-close"
              onClick={closeSheet}
              className="absolute right-3 top-1.5 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

            {/* Main Content Area (scrollable; overscroll-contain stops the scroll bounce from
                revealing the dark page background behind the sheet). touch-action is kept
                in sync by the effect above instead of being set here directly. */}
            <div ref={sheetContentRef} className="flex-1 overflow-y-auto overscroll-contain pb-8">
              <div className="px-6 pt-2">
                {/* Badges */}
                <div className="flex gap-1.5 mb-2">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase inline-flex items-center gap-1"
                    style={{ backgroundColor: `${getCategory(selectedSpot.type).color}1a`, color: getCategory(selectedSpot.type).color }}
                  >
                    <span>{getCategory(selectedSpot.type).emoji}</span>
                    {getCategory(selectedSpot.type).label}
                  </span>
                </div>

                {/* Name */}
                <div className="mb-3">
                  <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                    {selectedSpot.name[lang] || selectedSpot.name.ja}
                  </h2>
                </div>

                {/* Event timeframe display */}
                {selectedSpot.type === 'event' && selectedSpot.event_end_at && (
                  <div className="mb-4 flex items-center text-xs text-rose-700 bg-rose-50 border border-rose-100 px-3 py-2 rounded-lg font-medium">
                    <Calendar className="w-4 h-4 mr-1.5 shrink-0" />
                    <span>
                      {selectedSpot.event_start_at} ～ {selectedSpot.event_end_at}
                    </span>
                  </div>
                )}

                {/* Description paragraphs */}
                <p className="text-xs text-slate-600 leading-relaxed font-sans whitespace-pre-wrap">
                  {selectedSpot.description[lang] || selectedSpot.description.ja || 'No description available in this language.'}
                </p>

                {/* Tags section */}
                {selectedSpot.tags && selectedSpot.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {selectedSpot.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {TAG_LABEL_TRANSLATIONS[tag]?.[lang] || tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Google Maps link banner */}
              <div className="px-6 pt-5">
                <button
                  id="btn-trigger-navigation"
                  onClick={() => handleNavigationRedirect(selectedSpot)}
                  className="w-full py-3.5 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg"
                >
                  <Navigation className="w-4.5 h-4.5" />
                  {(selectedSpot.google_maps_url?.trim() || !/iPad|iPhone|iPod/.test(navigator.userAgent)) ? t('routeGuidance') : t('routeGuidanceApple')}
                  <ExternalLink className="w-3.5 h-3.5 ml-1.5 opacity-60" />
                </button>
              </div>

              {/* Cover Photo: only rendered when staff actually uploaded one. No stock-photo
                  fallback, so an untouched spot honestly shows "no photo" instead of a
                  photo nobody chose. Placed last so the text info (name/description/route
                  button) is reachable without scrolling past a large image first. */}
              <div className="relative h-44 md:h-52 bg-slate-100 w-full overflow-hidden mt-5">
                {selectedSpot.image_urls && selectedSpot.image_urls[0] ? (
                  <img
                    src={selectedSpot.image_urls[0]}
                    alt={selectedSpot.name[lang] || selectedSpot.name.ja}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                    <ImageOff className="w-8 h-8 mb-1" />
                    <span className="text-[10px] font-semibold">No Photo</span>
                  </div>
                )}
              </div>
            </div>
        </motion.div>
      )}

      {/* NO SPOTS FOOTER */}
      {visibleSpots.length === 0 && (
        <div className="absolute bottom-20 left-4 right-4 bg-white rounded-2xl border border-rose-100 p-4 text-center shadow-lg z-50 animate-fade-in">
          <Info className="w-6 h-6 text-rose-500 mx-auto mb-1" />
          <p className="text-xs text-slate-600">
            {t('noSpotsFound')}
          </p>
        </div>
      )}

    </div>
  );
}
