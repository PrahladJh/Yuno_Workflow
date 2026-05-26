/**
 * Email Routes  —  Nodemailer powered
 * POST /api/email/send          — send email (with optional PDF/file attachments)
 * POST /api/email/schedule      — schedule an email via node-cron
 * GET  /api/email/scheduled     — list pending scheduled emails
 * DELETE /api/email/scheduled/:id — cancel a scheduled email
 * POST /api/email/verify        — test SMTP connection
 */
import { Router }              from 'express';
import nodemailer               from 'nodemailer';
import { existsSync }          from 'fs';
import { basename, extname }   from 'path';
import cron                    from 'node-cron';
import { randomUUID }          from 'crypto';

const router = Router();

// In-memory scheduled email registry  { id: { task, meta } }
const scheduled = new Map();

// ── Transporter factory ───────────────────────────────────────────────────────

function makeTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass || user === 'your@gmail.com') {
    throw new Error(
      'Email not configured. Set EMAIL_USER and EMAIL_PASS in backend/.env'
    );
  }
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT  || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth:   { user, pass },
  });
}

// ── HTML email template ───────────────────────────────────────────────────────

function buildHtml(subject, bodyLines, attachmentNames = []) {
  const rows = bodyLines
    .filter(l => l.trim())
    .map(l => {
      const isHeader  = l.startsWith('##');
      const isBullet  = l.startsWith('•') || l.startsWith('-');
      const isSection = l.startsWith('---') || l.startsWith('===');
      if (isSection)  return `<hr style="border:none;border-top:1px solid #f0f0f0;margin:16px 0">`;
      if (isHeader)   return `<h3 style="color:#be185d;margin:16px 0 8px">${l.replace(/^#+\s*/,'')}</h3>`;
      if (isBullet)   return `<li style="color:#374151;margin:4px 0">${l.replace(/^[•\-]\s*/,'')}</li>`;
      return `<p style="color:#374151;margin:6px 0;line-height:1.6">${l}</p>`;
    })
    .join('\n');

  const attachBadges = attachmentNames.length
    ? `<div style="margin-top:20px">
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Attachments:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${attachmentNames.map(n => `
            <span style="display:inline-flex;align-items:center;gap:6px;
                   background:#fce7f3;color:#be185d;border:1px solid #fbcfe8;
                   border-radius:6px;padding:4px 10px;font-size:12px">
              📎 ${n}
            </span>`).join('')}
        </div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#ec4899,#be185d);
                     padding:24px 32px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:8px">
                    <span style="background:rgba(255,255,255,.2);border-radius:8px;
                                 width:32px;height:32px;display:inline-block;
                                 text-align:center;line-height:32px;font-size:18px">⚡</span>
                    <span style="color:#fff;font-size:20px;font-weight:700;
                                 letter-spacing:-.5px">Yuno AI</span>
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Subject bar -->
        <tr>
          <td style="background:#fdf2f8;border-bottom:1px solid #fce7f3;
                     padding:16px 32px">
            <p style="margin:0;font-size:18px;font-weight:600;color:#111827">${subject}</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px">
            ${rows}
            ${attachBadges}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f0f0f0;
                     padding:16px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              Sent by <strong>Yuno AI Agent</strong> ·
              <a href="#" style="color:#ec4899;text-decoration:none">Powered by AI Orchestration</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Build attachment list from paths ──────────────────────────────────────────

function resolveAttachments(attachments = []) {
  const result = [];
  const names  = [];

  for (const att of attachments) {
    if (typeof att === 'string') {
      // plain path string
      if (existsSync(att)) {
        result.push({ filename: basename(att), path: att });
        names.push(basename(att));
      }
    } else if (att?.path && existsSync(att.path)) {
      result.push({ filename: att.filename || basename(att.path), path: att.path });
      names.push(att.filename || basename(att.path));
    } else if (att?.content && att?.filename) {
      result.push({ filename: att.filename, content: Buffer.from(att.content, 'base64') });
      names.push(att.filename);
    }
  }
  return { result, names };
}

// ── POST /api/email/send ──────────────────────────────────────────────────────

router.post('/send', async (req, res, next) => {
  try {
    const {
      to, cc, bcc, reply_to,
      subject, body, html,
      attachments = [],
      from_name,
    } = req.body;

    if (!to)      return res.status(400).json({ error: '"to" is required' });
    if (!subject) return res.status(400).json({ error: '"subject" is required' });
    if (!body && !html)
      return res.status(400).json({ error: '"body" or "html" is required' });

    const transporter = makeTransporter();
    const { result: mailAtts, names } = resolveAttachments(attachments);

    const bodyLines  = (body || '').split('\n');
    const htmlContent = html || buildHtml(subject, bodyLines, names);
    const fromName    = from_name || process.env.EMAIL_FROM_NAME || 'Yuno AI';

    const info = await transporter.sendMail({
      from:    `"${fromName}" <${process.env.EMAIL_USER}>`,
      to:      Array.isArray(to) ? to.join(', ') : to,
      cc:      cc  ? (Array.isArray(cc)  ? cc.join(', ')  : cc)  : undefined,
      bcc:     bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
      replyTo: reply_to,
      subject,
      text:    body || subject,
      html:    htmlContent,
      attachments: mailAtts,
    });

    res.json({
      success:     true,
      message_id:  info.messageId,
      to:          Array.isArray(to) ? to : [to],
      subject,
      attachments: names,
      preview_url: nodemailer.getTestMessageUrl(info) || null,
    });
  } catch (e) { next(e); }
});

// ── POST /api/email/schedule ──────────────────────────────────────────────────

router.post('/schedule', async (req, res, next) => {
  try {
    const { cron_expression, email } = req.body;
    // email = same shape as /send body

    if (!cron_expression)
      return res.status(400).json({ error: '"cron_expression" is required (e.g. "0 9 * * 1" = every Monday 9am)' });
    if (!cron.validate(cron_expression))
      return res.status(400).json({ error: `Invalid cron expression: "${cron_expression}"` });
    if (!email?.to || !email?.subject)
      return res.status(400).json({ error: '"email.to" and "email.subject" are required' });

    const id   = randomUUID();
    const task = cron.schedule(cron_expression, async () => {
      try {
        const transporter = makeTransporter();
        const { result: mailAtts, names } = resolveAttachments(email.attachments || []);
        const bodyLines = (email.body || '').split('\n');
        const htmlContent = email.html || buildHtml(email.subject, bodyLines, names);
        await transporter.sendMail({
          from:    `"${process.env.EMAIL_FROM_NAME || 'Yuno AI'}" <${process.env.EMAIL_USER}>`,
          to:      Array.isArray(email.to) ? email.to.join(', ') : email.to,
          subject: email.subject,
          text:    email.body || email.subject,
          html:    htmlContent,
          attachments: mailAtts,
        });
        console.log(`[email] Scheduled email sent — id:${id} to:${email.to}`);
      } catch (err) {
        console.error(`[email] Scheduled send failed id:${id}:`, err.message);
      }
    });

    scheduled.set(id, {
      task,
      meta: {
        id,
        cron_expression,
        to:      email.to,
        subject: email.subject,
        created: new Date().toISOString(),
        next_run: new Date(
          // rough next run estimate
          cron.getTasks ? null : null
        ).toISOString(),
      },
    });

    res.json({
      success: true,
      schedule_id: id,
      message: `Email scheduled (${cron_expression}) → ${email.to}`,
    });
  } catch (e) { next(e); }
});

// ── GET /api/email/scheduled ──────────────────────────────────────────────────

router.get('/scheduled', (_req, res) => {
  const list = [...scheduled.values()].map(({ meta }) => meta);
  res.json({ count: list.length, scheduled: list });
});

// ── DELETE /api/email/scheduled/:id ──────────────────────────────────────────

router.delete('/scheduled/:id', (req, res) => {
  const entry = scheduled.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Scheduled email not found' });
  entry.task.stop();
  scheduled.delete(req.params.id);
  res.json({ success: true, message: `Schedule ${req.params.id} cancelled` });
});

// ── POST /api/email/verify ────────────────────────────────────────────────────

router.post('/verify', async (req, res, next) => {
  try {
    const transporter = makeTransporter();
    await transporter.verify();
    res.json({ success: true, user: process.env.EMAIL_USER, message: 'SMTP connection OK' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
