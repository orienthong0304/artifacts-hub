import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';

import { AuthProvider } from '@/app/lib/auth';
import { Toaster } from '@/components/ui/toaster';
import RootLayout from '@/app/layout';
import RequireAuth from '@/app/components/require-auth';
import ExplorePage from '@/app/pages/explore';
import ArtifactViewPage from '@/app/pages/artifact-view';
import TempViewPage from '@/app/pages/temp-view';
import EditorPage from '@/app/pages/editor';
import LoginPage from '@/app/pages/login';
import RegisterPage from '@/app/pages/register';
import MePage from '@/app/pages/me';
import DevelopersPage from '@/app/pages/developers';
import SitesPage from '@/app/pages/sites';
import UserProfilePage from '@/app/pages/user-profile';
import GuidesPage from '@/app/pages/guides';
import GuideDetailPage from '@/app/pages/guide-detail';
import TermsPage from '@/app/pages/terms';
import PrivacyPage from '@/app/pages/privacy';
import TrustPage from '@/app/pages/trust';
import ContactPage from '@/app/pages/contact';
import AdminPage from '@/app/pages/admin';
import NotFoundPage from '@/app/pages/not-found';

// 显式路由表（契约第 5 节）
// /a/:slug 与 /t/:token 为无壳查看页：不进 RootLayout（无站头/页脚），
// 仍在 AuthProvider 内（作者判定依赖 useAuth）
const router = createBrowserRouter([
  { path: '/a/:slug', element: <ArtifactViewPage /> },
  { path: '/t/:token', element: <TempViewPage /> },
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <ExplorePage /> },
      // /new 刻意**不设**登录守卫（能力波次 2 · W2-1「粘贴即成功」）：
      // 未登录也能粘代码、实时预览，点发布时才要求登录，草稿经 sessionStorage 接回。
      // 真正的写入端点在服务端仍然要 requireAuth——这里放开的只是这一屏的可达性。
      { path: 'new', element: <EditorPage /> },
      {
        path: 'edit/:id',
        element: (
          <RequireAuth>
            <EditorPage />
          </RequireAuth>
        ),
      },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        path: 'me',
        element: (
          <RequireAuth>
            <MePage />
          </RequireAuth>
        ),
      },
      {
        path: 'developers',
        element: (
          <RequireAuth>
            <DevelopersPage />
          </RequireAuth>
        ),
      },
      {
        path: 'sites',
        element: (
          <RequireAuth>
            <SitesPage />
          </RequireAuth>
        ),
      },
      { path: 'u/:username', element: <UserProfilePage /> },
      { path: 'guides', element: <GuidesPage /> },
      { path: 'guides/:slug', element: <GuideDetailPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'trust', element: <TrustPage /> },
      { path: 'contact', element: <ContactPage /> },
      {
        path: 'admin',
        element: (
          <RequireAuth admin>
            <AdminPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      {/* 全局 Toast（跨路由跳转仍可见，如「发布成功但自定义路径设置失败」提示） */}
      <Toaster />
    </AuthProvider>
  </React.StrictMode>,
);
