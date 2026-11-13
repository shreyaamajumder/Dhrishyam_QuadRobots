/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { ToastContainer } from './components/layout/ToastContainer';
import { Background3D } from './components/shared/Background3D';
import { LoginPage } from './pages/LoginPage';
import { MyContentPage } from './pages/MyContentPage';
import { NewReviewPage } from './pages/NewReviewPage';
import { ReviewWorkspacePage } from './pages/ReviewWorkspacePage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { LibraryPage } from './pages/LibraryPage';
import { InsightsPage } from './pages/InsightsPage';
import { TeamPage, AuditLogPage } from './pages/AdminPages';
import { ForbiddenPage, NotFoundPage } from './pages/SystemPages';

const RouterView: React.FC = () => {
  const { user, currentRoute, isAuthReady } = useApp();

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#706860] dark:text-[#a89984]">
        Checking your session...
      </div>
    );
  }

  // If unauthenticated or navigating explicitly to #login or #register (standalone screens without AppShell)
  if (!user || currentRoute === 'login' || currentRoute === 'register') {
    return <LoginPage />;
  }

  // Parse route parameters, stripping any query parameters
  const cleanRoute = currentRoute.split('?')[0];
  const [baseRoute, paramId] = cleanRoute.split('/');

  const renderContent = () => {
    switch (baseRoute) {
      case '':
      case 'my-content':
        if (user.role === 'reviewer') {
          return <ReviewQueuePage />;
        }
        return <MyContentPage />;

      case 'new-review':
        if (user.role === 'reviewer') {
          return <ForbiddenPage />;
        }
        return <NewReviewPage />;

      case 'review-queue':
        if (user.role === 'creator') {
          return <ForbiddenPage />;
        }
        return <ReviewQueuePage />;

      case 'workspace':
        return <ReviewWorkspacePage contentId={paramId || 'cnt_101'} />;

      case 'library':
        return <LibraryPage />;

      case 'insights':
        if (user.role === 'creator') {
          return <ForbiddenPage />;
        }
        return <InsightsPage />;

      case 'team':
        if (user.role !== 'admin') {
          return <ForbiddenPage />;
        }
        return <TeamPage />;

      case 'audit-log':
        if (user.role !== 'admin') {
          return <ForbiddenPage />;
        }
        return <AuditLogPage />;


      default:
        return <NotFoundPage />;
    }
  };

  // Re-key AppShell on tenant or role change to force complete remount of child page trees,
  // preventing any cross-tenant state leakage in React component trees.
  return <AppShell key={`${user.org_id}-${user.role}`}>{renderContent()}</AppShell>;
};

export default function App() {
  return (
    <AppProvider>
      <div className="relative min-h-screen text-[#282828] dark:text-[#ebdbb2] font-sans selection:bg-[#36755a]/25 selection:text-[#282828] dark:selection:bg-[#8ec07c]/30 dark:selection:text-[#fbf1c7] overflow-x-hidden">
        {/* Global Continuous 3D Spatial Field */}
        <Background3D />
        <div className="relative z-10 min-h-screen flex flex-col">
          <RouterView />
        </div>
        {/* Global Toast Queue */}
        <ToastContainer />
      </div>
    </AppProvider>
  );
}
