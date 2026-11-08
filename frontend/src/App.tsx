/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
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
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Checking your session...
      </div>
    );
  }

  if (!user || currentRoute === 'login') {
    return <LoginPage />;
  }

  // Parse route parameters
  const [baseRoute, paramId] = currentRoute.split('/');

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

  return <AppShell>{renderContent()}</AppShell>;
};

export default function App() {
  return (
    <AppProvider>
      <RouterView />
    </AppProvider>
  );
}
