import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { workflowsApi } from '../services/api.js';

// ── MUI ──────────────────────────────────────────────────────────────────────
import Box            from '@mui/material/Box';
import Stack          from '@mui/material/Stack';
import Typography     from '@mui/material/Typography';
import Button         from '@mui/material/Button';
import IconButton     from '@mui/material/IconButton';
import Card           from '@mui/material/Card';
import CardContent    from '@mui/material/CardContent';
import CardActions    from '@mui/material/CardActions';
import Grid           from '@mui/material/Grid';
import Tabs           from '@mui/material/Tabs';
import Tab            from '@mui/material/Tab';
import Chip           from '@mui/material/Chip';
import Divider        from '@mui/material/Divider';
import Tooltip        from '@mui/material/Tooltip';

// ── Icons ─────────────────────────────────────────────────────────────────────
import {
  GitBranch, Plus, Trash2, Play, Copy,
  Edit, Layers, Clock, Cpu, ArrowRight,
} from 'lucide-react';

import RunModal from '../components/WorkflowNode/RunModal.jsx';

// ── Brand palette (matches the rest of the app) ───────────────────────────────
const C = {
  brand:      '#ec4899',
  brandDark:  '#db2777',
  brandLight: '#fdf2f8',
  brandBg:    '#fce7f3',
  purple:     '#7c3aed',
  purpleBg:   '#f3e8ff',
  border:     '#e5e7eb',
  bg:         '#f9fafb',
  text:       '#111827',
  muted:      '#6b7280',
  faint:      '#9ca3af',
};

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tab, setTab]             = useState(0);   // 0 = mine | 1 = templates
  const [runTarget, setRunTarget] = useState(null);

  const load = async () => {
    try {
      const [mine, tmpl] = await Promise.all([
        workflowsApi.list({ template: 'false' }),
        workflowsApi.list({ template: 'true'  }),
      ]);
      setWorkflows(mine);
      setTemplates(tmpl);
    } catch (_) {}
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete workflow?')) return;
    try {
      await workflowsApi.delete(id);
      toast.success('Workflow deleted');
      load();
    } catch (_) { toast.error('Failed to delete'); }
  };

  const handleClone = async (id, name) => {
    try {
      const w = await workflowsApi.clone(id, `${name} (Copy)`);
      toast.success('Workflow cloned');
      navigate(`/workflows/${w.id}/edit`);
    } catch (_) { toast.error('Failed to clone'); }
  };

  const shown = tab === 0 ? workflows : templates;

  return (
    /**
     * Fill the flex-column <main> from Layout exactly — no overflow here;
     * the inner scrollable body handles it.
     */
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: C.bg }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: 'white', borderBottom: `1px solid ${C.border}`, px: 3, py: 2.5, flexShrink: 0 }}>

        {/* Title row */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>

          {/* Icon + title */}
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{
              width: 44, height: 44, borderRadius: 2.5, flexShrink: 0,
              bgcolor: C.purpleBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <GitBranch size={22} color={C.purple} />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
                Workflows
              </Typography>
              <Typography variant="body2" sx={{ color: C.muted, mt: 0.25 }}>
                Build and manage multi-agent automation workflows
              </Typography>
            </Box>
          </Stack>

          {/* Stats + New button */}
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>

            {/* Stat strip (hidden on xs) */}
            <Box sx={{
              display: { xs: 'none', sm: 'flex' },
              alignItems: 'center', gap: 1.5,
              px: 1.75, py: 0.875,
              border: `1px solid ${C.border}`, borderRadius: 1.5, bgcolor: C.bg,
            }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Cpu size={13} color={C.purple} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: C.text }}>{workflows.length}</Typography>
                <Typography variant="caption" sx={{ color: C.muted }}>mine</Typography>
              </Stack>
              <Divider orientation="vertical" flexItem sx={{ my: 0.25 }} />
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Layers size={13} color="#2563eb" />
                <Typography variant="caption" sx={{ fontWeight: 700, color: C.text }}>{templates.length}</Typography>
                <Typography variant="caption" sx={{ color: C.muted }}>templates</Typography>
              </Stack>
            </Box>

            <Button
              component={Link}
              to="/workflows/new"
              variant="contained"
              size="small"
              startIcon={<Plus size={15} />}
              sx={{
                bgcolor: C.brand, '&:hover': { bgcolor: C.brandDark },
                textTransform: 'none', fontWeight: 600,
                borderRadius: 1.5, px: 2,
              }}
            >
              New Workflow
            </Button>
          </Stack>
        </Stack>

        {/* Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            mt: 1.5, minHeight: 38,
            '& .MuiTabs-indicator': { bgcolor: C.brand },
            '& .MuiTab-root': {
              textTransform: 'none', fontWeight: 500, fontSize: 14,
              minHeight: 38, py: 0.5, px: 2, color: C.muted,
              '&.Mui-selected': { color: C.brandDark, fontWeight: 600 },
            },
          }}
        >
          {[
            { label: 'My Workflows', count: workflows.length },
            { label: 'Templates',    count: templates.length  },
          ].map(({ label, count }, i) => (
            <Tab
              key={label}
              label={
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <span>{label}</span>
                  <Chip
                    label={count}
                    size="small"
                    sx={{
                      height: 18, fontSize: 10, fontWeight: 700,
                      bgcolor: tab === i ? C.brandBg : '#f3f4f6',
                      color:   tab === i ? C.brandDark : C.muted,
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                </Stack>
              }
            />
          ))}
        </Tabs>
      </Box>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3, minHeight: 0 }}>

        {shown.length === 0 ? (
          /* Empty state */
          <Box sx={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            minHeight: 340, textAlign: 'center',
          }}>
            <Box sx={{
              width: 64, height: 64, borderRadius: 3, mb: 2,
              bgcolor: C.purpleBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
            }}>
              {tab === 1 ? <Layers size={28} color={C.purple} /> : <GitBranch size={28} color={C.purple} />}
            </Box>

            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1f2937', mb: 0.5 }}>
              {tab === 0 ? 'No workflows yet' : 'No templates available'}
            </Typography>
            <Typography variant="body2" sx={{ color: C.faint, mb: 3, maxWidth: 280 }}>
              {tab === 0
                ? 'Create your first workflow to start automating multi-agent tasks.'
                : 'Check back later — templates will appear here once added.'}
            </Typography>

            {tab === 0 && (
              <Button
                component={Link}
                to="/workflows/new"
                variant="contained"
                startIcon={<Plus size={15} />}
                endIcon={<ArrowRight size={15} />}
                sx={{
                  bgcolor: C.brand, '&:hover': { bgcolor: C.brandDark },
                  textTransform: 'none', fontWeight: 600, borderRadius: 1.5,
                }}
              >
                Create your first workflow
              </Button>
            )}
          </Box>
        ) : (
          <Grid container spacing={2.5}>
            {shown.map(wf => (
              <Grid item xs={12} sm={6} xl={4} key={wf.id}>
                <WorkflowCard
                  wf={wf}
                  isTemplate={tab === 1}
                  onRun={()    => setRunTarget(wf)}
                  onClone={()  => handleClone(wf.id, wf.name)}
                  onDelete={()  => handleDelete(wf.id)}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/*
       * RunModal is rendered via createPortal directly into document.body.
       * This places it OUTSIDE the sidebar's MUI stacking context (z-index 1200)
       * so its own zIndex: 1300 wins cleanly at the document-root level.
       */}
      {runTarget && createPortal(
        <RunModal workflow={runTarget} onClose={() => setRunTarget(null)} />,
        document.body,
      )}
    </Box>
  );
}

// ── Workflow card ─────────────────────────────────────────────────────────────
function WorkflowCard({ wf, isTemplate, onRun, onClone, onDelete }) {
  const nodeCount = wf.nodes?.length  || 0;
  const edgeCount = wf.edges?.length  || 0;

  return (
    <Card
      elevation={0}
      sx={{
        border: `1px solid ${C.border}`, borderRadius: 2.5,
        height: '100%', display: 'flex', flexDirection: 'column',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        '&:hover': { boxShadow: '0 4px 18px rgba(0,0,0,0.09)', borderColor: '#d1d5db' },
      }}
    >
      <CardContent sx={{ flex: 1, p: 2.5, pb: 1.5 }}>

        {/* Header */}
        <Stack direction="row" spacing={1.5} alignItems="flex-start" mb={2}>
          <Box sx={{
            width: 42, height: 42, borderRadius: 2, flexShrink: 0,
            background: `linear-gradient(135deg, ${C.purpleBg} 0%, ${C.brandLight} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isTemplate ? <Layers size={18} color={C.purple} /> : <GitBranch size={18} color={C.purple} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{ fontWeight: 600, color: C.text, lineHeight: 1.3, mb: 0.25 }}
            >
              {wf.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: C.faint, lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}
            >
              {wf.description || 'No description provided'}
            </Typography>
          </Box>
        </Stack>

        {/* Meta chips */}
        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          {[
            { icon: <Cpu size={10} />,        label: `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}` },
            { icon: <ArrowRight size={10} />, label: `${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'}` },
            ...(wf.trigger_type ? [{ icon: <Clock size={10} />, label: wf.trigger_type }] : []),
          ].map(({ icon, label }) => (
            <Chip
              key={label}
              icon={icon}
              label={label}
              size="small"
              sx={{
                fontSize: 11, height: 22, bgcolor: '#f3f4f6', color: '#4b5563',
                '& .MuiChip-icon': { color: C.muted, ml: 0.75 },
              }}
            />
          ))}
          {isTemplate && (
            <Chip
              label="Template"
              size="small"
              sx={{ fontSize: 11, height: 22, bgcolor: '#dbeafe', color: '#1d4ed8', ml: 'auto' }}
            />
          )}
        </Stack>
      </CardContent>

      <Divider />

      <CardActions sx={{ px: 2, py: 1.25, gap: 1 }}>
        {/* Run */}
        <Button
          onClick={onRun}
          variant="contained"
          size="small"
          startIcon={<Play size={11} />}
          sx={{
            flex: 1,
            bgcolor: C.brand, '&:hover': { bgcolor: C.brandDark },
            textTransform: 'none', fontWeight: 600, fontSize: 12,
            borderRadius: 1.25, py: 0.5,
          }}
        >
          Run
        </Button>

        {isTemplate ? (
          /* Use template */
          <Button
            onClick={onClone}
            variant="outlined"
            size="small"
            startIcon={<Copy size={11} />}
            sx={{
              flex: 1,
              borderColor: C.border, color: '#374151',
              '&:hover': { borderColor: '#d1d5db', bgcolor: C.bg },
              textTransform: 'none', fontWeight: 500, fontSize: 12,
              borderRadius: 1.25, py: 0.5,
            }}
          >
            Use
          </Button>
        ) : (
          <>
            {/* Edit */}
            <Button
              component={Link}
              to={`/workflows/${wf.id}/edit`}
              variant="outlined"
              size="small"
              startIcon={<Edit size={11} />}
              sx={{
                flex: 1,
                borderColor: C.border, color: '#374151',
                '&:hover': { borderColor: '#d1d5db', bgcolor: C.bg },
                textTransform: 'none', fontWeight: 500, fontSize: 12,
                borderRadius: 1.25, py: 0.5,
              }}
            >
              Edit
            </Button>

            {/* Delete */}
            <Tooltip title="Delete workflow" arrow>
              <IconButton
                onClick={onDelete}
                size="small"
                sx={{
                  color: '#ef4444', bgcolor: '#fef2f2',
                  '&:hover': { bgcolor: '#fee2e2' },
                  borderRadius: 1.25, p: 0.75,
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </CardActions>
    </Card>
  );
}
