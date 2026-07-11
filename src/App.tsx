/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, lazy, Suspense } from 'react';
import GuestView from './components/GuestView';

// Guests (the vast majority of visitors, on hotel Wi-Fi / mobile networks via QR code)
// never open the CMS, so its code — including the QR generation library — is split out
// and only downloaded when staff actually switch to the CMS view.
const CmsView = lazy(() => import('./components/CmsView'));

export default function App() {
  const [view, setView] = useState<'guest' | 'cms'>(() => {
    // Check search params on first load
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'cms' ? 'cms' : 'guest';
  });

  // Keep route synced with search params so bookmarking / page reload works smoothly
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === 'cms') {
      params.set('view', 'cms');
    } else {
      params.delete('view');
    }
    const newRelativePathQuery = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({ path: newRelativePathQuery }, '', newRelativePathQuery);
  }, [view]);

  return (
    <div className="w-full min-h-screen bg-slate-900 overflow-hidden font-sans">
      {view === 'guest' ? (
        <GuestView />
      ) : (
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center text-slate-400 text-xs font-bold tracking-wider">
              管理画面を読み込み中...
            </div>
          }
        >
          <CmsView onBackToGuest={() => setView('guest')} />
        </Suspense>
      )}
    </div>
  );
}
