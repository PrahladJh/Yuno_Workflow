import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bot, GitBranch, Activity,
  MessageSquare, Radio, Zap, Menu, X,
} from 'lucide-react';

// MUI
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import TokenCostMonitor from './TokenCostMonitor.jsx';

const DRAWER_W   = 224;   // px  — full sidebar width (≥ md)
const NAV = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents',     icon: Bot,             label: 'Agents' },
  { to: '/workflows',  icon: GitBranch,       label: 'Workflows' },
  { to: '/monitoring', icon: Activity,        label: 'Monitoring' },
  { to: '/channels',   icon: Radio,           label: 'Channels' },
  { to: '/messages',   icon: MessageSquare,   label: 'Messages' },
];

// ── Sidebar content (shared by permanent + temporary drawers) ─────────────────
function SidebarContent({ onClose, iconOnly }) {
  return (
    <Box
      sx={{
        width: iconOnly ? 64 : DRAWER_W,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: '#ffffff',
        borderRight: '1px solid #e5e7eb',
        transition: 'width 0.2s',
        overflow: 'hidden',
      }}
    >
      {/* ── Logo row ── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: iconOnly ? 0 : 1.5,
          px: iconOnly ? 1.5 : 2.5,
          py: 2,
          borderBottom: '1px solid #e5e7eb',
          justifyContent: iconOnly ? 'center' : 'flex-start',
          minHeight: 60,
        }}
      >
        <Box
          sx={{
            width: 32, height: 32, borderRadius: 1.5,
            bgcolor: '#ec4899',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Zap size={16} color="#fff" />
        </Box>
        {!iconOnly && (
          <span style={{ fontWeight: 700, fontSize: 16, color: '#111827', letterSpacing: '-0.02em' }}>
            Yuno AI
          </span>
        )}

        {/* Mobile close button */}
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ ml: 'auto', color: '#6b7280' }}
          >
            <X size={16} />
          </IconButton>
        )}
      </Box>

      {/* ── Nav links ── */}
      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          iconOnly ? (
            <Tooltip key={to} title={label} placement="right" arrow>
              <NavLink
                to={to}
                style={{ textDecoration: 'none' }}
              >
                {({ isActive }) => (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 40, height: 40,
                      borderRadius: 1.5,
                      mx: 'auto',
                      mb: 0.5,
                      bgcolor: isActive ? '#fdf2f8' : 'transparent',
                      color: isActive ? '#db2777' : '#6b7280',
                      '&:hover': { bgcolor: '#f3f4f6', color: '#111827' },
                      transition: 'all 0.15s',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={18} />
                  </Box>
                )}
              </NavLink>
            </Tooltip>
          ) : (
            <NavLink
              key={to}
              to={to}
              style={{ textDecoration: 'none' }}
              onClick={onClose}
            >
              {({ isActive }) => (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    borderRadius: 1.5,
                    bgcolor: isActive ? '#fdf2f8' : 'transparent',
                    color: isActive ? '#db2777' : '#6b7280',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 14,
                    '&:hover': { bgcolor: '#f3f4f6', color: '#111827' },
                    transition: 'all 0.15s',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={16} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{label}</span>
                </Box>
              )}
            </NavLink>
          )
        ))}
      </nav>

      {/* ── Token cost monitor ── */}
      <Divider sx={{ borderColor: '#f3f4f6' }} />
      <Box sx={{ py: 1 }}>
        <TokenCostMonitor iconOnly={iconOnly} />
      </Box>
    </Box>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────
export default function Layout() {
  const theme   = useTheme();
  const isMd    = useMediaQuery(theme.breakpoints.up('md'));   // ≥ 900px → permanent
  const isSm    = useMediaQuery(theme.breakpoints.up('sm'));   // ≥ 600px → icon-only rail
  const [open, setOpen] = useState(false);

  // On mobile (< sm): hamburger → full temporary drawer
  // On tablet (sm–md): permanent icon-only rail (64px)
  // On desktop (≥ md): permanent full sidebar (224px)

  const iconOnly = isSm && !isMd;

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Mobile hamburger topbar ─────────────────────────────────────── */}
      {!isSm && (
        <Box
          sx={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1200,
            height: 52,
            bgcolor: '#ffffff',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            px: 2,
            gap: 2,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <IconButton size="small" onClick={() => setOpen(true)} sx={{ color: '#6b7280' }}>
            <Menu size={20} />
          </IconButton>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 26, height: 26, borderRadius: 1, bgcolor: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={14} color="#fff" />
            </Box>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Yuno AI</span>
          </Box>
        </Box>
      )}

      {/* ── Temporary drawer — mobile only (< sm) ──────────────────────── */}
      <Drawer
        variant="temporary"
        open={open}
        onClose={() => setOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_W, boxSizing: 'border-box', border: 'none' },
        }}
      >
        <SidebarContent onClose={() => setOpen(false)} iconOnly={false} />
      </Drawer>

      {/* ── Permanent drawer — tablet + desktop (≥ sm) ─────────────────── */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', sm: 'block' },
          width: iconOnly ? 64 : DRAWER_W,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: iconOnly ? 64 : DRAWER_W,
            boxSizing: 'border-box',
            border: 'none',
            overflowX: 'hidden',
            transition: 'width 0.2s',
          },
        }}
        open
      >
        <SidebarContent iconOnly={iconOnly} />
      </Drawer>

      {/* ── Page content ───────────────────────────────────────────────── */}
      {/* IMPORTANT: do NOT set position + zIndex here — doing so creates a      */}
      {/* stacking context that traps child modals below the sidebar (z-1200).   */}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',   // pages manage their own scroll internally
          bgcolor: '#f9fafb',
          pt: { xs: '52px', sm: 0 }, // clear mobile top-bar
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>

    </Box>
  );
}
