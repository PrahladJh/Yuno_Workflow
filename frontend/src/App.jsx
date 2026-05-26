import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from './components/Layout/Layout.jsx';

// ── Lazy-load every page so each route gets its own chunk ────────────────────
// The heavy deps (XYFlow, Recharts, MUI) are only downloaded when the user
// first visits that route, not on initial page load.
const Dashboard       = lazy(() => import('./pages/Dashboard.jsx'));
const Agents          = lazy(() => import('./pages/Agents.jsx'));
const AgentDetail     = lazy(() => import('./pages/AgentDetail.jsx'));
const Workflows       = lazy(() => import('./pages/Workflows.jsx'));
const WorkflowBuilder = lazy(() => import('./pages/WorkflowBuilder.jsx'));
const Monitoring      = lazy(() => import('./pages/Monitoring.jsx'));
const Channels        = lazy(() => import('./pages/Channels.jsx'));
const Messages        = lazy(() => import('./pages/Messages.jsx'));

// ── Minimal loading fallback shown while a route chunk downloads ─────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-pink-300 border-t-pink-500 animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#fff', color: '#111827', border: '1px solid #e5e7eb' },
          duration: 3000,
        }}
      />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route path="/dashboard" element={
            <Suspense fallback={<PageLoader />}><Dashboard /></Suspense>
          } />
          <Route path="/agents" element={
            <Suspense fallback={<PageLoader />}><Agents /></Suspense>
          } />
          <Route path="/agents/:id" element={
            <Suspense fallback={<PageLoader />}><AgentDetail /></Suspense>
          } />
          <Route path="/workflows" element={
            <Suspense fallback={<PageLoader />}><Workflows /></Suspense>
          } />
          <Route path="/workflows/:id/edit" element={
            <Suspense fallback={<PageLoader />}><WorkflowBuilder /></Suspense>
          } />
          <Route path="/workflows/new" element={
            <Suspense fallback={<PageLoader />}><WorkflowBuilder /></Suspense>
          } />
          <Route path="/monitoring" element={
            <Suspense fallback={<PageLoader />}><Monitoring /></Suspense>
          } />
          <Route path="/channels" element={
            <Suspense fallback={<PageLoader />}><Channels /></Suspense>
          } />
          <Route path="/messages" element={
            <Suspense fallback={<PageLoader />}><Messages /></Suspense>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
