/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import L from 'leaflet';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Edit, 
  Sparkles, 
  Download, 
  Eye, 
  Activity, 
  MapPin, 
  Save, 
  Check, 
  Search,
  BookOpen,
  Image as ImageIcon,
  Clock,
  AlertCircle,
  Lock,
  Loader2,
  ExternalLink,
  Upload
} from 'lucide-react';
import { Spot, SpotCategory, SystemStats, LANGUAGE_LABELS, LanguageCode, CalendarEvent, DEFAULT_HOTEL_CONFIG, CATEGORY_COLOR_PALETTE, CATEGORY_EMOJI_PALETTE } from '../types';
import { formatCalendarEventDate } from '../utils';

// sessionStorage key that keeps staff logged in until the browser tab is closed.
const ADMIN_TOKEN_STORAGE_KEY = 'concierge_admin_token';

interface CmsViewProps {
  onBackToGuest: () => void;
}

interface GeocodeResult {
  title: string;
  latitude: number;
  longitude: number;
}

// Reused by both the hotel settings form and the spot editor: lets staff type a Japanese
// address and pick the matched coordinates, instead of guessing/typing lat/lng by hand
// (the source of the small coordinate drift reported by the user). Uses the free, key-less
// GSI (国土地理院) address geocoder via /api/geocode.
function AddressSearchBox({ onSelect, adminToken }: { onSelect: (lat: number, lng: number) => void; adminToken: string }) {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError('');
    setResults([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`, {
        headers: { 'x-admin-token': adminToken },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '住所検索に失敗しました');
      if (data.length === 0) setError('該当する住所が見つかりませんでした。');
      setResults(data);
    } catch (e: any) {
      setError(e?.message || '住所検索に失敗しました');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-semibold text-slate-500">住所から検索（日本の住所のみ・国土地理院データ）</span>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="例: 愛媛県松山市道後湯之町"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
          className="flex-1 px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isSearching}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white disabled:bg-slate-300 flex items-center gap-1 shrink-0 cursor-pointer"
        >
          {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          検索
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-600 font-semibold">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-0.5 max-h-32 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                onSelect(r.latitude, r.longitude);
                setResults([]);
                setQuery(r.title);
              }}
              className="w-full text-left px-3 py-2 text-[11px] hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className="truncate">{r.title}</span>
              <span className="text-[9px] text-slate-400 font-mono shrink-0">{r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}// A small palette swatch grid staff pick from, rather than a free-form color/emoji input.
// Colors are shown as solid swatches (inline style, since they're arbitrary hex values);
// emoji are shown as their literal character on a neutral background.
function PaletteGrid({ options, value, onSelect, kind }: {
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  kind: 'color' | 'emoji';
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          style={kind === 'color' ? { backgroundColor: opt } : undefined}
          className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center text-base transition ${
            value === opt ? 'border-slate-900 scale-110' : 'border-transparent hover:border-slate-300'
          } ${kind === 'emoji' ? 'bg-slate-50' : ''}`}
        >
          {kind === 'emoji' ? opt : ''}
        </button>
      ))}
    </div>
  );
}

// Staff-managed, extensible spot categories: add/edit/delete a category (label + a color
// and emoji picked from a curated palette), used both for the spot type selector below and
// to drive pin color/emoji on the guest map so they can never drift out of sync.
function CategoryManager({ categories, adminFetch, onChange }: {
  categories: SpotCategory[];
  adminFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onChange: () => void;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftColor, setDraftColor] = useState<string>(CATEGORY_COLOR_PALETTE[0]);
  const [draftEmoji, setDraftEmoji] = useState<string>(CATEGORY_EMOJI_PALETTE[0]);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startAdd = () => {
    setEditingId('new');
    setDraftLabel('');
    setDraftColor(CATEGORY_COLOR_PALETTE[categories.length % CATEGORY_COLOR_PALETTE.length]);
    setDraftEmoji(CATEGORY_EMOJI_PALETTE[0]);
    setError('');
  };

  const startEdit = (cat: SpotCategory) => {
    setEditingId(cat.id);
    setDraftLabel(cat.label);
    setDraftColor(cat.color);
    setDraftEmoji(cat.emoji);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError('');
  };

  const handleSave = async () => {
    if (!draftLabel.trim()) {
      setError('カテゴリ名を入力してください。');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const isNew = editingId === 'new';
      const url = isNew ? '/api/categories' : `/api/categories/${editingId}`;
      const res = await adminFetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: draftLabel.trim(), color: draftColor, emoji: draftEmoji }),
      });
      if (res.ok) {
        setEditingId(null);
        onChange();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '保存に失敗しました。');
      }
    } catch {
      setError('通信に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (cat: SpotCategory) => {
    if (!confirm(`「${cat.label}」を削除してもよろしいですか？`)) return;
    const res = await adminFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
    if (res.ok) {
      onChange();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '削除に失敗しました。');
    }
  };

  const editorForm = (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
      <input
        type="text"
        placeholder="例: カフェ、温泉、体験プログラム"
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-xs border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
      <div>
        <span className="block text-[10px] font-semibold text-slate-500 mb-1">色を選択</span>
        <PaletteGrid
          options={CATEGORY_COLOR_PALETTE}
          value={draftColor}
          onSelect={setDraftColor}
          kind="color"
        />
      </div>
      <div>
        <span className="block text-[10px] font-semibold text-slate-500 mb-1">絵文字を選択</span>
        <PaletteGrid
          options={CATEGORY_EMOJI_PALETTE}
          value={draftEmoji}
          onSelect={setDraftEmoji}
          kind="emoji"
        />
      </div>
      {error && <p className="text-[10px] text-rose-600 font-semibold">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={cancelEdit} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 flex items-center gap-1"
        >
          {isSaving && <Loader2 className="w-3 h-3 animate-spin" />} 保存
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {categories.map(cat => (
        <div key={cat.id}>
          {editingId === cat.id ? editorForm : (
            <div className="flex items-center gap-2 border border-slate-100 rounded-xl px-3 py-2">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
                style={{ backgroundColor: cat.color }}
              >
                {cat.emoji}
              </span>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{cat.label}</span>
              <button type="button" onClick={() => startEdit(cat)} className="p-1 text-slate-400 hover:text-slate-700">
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => handleDelete(cat)} className="p-1 text-slate-400 hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {editingId === 'new' ? editorForm : (
        <button
          type="button"
          onClick={startAdd}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-slate-500 border border-dashed border-slate-300 hover:bg-slate-50"
        >
          <Plus className="w-3.5 h-3.5" /> 新しいカテゴリを追加
        </button>
      )}
    </div>
  );
}

export default function CmsView({ onBackToGuest }: CmsViewProps) {
  // Login gate. The password is verified by the server (/api/login, checked against the
  // ADMIN_PASSWORD secret) and then sent with every data-changing request via the
  // x-admin-token header — nothing password-like is hardcoded in this client code.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [adminToken, setAdminToken] = useState<string>(() => {
    try { return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const handleAuthExpired = () => {
    try { sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY); } catch {}
    setAdminToken('');
    setIsAuthenticated(false);
    alert('認証が無効になりました（パスワード変更など）。再度ログインしてください。');
  };

  // fetch wrapper for admin-only APIs: attaches the token and logs out on auth failure
  const adminFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), 'x-admin-token': adminToken },
    });
    if (res.status === 401) handleAuthExpired();
    return res;
  };

  // Restore the session after a reload: re-verify the stored token with the server.
  useEffect(() => {
    if (!adminToken || isAuthenticated) return;
    (async () => {
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminToken }),
        });
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          try { sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY); } catch {}
          setAdminToken('');
        }
      } catch {}
    })();
  }, []);

  // Hotel core settings
  const [hotelConfig, setHotelConfig] = useState({ ...DEFAULT_HOTEL_CONFIG });

  // DB datasets
  const [spots, setSpots] = useState<Spot[]>([]);
  const [categories, setCategories] = useState<SpotCategory[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [stats, setStats] = useState<SystemStats>({
    pvCount: 0,
    activeSpotCount: 0,
    activeEventCount: 0,
    lastUpdated: '-'
  });

  // Form states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [currentSpot, setCurrentSpot] = useState<Partial<Spot> | null>(null);
  
  // Spot photo upload state
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>('');

  // Free auto-pickup of nearby shops/events (no AI API key)
  const [isRefreshingExternal, setIsRefreshingExternal] = useState<boolean>(false);

  // Free auto-pickup of nearby events (Dogo Onsen-area RSS feeds). No AI API key required.
  const handleExternalRefresh = async () => {
    setIsRefreshingExternal(true);
    try {
      const res = await adminFetch('/api/spots/external-refresh', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(
          data.eventError
            ? 'イベント情報: 現在取得できませんでした（情報元のサイトが一時的に混み合っている可能性があります）。'
            : `イベント情報: ${data.eventCount} 件をカレンダーに取得しました。`
        );
        fetchCmsData();
      } else {
        alert(`自動取得に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      alert('自動取得中にネットワークエラーが発生しました。');
    } finally {
      setIsRefreshingExternal(false);
    }
  };

  // Upload a local image file for the spot being created/edited
  const handleImageFileUpload = async (file: File) => {
    setUploadError('');
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await adminFetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '画像のアップロードに失敗しました');
      }
      setCurrentSpot(prev => ({ ...prev, image_urls: [data.url] }));
    } catch (e: any) {
      setUploadError(e?.message || '画像のアップロードに失敗しました');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // QR Code canvas reference
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Interactive Maps State & Reference Refs
  const hotelMapRef = useRef<HTMLDivElement>(null);
  const hotelMapInstanceRef = useRef<L.Map | null>(null);
  const hotelMarkerInstanceRef = useRef<L.Marker | null>(null);

  const spotMapRef = useRef<HTMLDivElement>(null);
  const spotMapInstanceRef = useRef<L.Map | null>(null);
  const spotMarkerInstanceRef = useRef<L.Marker | null>(null);

  // Set up and sync Hotel Map
  useEffect(() => {
    if (!isAuthenticated || isEditing) {
      if (hotelMapInstanceRef.current) {
        hotelMapInstanceRef.current.remove();
        hotelMapInstanceRef.current = null;
        hotelMarkerInstanceRef.current = null;
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!hotelMapRef.current) return;

      if (!hotelMapInstanceRef.current) {
        const map = L.map(hotelMapRef.current, {
          zoomControl: false,
          center: [hotelConfig.latitude, hotelConfig.longitude],
          zoom: 15
        });
        hotelMapInstanceRef.current = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        L.control.zoom({ position: 'topright' }).addTo(map);

        const marker = L.marker([hotelConfig.latitude, hotelConfig.longitude], {
          draggable: true
        }).addTo(map);
        hotelMarkerInstanceRef.current = marker;

        marker.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          setHotelConfig(prev => ({
            ...prev,
            latitude: Number(pos.lat.toFixed(6)),
            longitude: Number(pos.lng.toFixed(6))
          }));
        });

        map.on('click', (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng;
          setHotelConfig(prev => ({
            ...prev,
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6))
          }));
        });
      } else {
        const map = hotelMapInstanceRef.current;
        const marker = hotelMarkerInstanceRef.current;
        if (marker) {
          const currentLatLng = marker.getLatLng();
          if (Math.abs(currentLatLng.lat - hotelConfig.latitude) > 0.00001 || Math.abs(currentLatLng.lng - hotelConfig.longitude) > 0.00001) {
            marker.setLatLng([hotelConfig.latitude, hotelConfig.longitude]);
            map.panTo([hotelConfig.latitude, hotelConfig.longitude]);
          }
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isEditing, hotelConfig.latitude, hotelConfig.longitude]);

  // Set up and sync Spot Map
  useEffect(() => {
    if (!isAuthenticated || !isEditing || !currentSpot) {
      if (spotMapInstanceRef.current) {
        spotMapInstanceRef.current.remove();
        spotMapInstanceRef.current = null;
        spotMarkerInstanceRef.current = null;
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!spotMapRef.current) return;

      const currentLat = currentSpot.latitude || hotelConfig.latitude;
      const currentLng = currentSpot.longitude || hotelConfig.longitude;

      if (!spotMapInstanceRef.current) {
        const map = L.map(spotMapRef.current, {
          zoomControl: false,
          center: [currentLat, currentLng],
          zoom: 15
        });
        spotMapInstanceRef.current = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        L.control.zoom({ position: 'topright' }).addTo(map);

        const marker = L.marker([currentLat, currentLng], {
          draggable: true
        }).addTo(map);
        spotMarkerInstanceRef.current = marker;

        marker.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          setCurrentSpot(prev => {
            if (!prev) return null;
            return {
              ...prev,
              latitude: Number(pos.lat.toFixed(6)),
              longitude: Number(pos.lng.toFixed(6))
            };
          });
        });

        map.on('click', (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng;
          setCurrentSpot(prev => {
            if (!prev) return null;
            return {
              ...prev,
              latitude: Number(lat.toFixed(6)),
              longitude: Number(lng.toFixed(6))
            };
          });
        });
      } else {
        const map = spotMapInstanceRef.current;
        const marker = spotMarkerInstanceRef.current;
        if (marker) {
          const currentLatLng = marker.getLatLng();
          if (Math.abs(currentLatLng.lat - currentLat) > 0.00001 || Math.abs(currentLatLng.lng - currentLng) > 0.00001) {
            marker.setLatLng([currentLat, currentLng]);
            map.panTo([currentLat, currentLng]);
          }
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isEditing, currentSpot?.latitude, currentSpot?.longitude]);

  const fetchCmsData = async () => {
    try {
      // 1. Fetch hotel configs
      const hRes = await fetch('/api/hotel');
      if (hRes.ok) {
        const hData = await hRes.json();
        setHotelConfig(hData);
      }

      // 2. Fetch spots
      const sRes = await fetch('/api/spots');
      if (sRes.ok) {
        const sData = await sRes.json();
        setSpots(sData);
      }

      // 3. Fetch statistics
      const stRes = await fetch('/api/stats');
      if (stRes.ok) {
        const stData = await stRes.json();
        setStats(stData);
      }

      // 4. Fetch auto-collected local event calendar (no map coordinates, see GuestView calendar panel)
      const evRes = await fetch('/api/events');
      if (evRes.ok) {
        setCalendarEvents(await evRes.json());
      }

      // 5. Fetch spot categories (drives the type selector, table badges, and the guest map's pins/filter)
      const catRes = await fetch('/api/categories');
      if (catRes.ok) {
        setCategories(await catRes.json());
      }
    } catch (e) {
      console.error('Failed to load CMS data:', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchCmsData();
    }
  }, [isAuthenticated]);

  // Handle QR Canvas and Image generation
  useEffect(() => {
    if (!isAuthenticated) return;
    
    // Fallback URL to absolute hosting origin or specific URL
    const targetUrl = window.location.origin;
    setQrUrl(targetUrl);

    if (qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        targetUrl,
        {
          width: 140,
          margin: 1.5,
          color: {
            dark: '#0f172a', // deep slate
            light: '#ffffff'
          }
        },
        (error) => {
          if (error) console.error('QR creation error details:', error);
        }
      );
    }

    QRCode.toDataURL(
      targetUrl,
      {
        width: 256,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      },
      (error, url) => {
        if (error) {
          console.error('QR toDataURL error:', error);
          return;
        }
        setQrDataUrl(url);
      }
    );
  }, [isAuthenticated, stats]);

  // QR Downloader action
  const handleDownloadQr = () => {
    const downloadUrl = qrDataUrl || (qrCanvasRef.current ? qrCanvasRef.current.toDataURL('image/png') : '');
    if (!downloadUrl) {
      alert('QRコードが生成されていません。');
      return;
    }
    
    try {
      const link = document.createElement('a');
      link.download = 'hotel_concierge_qr.png';
      link.href = downloadUrl;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download error:', err);
      alert('ブラウザのセキュリティ制限により、直接ダウンロードができない場合があります。画像（QRコード）を右クリックまたは長押しして「画像を保存」してください。');
    }
  };

  // Submit Password (verified server-side against the ADMIN_PASSWORD secret)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (res.ok) {
        try { sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, loginPassword); } catch {}
        setAdminToken(loginPassword);
        setIsAuthenticated(true);
        setLoginPassword('');
      } else {
        setLoginError(data.error || 'ログインに失敗しました。');
      }
    } catch {
      setLoginError('通信に失敗しました。ネットワーク接続をご確認ください。');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Update Hotel Location config
  const handleUpdateHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminFetch('/api/hotel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hotelConfig)
      });
      if (res.ok) {
        alert('ホテルの基本設定を変更しました。すべてに徒歩距離・徒歩分数が即時に再計算されます。');
        fetchCmsData();
      }
    } catch (e) {
      alert('更新に失敗しました。');
    }
  };

  // Create or Update spot handler
  const handleSaveSpot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSpot?.name?.ja || !currentSpot?.latitude || !currentSpot?.longitude) {
      alert('スポット名（日本語）、緯度、経度は必須項目です。');
      return;
    }

    const isNew = !currentSpot.id;
    const url = isNew ? '/api/spots' : `/api/spots/${currentSpot.id}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentSpot)
      });

      if (res.ok) {
        setIsEditing(false);
        setCurrentSpot(null);
        fetchCmsData();
      } else {
        alert('保存に失敗しました。入力値を確認してください。');
      }
    } catch (e) {
      alert('通信に失敗しました。');
    }
  };

  // Delete spot handler
  const handleDeleteSpot = async (id: string) => {
    if (!confirm('このスポット情報を削除してもよろしいですか？')) return;
    try {
      const res = await adminFetch(`/api/spots/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchCmsData();
      } else {
        alert('削除に失敗しました。');
      }
    } catch (e) {
      alert('通信に失敗しました。');
    }
  };

  // Filter list by searchQuery
  const filteredSpots = spots.filter(spot => {
    const q = searchQuery.toLowerCase();
    const jaName = spot.name.ja.toLowerCase();
    const enName = (spot.name.en || '').toLowerCase();
    const valMatched = jaName.includes(q) || enName.includes(q);
    const tagMatched = spot.tags.some(tag => tag.toLowerCase().includes(q));
    const categoryLabel = categories.find(c => c.id === spot.type)?.label.toLowerCase() ?? '';
    return valMatched || tagMatched || categoryLabel.includes(q);
  });

  // Setup blank initial spot for Creating form. Pre-selects the first category so the type
  // selector always shows a visible, changeable selection rather than looking unset.
  const handleInitNewSpot = () => {
    const blankSpot: Partial<Spot> = {
      type: categories[0]?.id ?? '',
      name: { ja: '', en: '' },
      description: { ja: '', en: '' },
      latitude: hotelConfig.latitude + 0.0005, // slightly off-center by default
      longitude: hotelConfig.longitude + 0.0005,
      tags: [],
      image_urls: [''],
      status: 'active',
    };
    setCurrentSpot(blankSpot);
    setIsEditing(true);
  };

  const handleInitEditSpot = (spot: Spot) => {
    setCurrentSpot({ ...spot });
    setIsEditing(true);
  };

  // Guard view with a Login form
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 select-text relative overflow-hidden">
        {/* Decorative Grid Accent */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
        
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8 border border-slate-100 animate-scale-up relative z-10">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-indigo-900 rounded-xl flex items-center justify-center text-white mb-4 shadow">
              <Lock className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">ホテルスタッフ認証</h1>
            <p className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase mt-1">Management CMS Portal</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">管理者パスワード PIN</label>
              <input 
                type="password"
                placeholder="パスワードを入力してください" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-900 text-xs font-mono"
                required
              />
            </div>

            {loginError && (
              <div className="text-[10px] text-rose-700 font-bold bg-rose-50 border border-rose-100 p-2.5 rounded-lg flex items-center">
                <AlertCircle className="w-4 h-4 mr-1.5 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              id="cms-login-submit"
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-indigo-900 hover:bg-indigo-950 disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 text-xs cursor-pointer tracking-wider uppercase flex items-center justify-center gap-2"
            >
              {isLoggingIn && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isLoggingIn ? '認証中...' : 'ログイン'}
            </button>
          </form>

          <button 
            onClick={onBackToGuest}
            className="w-full mt-4 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-2.5 px-4 rounded-xl text-[10px] tracking-wider uppercase transition duration-150 flex items-center justify-center border border-slate-200 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> ゲスト画面へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans select-text relative">
      
      {/* HEADER SECTION */}
      <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-[500] shadow-sm">
        <div className="flex items-center space-x-3">
          <button 
            onClick={onBackToGuest}
            className="w-8 h-8 border border-slate-200 hover:bg-slate-100 rounded flex items-center justify-center text-slate-600 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xs font-extrabold text-slate-800 tracking-tight uppercase leading-none">
              ホテル周辺 CMS 管理ポータル
            </h1>
            <p className="text-[8px] text-slate-400 font-mono tracking-wider font-bold mt-0.5">
              La Rencontre Concierge System Office
            </p>
          </div>
        </div>

        <button 
          onClick={onBackToGuest}
          className="text-[10px] px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-bold uppercase transition flex items-center cursor-pointer border border-slate-200"
        >
          ゲスト画面 (デモ)
        </button>
      </header>

      {/* BODY COLUMN CONTAINER */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFTSIDE COLUMN (DASHBOARD STATS & BASIC CONFIGS) */}
        {!isEditing && (
          <div className="lg:col-span-1 space-y-6">
            
            {/* 1. STATISTICS DASHBOARD CARD */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
              <h2 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-4 flex items-center">
                <Activity className="w-4 h-4 text-emerald-500 mr-1.5" />
                現在の稼働状況 (リアルタイム統計)
              </h2>
              
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                  <span className="text-[10px] font-semibold text-slate-400">総 PV 数</span>
                  <div className="text-xl font-bold text-slate-900 mt-1 font-mono tracking-tight">{stats.pvCount}</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                  <span className="text-[10px] font-semibold text-slate-400">スポット数</span>
                  <div className="text-xl font-bold text-slate-900 mt-1 font-mono tracking-tight">{stats.activeSpotCount}</div>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 border-t border-slate-200 pt-3 flex justify-between">
                <span>最終更新日時:</span>
                <span className="font-mono font-medium">{stats.lastUpdated !== '-' ? new Date(stats.lastUpdated).toLocaleString() : '-'}</span>
              </div>

              {/* FREE EXTERNAL AUTO-PICKUP: OpenStreetMap + RSS, no AI API key required */}
              <div className="mt-4 pt-3 border-t border-slate-200">
                <button
                  id="btn-auto-refresh-external"
                  type="button"
                  onClick={handleExternalRefresh}
                  disabled={isRefreshingExternal}
                  className="w-full bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white text-xs font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 flex items-center justify-center cursor-pointer disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400"
                >
                  {isRefreshingExternal ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin text-white" />
                      イベント情報を取得中...
                    </>
                  ) : (
                    <>
                      <Clock className="w-4 h-4 mr-2 text-sky-200" />
                      周辺イベント情報を自動取得
                    </>
                  )}
                </button>
                <p className="text-[9px] text-slate-400 mt-2 text-left leading-relaxed">
                  APIキー不要。道後温泉公式エリアガイド・道後温泉コンソーシアム公式サイトの2つのRSSフィードから開催予定のイベント情報を自動取得します（終了済みのイベントは除外）。毎日自動更新（Cron）も設定済みです。
                </p>
              </div>
            </div>

            {/* 1B. AUTO-FETCHED EVENT CALENDAR (no reliable venue location, so kept separate from the map) */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
              <h2 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-3 flex items-center">
                <Clock className="w-4 h-4 text-rose-500 mr-1.5" />
                イベントカレンダー（位置情報なし・自動取得）
              </h2>
              {calendarEvents.length === 0 ? (
                <p className="text-[11px] text-slate-400">まだイベント情報がありません。上の「周辺イベント情報を自動取得」を実行してください。</p>
              ) : (
                <ul className="space-y-2 max-h-56 overflow-y-auto">
                  {calendarEvents.map(ev => (
                    <li key={ev.id} className="text-[11px] border border-slate-100 rounded-xl px-3 py-2">
                      <p className="font-bold text-slate-700 leading-snug">{ev.title}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-slate-400">
                          {formatCalendarEventDate(ev, 'ja-JP') || '日付不明'}
                        </span>
                        {ev.link && (
                          <a href={ev.link} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline inline-flex items-center text-[10px] font-bold">
                            詳細 <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[9px] text-slate-400 mt-3 leading-relaxed">
                ※ RSSフィードには会場の正確な位置情報が含まれないため、地図にピン留めせずカレンダー形式でゲスト画面にも表示されます。
              </p>
            </div>

            {/* 1C. CATEGORY MANAGEMENT: the color/emoji picked here is exactly what the guest
                map uses for that category's pins and filter chip, so they can't drift apart. */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
              <h2 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-3 flex items-center">
                <Sparkles className="w-4 h-4 text-amber-500 mr-1.5" />
                スポットの種類（カテゴリ）管理
              </h2>
              <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                ここで追加・編集した色と絵文字が、ゲスト画面の地図ピンと絞り込みボタンにそのまま使われます。
              </p>
              <CategoryManager categories={categories} adminFetch={adminFetch} onChange={fetchCmsData} />
            </div>

            {/* 2. CORE QR SYSTEM CARD */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col items-center text-center">
              <h2 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-2 self-start flex items-center">
                <Download className="w-4 h-4 text-blue-500 mr-1.5" />
                客室掲示用 QRコード生成
              </h2>
              <p className="text-[11px] text-slate-400 self-start text-left mb-4">
                このQRコードを客室のポップアップやフロントに設置することで、お客様はログイン不要で即座に周辺観光情報を開くことができます。
              </p>

              {/* QR Preview (Uses native img element to enable right-click / long-press download in sandboxed contexts) */}
              <div className="bg-white border-2 border-slate-100 p-2 rounded-2xl shadow-sm mb-4 flex items-center justify-center relative">
                {qrDataUrl ? (
                  <img 
                    src={qrDataUrl} 
                    alt="Hotel Concierge QR" 
                    className="w-32 h-32 select-all rounded-lg"
                    id="qr-code-img"
                  />
                ) : (
                  <div className="w-32 h-32 flex items-center justify-center text-slate-300 text-xs font-medium bg-slate-50 rounded-lg">QR作成中...</div>
                )}
                <canvas ref={qrCanvasRef} className="hidden" />
              </div>

              <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-3 py-1 rounded-full border border-slate-200 mb-3 max-w-full truncate">
                {qrUrl}
              </span>

              <button
                id="btn-cms-qr-download"
                onClick={handleDownloadQr}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl py-2.5 px-3 flex items-center justify-center shadow cursor-pointer transition"
              >
                <Download className="w-3.5 h-3.5 mr-1" /> QR コード画像をダウンロード
              </button>
              <p className="text-[9px] text-slate-400 mt-2 text-center leading-relaxed max-w-[240px]">
                ※ セキュリティ制限等でボタンから保存できない場合は、QRコード画像を<strong>右クリックまたは長押しして「画像を保存」</strong>してください。
              </p>
            </div>

            {/* 3. HOTEL SETTINGS CARD (COORDINATES RESIZING) */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
              <h2 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-4 flex items-center">
                <MapPin className="w-4 h-4 text-amber-500 mr-1.5" />
                ホテルの基本位置情報 (起点座標設定)
              </h2>

              <form onSubmit={handleUpdateHotel} className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">ホテル（起点）名称</label>
                  <input 
                    type="text"
                    value={hotelConfig.name}
                    onChange={(e) => setHotelConfig({ ...hotelConfig, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">経緯緯度 (Latitude)</label>
                    <input
                      type="number"
                      step="any"
                      value={hotelConfig.latitude}
                      onChange={(e) => setHotelConfig({ ...hotelConfig, latitude: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">経度 (Longitude)</label>
                    <input
                      type="number"
                      step="any"
                      value={hotelConfig.longitude}
                      onChange={(e) => setHotelConfig({ ...hotelConfig, longitude: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50 font-mono"
                      required
                    />
                  </div>
                </div>

                <AddressSearchBox adminToken={adminToken} onSelect={(lat, lng) => setHotelConfig(prev => ({ ...prev, latitude: lat, longitude: lng }))} />

                {/* Hotel Location Interactive Map */}
                <div className="space-y-1">
                  <span className="block text-[10px] font-semibold text-slate-500">地図上で位置調整（ピンをドラッグ、または地図をクリック）</span>
                  <div
                    ref={hotelMapRef}
                    id="hotel-settings-map"
                    className="w-full h-44 rounded-xl border border-slate-200 shadow-inner overflow-hidden relative z-10"
                  ></div>
                </div>

                <button
                  id="btn-cms-hotel-save"
                  type="submit"
                  className="w-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1 text-slate-500" /> 基本設定を保存
                </button>
              </form>
            </div>

          </div>
        )}

        {/* CMS WORK AREA (RIGHTSIDE CRUD LIST OR THE FORM VIEW) */}
        <div className={isEditing ? 'lg:col-span-3' : 'lg:col-span-2'}>
          
          {/* THE MASTER CRUD FORM (EDIT OR NEW) */}
          {isEditing && currentSpot ? (
            <div className="bg-white rounded-3xl border border-slate-200 shadow p-6 animate-scale-up">
              
              {/* Form header details */}
              <div className="border-b border-slate-100 pb-4 mb-6 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center">
                    <Sparkles className="w-5 h-5 text-amber-500 mr-2.5 animate-pulse" />
                    {currentSpot.id ? 'スポット情報の編集' : '新規おすすめスポット情報の一括登録'}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">フロントに掲示するスポットやイベントの詳細を入力してください。</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setCurrentSpot(null);
                  }}
                  className="text-xs px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition"
                >
                  キャンセル
                </button>
              </div>

              {/* Form Input fields */}
              <form onSubmit={handleSaveSpot} className="space-y-6">

                {/* 1. ROW-GROUP: TYPE SELECTOR (staff must choose; no more silent default).
                    Categories are managed in the "カテゴリ管理" card on the left — the same
                    color shown here is what the guest map's pin and filter chip both use. */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center mb-1">
                    <MapPin className="w-4 h-4 text-slate-600 mr-1.5" />
                    種類 <span className="text-rose-500 ml-1">*必須</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {categories.length === 0 && (
                      <p className="text-[11px] text-slate-400">先に左側の「カテゴリ管理」でカテゴリを追加してください。</p>
                    )}
                    {categories.map(cat => {
                      const isSelected = currentSpot.type === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          id={`btn-spot-type-${cat.id}`}
                          onClick={() => setCurrentSpot({ ...currentSpot, type: cat.id })}
                          style={isSelected ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
                          className={`px-3 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                            isSelected
                              ? 'text-white'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span>{cat.emoji}</span>
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. ROW-GROUP: NAME CARD */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center mb-1">
                    <BookOpen className="w-4 h-4 text-slate-600 mr-1.5" />
                    スポット名称
                  </h3>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">名称 <span className="text-rose-500">*必須</span></label>
                    <input
                      type="text"
                      placeholder="例: 道後麦酒館、大街道、一福"
                      value={currentSpot.name?.ja || ''}
                      onChange={(e) => setCurrentSpot({
                        ...currentSpot,
                        name: { ...currentSpot.name as any, ja: e.target.value }
                      })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      required
                    />
                  </div>
                </div>

                {/* 3. DESCRIPTION CARD */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
                    <h3 className="text-xs font-bold text-slate-700 flex items-center">
                      <Sparkles className="w-4 h-4 text-amber-500 mr-1.5" />
                      紹介説明文
                    </h3>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 flex justify-between">
                      <span>紹介説明文 <span className="text-slate-400">(フロント画面に分かりやすく表示される紹介文です)</span></span>
                      <span className="text-rose-500">*必須</span>
                    </label>
                    <textarea
                      rows={4}
                      placeholder="例: 松山道後のおすすめのスポットの魅力をご紹介します..."
                      value={currentSpot.description?.ja || ''}
                      onChange={(e) => setCurrentSpot({
                        ...currentSpot,
                        description: { ...currentSpot.description as any, ja: e.target.value }
                      })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      required
                    />
                  </div>
                </div>

                {/* 4. ROW-GROUP: COORDINATE LAT & LNG (WITH PRESETS) */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center mb-1">
                    <MapPin className="w-4 h-4 text-slate-600 mr-1.5" />
                    スポット位置座標 (緯度＆経度)
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">緯度 (Latitude) <span className="text-rose-500">*必須</span></label>
                      <input
                        type="number"
                        step="any"
                        placeholder="例: 33.8521"
                        value={currentSpot.latitude || ''}
                        onChange={(e) => setCurrentSpot({ ...currentSpot, latitude: Number(e.target.value) })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">経度 (Longitude) <span className="text-rose-500">*必須</span></label>
                      <input
                        type="number"
                        step="any"
                        placeholder="例: 132.7865"
                        value={currentSpot.longitude || ''}
                        onChange={(e) => setCurrentSpot({ ...currentSpot, longitude: Number(e.target.value) })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                        required
                      />
                    </div>
                  </div>

                  <AddressSearchBox adminToken={adminToken} onSelect={(lat, lng) => setCurrentSpot(prev => prev ? { ...prev, latitude: lat, longitude: lng } : prev)} />

                  <div className="pt-2 border-t border-slate-200/60">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Googleマップ URL (任意)</label>
                    <input
                      type="url"
                      placeholder="例: https://maps.app.goo.gl/... または https://www.google.com/maps/place/..."
                      value={currentSpot.google_maps_url || ''}
                      onChange={(e) => setCurrentSpot({ ...currentSpot, google_maps_url: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      ※ 登録すると、ゲスト画面のスポット一覧やポップアップに「Googleマップで開く」ボタンが表示され、ユーザーが直接店舗の位置をGoogleマップアプリで開けるようになります。
                    </p>
                  </div>

                  {/* Spot Location Interactive Map */}
                  <div className="space-y-1">
                    <span className="block text-[10px] font-semibold text-slate-500">地図上で位置調整（ピンをドラッグ、または地図をクリック）</span>
                    <div 
                      ref={spotMapRef}
                      id="spot-editor-map" 
                      className="w-full h-60 rounded-xl border border-slate-200 shadow-inner overflow-hidden relative z-10"
                    ></div>
                  </div>

                </div>

                {/* 5. IMAGE UPLOAD */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center mb-1">
                    <ImageIcon className="w-4 h-4 text-slate-600 mr-1.5" />
                    スポット外観・フード写真
                  </h3>

                  <div className="flex items-start gap-4">
                    <div className="w-24 h-24 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0 flex items-center justify-center">
                      {currentSpot.image_urls && currentSpot.image_urls[0] ? (
                        <img src={currentSpot.image_urls[0]} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <label
                        htmlFor="spot-image-file-input"
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition ${
                          isUploadingImage ? 'bg-slate-200 text-slate-400' : 'bg-indigo-900 text-white hover:bg-indigo-950'
                        }`}
                      >
                        {isUploadingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {isUploadingImage ? 'アップロード中...' : '画像をアップロード'}
                      </label>
                      <input
                        id="spot-image-file-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        disabled={isUploadingImage}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageFileUpload(file);
                          e.target.value = '';
                        }}
                      />
                      {uploadError && (
                        <p className="text-[10px] text-rose-600 font-semibold">{uploadError}</p>
                      )}
                      <p className="text-[10px] text-slate-400">JPEG / PNG / WEBP / GIF、15MBまで。</p>
                    </div>
                  </div>
                </div>

                {/* 7. EVENT TIMEFRAME DATES (ONLY IF TYPE === EVENT) */}
                {currentSpot.type === 'event' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-rose-50/50 border border-rose-100 rounded-2xl p-5">
                    <div>
                      <label className="block text-xs font-bold text-rose-900 mb-1">イベント開始日 (Start Date)</label>
                      <input
                        type="date"
                        value={currentSpot.event_start_at || ''}
                        onChange={(e) => setCurrentSpot({ ...currentSpot, event_start_at: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-rose-200 bg-white text-sm text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-rose-900 mb-1">イベント終了・撤去日 (End Date)</label>
                      <input
                        type="date"
                        value={currentSpot.event_end_at || ''}
                        onChange={(e) => setCurrentSpot({ ...currentSpot, event_end_at: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-rose-200 bg-white text-sm text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Form Action buttons */}
                <div className="pt-4 border-t border-slate-100 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setCurrentSpot(null);
                    }}
                    className="px-5 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition text-xs font-bold font-sans cursor-pointer"
                  >
                    キャンセル
                  </button>
                  <button
                    id="btn-cms-spot-submit"
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-900 hover:text-white border border-slate-200 hover:border-slate-900 text-slate-800 font-bold transition text-xs font-sans flex items-center cursor-pointer"
                  >
                    <Check className="w-4 h-4 mr-1.5" />
                    スポット情報を保存・一括公開する
                  </button>
                </div>

              </form>

            </div>
          ) : (
            /* THE LIST OF ACTIVE REGISTERED SPOTS */
            <div className="bg-white rounded-3xl border border-slate-200 shadow p-6">
              
              {/* List Header control row */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    登録済みホテル周辺スポット・観光イベント一覧
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    合計 {filteredSpots.length} 件が登録されています。条件にマッチする項目の一覧が表示されています。
                  </p>
                </div>
                <button
                  id="btn-cms-init-new"
                  onClick={handleInitNewSpot}
                  className="flex bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition duration-150 shrink-0 cursor-pointer"
                >
                  <Plus className="w-4.5 h-4.5 mr-1" /> 新しいスポットを追加
                </button>
              </div>

              {/* Filtering input bar */}
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 mb-5">
                <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                <input
                  type="text"
                  placeholder="店名、説明文、ジャンルやカテゴリタグで検索絞り込み..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none focus:ring-0 w-full text-xs text-slate-800"
                />
              </div>

              {/* Table listings */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                      <th className="py-3 px-4">外観</th>
                      <th className="py-3 px-4">種類</th>
                      <th className="py-3 px-4">スポット名（日英）</th>
                      <th className="py-3 px-4">経緯度座標</th>
                      <th className="py-3 px-4 text-right">管理操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredSpots.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-slate-400 font-medium">
                          検索条件に該当するスポットが見つかりません。
                        </td>
                      </tr>
                    ) : (
                      filteredSpots.map(spot => {
                        const category = categories.find(c => c.id === spot.type);

                        return (
                          <tr key={spot.id} className="hover:bg-slate-50/50 duration-100">
                            {/* Spot small card photo icon: no stock-photo fallback, so an
                                untouched spot honestly shows an empty thumbnail. */}
                            <td className="py-3.5 px-4">
                              {spot.image_urls && spot.image_urls[0] ? (
                                <img
                                  src={spot.image_urls[0]}
                                  alt={spot.name.ja}
                                  className="w-10 h-8 rounded object-cover border border-slate-200 shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-10 h-8 rounded border border-slate-200 bg-slate-50 shrink-0 flex items-center justify-center">
                                  <ImageIcon className="w-3.5 h-3.5 text-slate-300" />
                                </div>
                              )}
                            </td>
                            {/* Type classification: color/emoji come from the category the
                                spot references, same as the guest map's pins and filter chips */}
                            <td className="py-3.5 px-4">
                              {category ? (
                                <span
                                  className="px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1"
                                  style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                                >
                                  <span>{category.emoji}</span>
                                  {category.label}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400">不明</span>
                              )}
                            </td>
                            {/* Name translations */}
                            <td className="py-3.5 px-4 font-sans">
                              <p className="font-bold text-slate-800">{spot.name.ja}</p>
                              {spot.name.en && <p className="text-[10px] text-slate-400 mt-0.5">{spot.name.en}</p>}
                            </td>
                            {/* Coords lookup */}
                            <td className="py-3.5 px-4 font-mono text-[9px] text-slate-400">
                              <div>{spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}</div>
                              {spot.google_maps_url && (
                                <a 
                                  href={spot.google_maps_url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-indigo-600 hover:underline inline-flex items-center mt-1 font-sans text-[10px]"
                                >
                                  <ExternalLink className="w-2.5 h-2.5 mr-0.5" /> Mapsで確認
                                </a>
                              )}
                            </td>
                            {/* Actions CRUD buttons */}
                            <td className="py-3.5 px-4 text-right">
                              <div className="inline-flex space-x-2">
                                <button
                                  id={`edit-spot-${spot.id}`}
                                  onClick={() => handleInitEditSpot(spot)}
                                  className="p-1 px-2 text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 hover:border-slate-300 duration-100 rounded flex items-center"
                                  title="情報編集"
                                >
                                  <Edit className="w-3 h-3 mr-0.5" /> 編集
                                </button>
                                <button
                                  id={`delete-spot-${spot.id}`}
                                  onClick={() => handleDeleteSpot(spot.id)}
                                  className="p-1 px-2 text-[10px] font-bold text-rose-600 hover:text-rose-900 bg-rose-50 border border-rose-100 hover:border-rose-200 duration-100 rounded flex items-center"
                                  title="スポットを削除"
                                >
                                  <Trash2 className="w-3 h-3 mr-0.5" /> 削除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

        </div>

      </main>

    </div>
  );
}
