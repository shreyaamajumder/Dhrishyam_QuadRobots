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
  const { user, currentRoute } = useApp();

  // If unauthenticated or navigating explicitly to #login
  if (!user || currentRoute === 'login') {
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

      case 'register':
        // Authenticated user registering an additional brand
        return <LoginPage />;

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
      <RouterView />
    </AppProvider>
  );
}
