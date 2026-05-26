/**
 * TokenCostMonitor
 * ─────────────────
 * Shows live token usage + estimated USD cost in the navigation sidebar.
 *
 * Data source priority (decided by the backend):
 *   1. LangSmith API  — when LANGSMITH_API_KEY is set in .env
 *   2. Local JSON store (workspace/token_usage.json) — always-on fallback
 *
 * Modes
 *   iconOnly=true  → single icon + tooltip (fits 64 px icon rail)
 *   iconOnly=false → expanded card with today / week / month metrics
 *
 * Polls http://localhost:8000/token-stats every 60 s while the tab is visible.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import Box        from '@mui/material/Box';
import Stack      from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Tooltip    from '@mui/material/Tooltip';
import Divider    from '@mui/material/Divider';
import Chip       from '@mui/material/Chip';
import Collapse   from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';

import { Zap, TrendingUp, ChevronUp, ChevronDown, RefreshCw, Wifi, WifiOff } from 'lucide-react';

const PYTHON_API   = 'http://localhost:8000';
const POLL_MS      = 60_000;   // refresh every 60 s

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtTokens(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd = 0) {
  if (usd <= 0)      return '$0.00';
  if (usd < 0.001)   return '<$0.001';
  if (usd < 0.01)    return `$${usd.toFixed(4)}`;
  if (usd < 1)       return `$${usd.toFixed(3)}`;
  if (usd < 10)      return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

function fmtRuns(n = 0) {
  return n === 1 ? '1 run' : `${n} runs`;
}

// ── Empty / zero state shape ──────────────────────────────────────────────────
const ZERO = { runs: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 };
const EMPTY_STATS = {
  today:  { ...ZERO },
  week:   { ...ZERO },
  month:  { ...ZERO },
  daily:  {},
  models: {},
  source: 'local',
  langsmith_project: null,
};

// ── Mini row: label + value pair ──────────────────────────────────────────────
function Row({ label, tokens, cost, muted = false }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography variant="caption" sx={{ color: muted ? '#9ca3af' : '#6b7280', fontWeight: 500, fontSize: 11 }}>
        {label}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <Typography variant="caption" sx={{ color: muted ? '#9ca3af' : '#374151', fontWeight: 600, fontSize: 11 }}>
          {fmtTokens(tokens)}
        </Typography>
        <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 10 }}>·</Typography>
        <Typography variant="caption" sx={{ color: '#ec4899', fontWeight: 700, fontSize: 11 }}>
          {fmtCost(cost)}
        </Typography>
      </Stack>
    </Stack>
  );
}

// ── Model breakdown rows ──────────────────────────────────────────────────────
function ModelBreakdown({ models }) {
  const entries = Object.entries(models || {})
    .sort(([, a], [, b]) => b.total_tokens - a.total_tokens)
    .slice(0, 4);

  if (entries.length === 0) return null;

  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" sx={{ color: '#9ca3af', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        By Model (30d)
      </Typography>
      <Stack spacing={0.25} mt={0.5}>
        {entries.map(([model, data]) => (
          <Stack key={model} direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 10, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model}
            </Typography>
            <Typography variant="caption" sx={{ color: '#ec4899', fontWeight: 600, fontSize: 10 }}>
              {fmtCost(data.cost_usd)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TokenCostMonitor({ iconOnly }) {
  const [stats,     setStats]     = useState(EMPTY_STATS);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);
  const [expanded,  setExpanded]  = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const intervalRef = useRef(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${PYTHON_API}/token-stats`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
      setError(false);
      setLastFetch(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchStats();
    intervalRef.current = setInterval(() => {
      if (!document.hidden) fetchStats();
    }, POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchStats]);

  const { today, week, month, models, source, langsmith_project } = stats;
  const isLangSmith = source === 'langsmith';
  const hasData     = (month?.total_tokens || 0) > 0;

  // ── Icon-only mode ────────────────────────────────────────────────────────
  if (iconOnly) {
    const tipText = error
      ? 'Token monitor: backend unreachable'
      : loading
        ? 'Loading token stats…'
        : `Today: ${fmtTokens(today?.total_tokens)} · ${fmtCost(today?.cost_usd)}\nWeek: ${fmtTokens(week?.total_tokens)} · ${fmtCost(week?.cost_usd)}`;

    return (
      <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tipText}</span>} placement="right" arrow>
        <Box
          sx={{
            width: 40, height: 40, borderRadius: 1.5, mx: 'auto', mb: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: error ? '#fef2f2' : hasData ? '#fdf2f8' : 'transparent',
            color:   error ? '#ef4444' : hasData  ? '#ec4899' : '#9ca3af',
            cursor: 'default',
            position: 'relative',
          }}
        >
          <Zap size={18} />
          {/* Pulse dot — green when live, red when error */}
          <Box sx={{
            position: 'absolute', top: 6, right: 6,
            width: 6, height: 6, borderRadius: '50%',
            bgcolor: error ? '#ef4444' : isLangSmith ? '#10b981' : '#94a3b8',
          }} />
        </Box>
      </Tooltip>
    );
  }

  // ── Full sidebar mode ─────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        mx: 1, mb: 1.5,
        border: '1px solid #f3e8ff',
        borderRadius: 2,
        bgcolor: '#fdf8ff',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <Stack
        direction="row" alignItems="center" justifyContent="space-between"
        sx={{ px: 1.5, pt: 1.25, pb: expanded ? 0 : 1.25, cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{
            width: 24, height: 24, borderRadius: 1, flexShrink: 0,
            bgcolor: '#f3e8ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={13} color="#7c3aed" />
          </Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#374151', lineHeight: 1 }}>
            Token Cost
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.5}>
          {/* Refresh button */}
          <Tooltip title="Refresh" arrow>
            <IconButton
              size="small"
              onClick={e => { e.stopPropagation(); fetchStats(); }}
              sx={{ p: 0.25, color: '#9ca3af', '&:hover': { color: '#7c3aed', bgcolor: '#f3e8ff' } }}
            >
              <RefreshCw size={11} />
            </IconButton>
          </Tooltip>
          {expanded ? <ChevronUp size={13} color="#9ca3af" /> : <ChevronDown size={13} color="#9ca3af" />}
        </Stack>
      </Stack>

      {/* Always-visible today row */}
      <Box sx={{ px: 1.5, pb: expanded ? 0 : 1.25 }}>
        {loading ? (
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 11 }}>Loading…</Typography>
        ) : error ? (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <WifiOff size={11} color="#ef4444" />
            <Typography variant="caption" sx={{ color: '#ef4444', fontSize: 11 }}>Backend unreachable</Typography>
          </Stack>
        ) : (
          <Row label="Today" tokens={today?.total_tokens} cost={today?.cost_usd} />
        )}
      </Box>

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Divider sx={{ my: 0.75, borderColor: '#f3e8ff' }} />

          <Stack spacing={0.5}>
            <Row label="This week"  tokens={week?.total_tokens}  cost={week?.cost_usd} />
            <Row label="This month" tokens={month?.total_tokens} cost={month?.cost_usd} muted />
          </Stack>

          {/* Run counts */}
          <Stack direction="row" justifyContent="space-between" mt={0.75}>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 10 }}>
              Today · {fmtRuns(today?.runs)}
            </Typography>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 10 }}>
              Week · {fmtRuns(week?.runs)}
            </Typography>
          </Stack>

          {/* Model breakdown */}
          {Object.keys(models || {}).length > 0 && (
            <>
              <Divider sx={{ my: 0.75, borderColor: '#f3e8ff' }} />
              <ModelBreakdown models={models} />
            </>
          )}

          {/* Source badge */}
          <Divider sx={{ my: 0.75, borderColor: '#f3e8ff' }} />
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Chip
              icon={isLangSmith
                ? <Wifi size={9} />
                : <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#94a3b8', display: 'inline-block', ml: 0.5 }} />
              }
              label={isLangSmith
                ? (langsmith_project ? `LangSmith · ${langsmith_project}` : 'LangSmith')
                : 'Local tracking'
              }
              size="small"
              sx={{
                height: 18, fontSize: 9, fontWeight: 600,
                bgcolor: isLangSmith ? '#ecfdf5' : '#f9fafb',
                color:   isLangSmith ? '#065f46' : '#6b7280',
                border:  `1px solid ${isLangSmith ? '#a7f3d0' : '#e5e7eb'}`,
                '& .MuiChip-icon': { color: isLangSmith ? '#10b981' : '#9ca3af', ml: 0.5 },
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
            {lastFetch && (
              <Typography variant="caption" sx={{ color: '#d1d5db', fontSize: 9 }}>
                {lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}
