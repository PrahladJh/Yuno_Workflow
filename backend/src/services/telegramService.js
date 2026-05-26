/**
 * telegramService.js — Telegram bot with conversational PDF form-filling.
 *
 * PDF flow (mirrors the web UI):
 *   1. User sends a PDF document
 *   2. Bot downloads it, saves to temp, detects form fields via Python backend
 *   3. Shows field overview → asks "1 = one-by-one, 2 = all at once"
 *   4. Collects values conversationally
 *   5. Sends the JSON fill-data to the agent → agent fills PDF → bot sends back the file
 *
 * State machine per chat_id (stored in pdfSessions Map):
 *   awaiting_mode  → PDF uploaded; waiting for 1 or 2
 *   one-by-one     → asking each field question in sequence
 *   all-at-once    → waiting for the user to send key: value lines
 *   free_text      → PDF uploaded but no fields found; next message → agent
 */

import TelegramBot     from 'node-telegram-bot-api';
import axios           from 'axios';
import { writeFile }   from 'fs/promises';
import { tmpdir }      from 'os';
import { join }        from 'path';
import { randomUUID }  from 'crypto';
import { getDb }       from '../db/database.js';
import { executeAgentDirect } from './executionService.js';
import { getIO }       from '../websocket/socketServer.js';
import sql             from 'mssql';

const RUNTIME_URL = process.env.PYTHON_RUNTIME_URL || 'http://localhost:8000';

let bot             = null;
let botToken        = null;
let botStatus       = { running: false, username: null, error: null };
let activeChannelId = null;
let activeAgentId   = null;

// ── Per-chat PDF session state ────────────────────────────────────────────────
// session = {
//   state        : 'awaiting_mode' | 'one-by-one' | 'all-at-once' | 'free_text'
//   pdfPath      : string   (temp file path accessible by Python)
//   pdfFilename  : string
//   questions    : [{ key, type:'text'|'checkbox', options?:[] }]
//   qIdx         : number   (current index in one-by-one mode)
//   fieldValues  : {}       (label → value, accumulated)
// }
const pdfSessions = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

export function getTelegramStatus() {
  return { ...botStatus };
}

export async function startTelegramBot(token, agentId, channelId) {
  if (bot) { bot.stopPolling(); bot = null; }

  botToken        = token;
  botStatus       = { running: false, username: null, error: null };
  activeChannelId = channelId;
  activeAgentId   = agentId;
  pdfSessions.clear();

  bot = new TelegramBot(token, { polling: true });
  const info = await bot.getMe();
  botStatus = { running: true, username: info.username, error: null };
  console.log(`[Telegram] @${info.username} started`);

  bot.on('message', async (msg) => {
    const chatId  = String(msg.chat.id);
    const text    = (msg.text || '').trim();
    const sender  = msg.from?.username || msg.from?.first_name || 'user';

    try {
      // /start
      if (text === '/start') {
        await bot.sendMessage(chatId,
          '👋 Hello! Send me a message or upload a PDF to get started.\n\n' +
          '📄 Upload a PDF with form fields and I will guide you through filling every field.'
        );
        return;
      }

      // /cancel — abort any ongoing PDF session
      if (text === '/cancel') {
        if (pdfSessions.has(chatId)) {
          pdfSessions.delete(chatId);
          await bot.sendMessage(chatId, '❌ PDF filling cancelled. Send me anything to continue.');
        } else {
          await bot.sendMessage(chatId, 'Nothing to cancel.');
        }
        return;
      }

      const session = pdfSessions.get(chatId);

      // ── PDF document upload ──────────────────────────────────────────────
      if (msg.document) {
        const mime = msg.document.mime_type || '';
        if (mime === 'application/pdf' || msg.document.file_name?.toLowerCase().endsWith('.pdf')) {
          // Starting a new PDF — clear any stale session
          if (session) pdfSessions.delete(chatId);
          await handlePdfUpload(msg, chatId, sender);
          return;
        }
        // Other document types — fall through to normal agent handling
      }

      // ── Active PDF session ───────────────────────────────────────────────
      if (session) {
        await handleSessionMessage(text, chatId, session, sender);
        return;
      }

      // ── Normal text → agent ──────────────────────────────────────────────
      if (text) {
        await handleNormalMessage(text, chatId, sender);
      }

    } catch (err) {
      console.error(`[Telegram] Error in chat ${chatId}:`, err.message);
      try { await bot.sendMessage(chatId, `❌ Error: ${err.message}`); } catch (_) {}
    }
  });

  bot.on('polling_error', err => {
    if (err.code !== 'ETELEGRAM') {
      console.error('[Telegram] Polling error:', err.message);
      botStatus.error = err.message;
    }
  });

  return info;
}

export function stopTelegramBot() {
  if (bot) {
    bot.stopPolling();
    bot = null;
    botStatus = { running: false, username: null, error: null };
    pdfSessions.clear();
  }
}

// ── PDF upload + field detection ──────────────────────────────────────────────

async function handlePdfUpload(msg, chatId, sender) {
  const doc = msg.document;
  const filename = doc.file_name || 'document.pdf';

  await bot.sendMessage(chatId,
    `📄 Received *${filename}* — scanning for form fields…`,
    { parse_mode: 'Markdown' }
  );
  await bot.sendChatAction(chatId, 'typing');

  // 1. Download the PDF from Telegram servers
  const fileInfo = await bot.getFile(doc.file_id);
  const fileUrl  = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
  const pdfRes   = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });

  // 2. Save to a temp file so the Python backend can access it by path
  const tempPath = join(tmpdir(), `tg_${randomUUID()}.pdf`);
  await writeFile(tempPath, Buffer.from(pdfRes.data));

  // 3. Detect form fields via Python backend
  let fields = [], checkboxes = [];
  try {
    const detectRes = await axios.post(
      `${RUNTIME_URL}/pdf/detect-fields`,
      { path: tempPath },
      { timeout: 90000 }
    );
    const rawFields     = detectRes.data.fields     || [];
    const rawCheckboxes = detectRes.data.checkboxes || [];

    fields    = rawFields.filter(f => isRealLabel(f.label));
    checkboxes = rawCheckboxes
      .filter(cb => isRealLabel(cb.label))
      .map(cb => ({ ...cb, options: cb.options.filter(o => isRealOption(o.text)) }))
      .filter(cb => cb.options.length >= 2);
  } catch (detectErr) {
    console.warn('[Telegram] Field detection failed:', detectErr.message);
    // Detection endpoint unreachable — continue with free-text mode
  }

  const total = fields.length + checkboxes.length;

  if (total === 0) {
    // No fields — agent will handle it conversationally
    await bot.sendMessage(chatId,
      `⚠ No fillable fields detected in *${filename}*.\n\n` +
      `Describe what you'd like to fill and I'll do my best.`,
      { parse_mode: 'Markdown' }
    );
    pdfSessions.set(chatId, {
      state: 'free_text',
      pdfPath: tempPath,
      pdfFilename: filename,
      questions: [],
      qIdx: 0,
      fieldValues: {},
    });
    return;
  }

  // 4. Build question list
  const questions = [
    ...fields.map(f => ({ key: f.label, type: 'text' })),
    ...checkboxes.map(cb => ({
      key:     cb.label,
      type:    'checkbox',
      options: cb.options.map(o => o.text),
    })),
  ];

  // 5. Show field overview
  let overview = `✅ Found *${total} fillable field${total !== 1 ? 's' : ''}* in *${filename}*\n\n`;
  if (fields.length) {
    overview += `📝 *Text fields (${fields.length}):*\n`;
    const preview = fields.slice(0, 15).map(f => `  • ${f.label}`).join('\n');
    overview += preview;
    if (fields.length > 15) overview += `\n  … and ${fields.length - 15} more`;
    overview += '\n\n';
  }
  if (checkboxes.length) {
    overview += `☑ *Choice fields (${checkboxes.length}):*\n`;
    overview += checkboxes.map(cb => `  • ${cb.label}: ${cb.options.join(' / ')}`).join('\n');
    overview += '\n\n';
  }
  overview +=
    `How would you like to fill them?\n\n` +
    `Reply *1* — One by one _(I ask each field, you answer)_\n` +
    `Reply *2* — All at once _(send all values in one message)_\n\n` +
    `_(Send /cancel at any time to abort)_`;

  await bot.sendMessage(chatId, overview, { parse_mode: 'Markdown' });

  // 6. Store session
  pdfSessions.set(chatId, {
    state:      'awaiting_mode',
    pdfPath:    tempPath,
    pdfFilename: filename,
    questions,
    qIdx:       0,
    fieldValues: {},
  });
}

// ── Session message routing ───────────────────────────────────────────────────

async function handleSessionMessage(text, chatId, session, sender) {
  switch (session.state) {

    // ── User picks fill mode ─────────────────────────────────────────────
    case 'awaiting_mode': {
      if (text === '1') {
        session.state = 'one-by-one';
        session.qIdx  = 0;
        pdfSessions.set(chatId, session);
        await askNextField(chatId, session);
      } else if (text === '2') {
        session.state = 'all-at-once';
        pdfSessions.set(chatId, session);
        await sendAllAtOncePrompt(chatId, session);
      } else {
        await bot.sendMessage(chatId,
          'Please reply *1* for one-by-one or *2* for all at once.',
          { parse_mode: 'Markdown' }
        );
      }
      break;
    }

    // ── Answer one field at a time ───────────────────────────────────────
    case 'one-by-one': {
      const q = session.questions[session.qIdx];
      if (!q) { await submitFields(chatId, session, sender); return; }

      const answer = text.trim();

      if (answer && answer.toLowerCase() !== 'skip') {
        // Checkbox: user may type "1", "2", or the option text
        if (q.type === 'checkbox') {
          const numChoice = parseInt(answer, 10);
          if (!isNaN(numChoice) && numChoice >= 1 && numChoice <= q.options.length) {
            session.fieldValues[q.key] = q.options[numChoice - 1];
          } else {
            // Try to find matching option (case-insensitive)
            const match = q.options.find(o => o.toLowerCase() === answer.toLowerCase());
            if (match) session.fieldValues[q.key] = match;
            else        session.fieldValues[q.key] = answer; // store raw if no match
          }
        } else {
          session.fieldValues[q.key] = answer;
        }
      }

      session.qIdx += 1;
      pdfSessions.set(chatId, session);

      if (session.qIdx < session.questions.length) {
        await askNextField(chatId, session);
      } else {
        await submitFields(chatId, session, sender);
      }
      break;
    }

    // ── User sends bulk values ───────────────────────────────────────────
    case 'all-at-once': {
      const values = parseAllAtOnce(text, session.questions);
      if (Object.keys(values).length === 0) {
        await bot.sendMessage(chatId,
          '⚠ Could not parse any values. Use the format:\n\n' +
          '`Field Name: Your Value`\n\nOne per line.',
          { parse_mode: 'Markdown' }
        );
        // Re-show the prompt so the user knows the expected format
        await sendAllAtOncePrompt(chatId, session);
      } else {
        session.fieldValues = values;
        pdfSessions.set(chatId, session);
        await submitFields(chatId, session, sender);
      }
      break;
    }

    // ── PDF with no detected fields — pass through to agent ─────────────
    case 'free_text': {
      if (!text) return;
      const db  = getDb();
      const io  = getIO();
      const agentConfig = await loadAgentConfig(db);
      if (!agentConfig) {
        await bot.sendMessage(chatId, 'No agent configured for this channel.');
        pdfSessions.delete(chatId);
        return;
      }
      await bot.sendChatAction(chatId, 'typing');
      const agentMsg = buildFillMessage(session.pdfPath, session.pdfFilename, null, text);
      const result   = await executeAgentDirect(agentConfig, agentMsg, chatId);
      await sendAgentReply(chatId, result.output || '', db, io, agentConfig);
      pdfSessions.delete(chatId);
      break;
    }
  }
}

// ── Field prompts ─────────────────────────────────────────────────────────────

async function askNextField(chatId, session) {
  const q   = session.questions[session.qIdx];
  const num = session.qIdx + 1;
  const tot = session.questions.length;

  // ASCII progress bar (10 segments)
  const filled  = Math.floor((session.qIdx / tot) * 10);
  const bar     = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const pct     = Math.round((session.qIdx / tot) * 100);
  const header  = `\`[${bar}]\` ${pct}% · field ${num} of ${tot}`;

  if (q.type === 'checkbox') {
    const opts = q.options.map((o, i) => `  *${i + 1}.* ${o}`).join('\n');
    await bot.sendMessage(chatId,
      `${header}\n\n*${escapeMarkdown(q.key)}*\n\n${opts}\n\n` +
      `_Reply with the number or option name, or_ \`skip\``,
      { parse_mode: 'Markdown' }
    );
  } else {
    await bot.sendMessage(chatId,
      `${header}\n\n*${escapeMarkdown(q.key)}*\n\n_Type your answer, or_ \`skip\` _to leave blank_`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function sendAllAtOncePrompt(chatId, session) {
  const qs = session.questions;

  // Show up to 6 example lines
  const exampleLines = qs
    .slice(0, 6)
    .map(q =>
      q.type === 'checkbox'
        ? `${q.key}: ${q.options[0]}`
        : `${q.key}: (your value)`
    )
    .join('\n');

  // Full list — cap at 25 to stay under Telegram's 4096-char limit
  const SHOW_MAX   = 25;
  const listSlice  = qs.slice(0, SHOW_MAX);
  const listLines  = listSlice
    .map(q =>
      q.type === 'checkbox'
        ? `• *${escapeMarkdown(q.key)}*: ${q.options.join(' / ')}`
        : `• *${escapeMarkdown(q.key)}*`
    )
    .join('\n');
  const overflow = qs.length > SHOW_MAX
    ? `\n_…and ${qs.length - SHOW_MAX} more fields_`
    : '';

  await bot.sendMessage(chatId,
    `Send your values like this \\(one per line\\):\n\n` +
    `\`\`\`\n${exampleLines}\n\`\`\`\n\n` +
    `📋 *All ${qs.length} fields:*\n${listLines}${overflow}\n\n` +
    `_Leave a field out to skip it._`,
    { parse_mode: 'Markdown' }
  );
}

// ── Submit values → agent → filled PDF ───────────────────────────────────────

async function submitFields(chatId, session, sender) {
  const filled = Object.entries(session.fieldValues).filter(([, v]) => v);
  pdfSessions.delete(chatId);   // clear session early so /cancel won't interfere

  if (filled.length === 0) {
    await bot.sendMessage(chatId,
      '⚠ No values were provided. PDF filling cancelled.\n\nSend the PDF again to retry.'
    );
    return;
  }

  const summary = filled.map(([k, v]) => `  • *${escapeMarkdown(k)}*: ${escapeMarkdown(v)}`).join('\n');
  await bot.sendMessage(chatId,
    `✅ *${filled.length} value${filled.length !== 1 ? 's' : ''} collected:*\n\n${summary}\n\n🔄 Filling your PDF — please wait…`,
    { parse_mode: 'Markdown' }
  );
  await bot.sendChatAction(chatId, 'upload_document');

  const db  = getDb();
  const io  = getIO();
  const agentConfig = await loadAgentConfig(db);
  if (!agentConfig) {
    await bot.sendMessage(chatId, '❌ No agent configured for this channel.');
    return;
  }

  const jsonStr  = JSON.stringify(Object.fromEntries(filled), null, 2);
  const agentMsg = buildFillMessage(session.pdfPath, session.pdfFilename, jsonStr, null);

  try {
    const result = await executeAgentDirect(agentConfig, agentMsg, chatId);
    await sendAgentReply(chatId, result.output || '', db, io, agentConfig);
  } catch (err) {
    console.error('[Telegram] Fill error:', err.message);
    await bot.sendMessage(chatId, `❌ Failed to fill PDF: ${err.message}\n\nSend the PDF again to retry.`);
  }
}

// ── Agent message builder ─────────────────────────────────────────────────────

function buildFillMessage(pdfPath, pdfFilename, fillDataJson, userText) {
  if (fillDataJson) {
    return [
      `## PDF Fill Task — Execute Immediately`,
      `File name: ${pdfFilename}`,
      `File path: ${pdfPath}`,
      ``,
      `CRITICAL INSTRUCTIONS — follow exactly:`,
      `1. Do NOT ask the user for any data. Do NOT say "please provide data".`,
      `2. Run detect_pdf_form_fields first to get field positions.`,
      `3. Immediately call fill_pdf_form using the EXACT file path above and the fill data below.`,
      `4. Return the exact DOWNLOAD_PATH line from fill_pdf_form — this is how the bot sends the file.`,
      ``,
      `Fill data (JSON):`,
      fillDataJson,
    ].join('\n');
  }

  return [
    `## Task\n${userText || 'Analyze and fill the PDF form.'}`,
    `File name: ${pdfFilename}`,
    `File path: ${pdfPath}`,
    `If fill data was given, run detect_pdf_form_fields then fill_pdf_form. Return DOWNLOAD_PATH.`,
  ].join('\n\n');
}

// ── Send agent reply to Telegram (handles filled-PDF download) ────────────────

async function sendAgentReply(chatId, output, db, io, agentConfig) {
  const dlMatch = output.match(/DOWNLOAD_PATH\s*:\s*(.+?\.pdf)/i);

  if (dlMatch) {
    // Agent produced a filled PDF
    const filledPath = dlMatch[1].trim();
    const cleanText  = output.replace(/DOWNLOAD_PATH\s*:.+/gi, '').trim();

    // Send any text first
    if (cleanText) {
      await bot.sendMessage(chatId, cleanText);
    }

    // Download the filled PDF from the Python backend and send as document
    try {
      const fileRes = await axios.get(`${RUNTIME_URL}/download`, {
        params:       { path: filledPath },
        responseType: 'arraybuffer',
        timeout:      30000,
      });
      const filename = filledPath.split(/[\\/]/).pop() || 'filled.pdf';

      await bot.sendDocument(
        chatId,
        Buffer.from(fileRes.data),
        { caption: '✅ Here is your filled PDF!' },
        { filename, contentType: 'application/pdf' }
      );
    } catch (dlErr) {
      console.error('[Telegram] Could not send filled PDF:', dlErr.message);
      await bot.sendMessage(chatId,
        `✅ PDF was filled but could not be delivered directly.\n` +
        `File path: \`${filledPath}\``,
        { parse_mode: 'Markdown' }
      );
    }
  } else if (output) {
    // Plain text response — split into chunks if too long (Telegram limit = 4096 chars)
    const chunks = splitMessage(output, 4000);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
    }
  }

  // ── Persist outgoing message to DB ───────────────────────────────────────
  if (output && agentConfig && activeAgentId) {
    try {
      const outId = randomUUID();
      await db.prepare(`
        INSERT INTO messages (id,channel,chat_id,sender,agent_id,direction,content,metadata)
        VALUES (?,'telegram',?,?,?,'outgoing',?,'{}')
      `).run(outId, chatId, agentConfig.name, activeAgentId, output.slice(0, 2000));
      io.emit('message:new', {
        id: outId, channel: 'telegram', direction: 'outgoing',
        sender: agentConfig.name, content: output, chat_id: chatId,
      });
    } catch (_) {}
  }
}

// ── Normal text message → agent ───────────────────────────────────────────────

async function handleNormalMessage(text, chatId, sender) {
  const db = getDb();
  const io = getIO();

  // Persist incoming
  const inId = randomUUID();
  try {
    await db.prepare(`
      INSERT INTO messages (id,channel,chat_id,sender,agent_id,direction,content,metadata)
      VALUES (?,'telegram',?,?,?,'incoming',?,'{}')
    `).run(inId, chatId, sender, activeAgentId, text);
    io.emit('message:new', { id: inId, channel: 'telegram', direction: 'incoming', sender, content: text, chat_id: chatId });
  } catch (_) {}

  const agentConfig = await loadAgentConfig(db);
  if (!agentConfig) {
    await bot.sendMessage(chatId, 'No agent configured for this channel. Set one up in the dashboard.');
    return;
  }

  // Load conversation history
  const historyKey = `telegram_history_${chatId}`;
  let history = [];
  try {
    const histRow = await db.prepare(
      'SELECT value FROM agent_memory WHERE agent_id = ? AND memory_key = ?'
    ).get(activeAgentId, historyKey);
    if (histRow) history = JSON.parse(histRow.value);
  } catch (_) {}

  try {
    await bot.sendChatAction(chatId, 'typing');
    const result = await executeAgentDirect(agentConfig, text, chatId);
    const reply  = result.output || 'Processed, but no response to send.';

    // Save updated history
    history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    const trimmed = history.slice(-20);
    try {
      const p = db.pool;
      if (p) {
        await p.request()
          .input('id',       sql.NVarChar, randomUUID())
          .input('agent_id', sql.NVarChar, activeAgentId)
          .input('mkey',     sql.NVarChar, historyKey)
          .input('value',    sql.NVarChar, JSON.stringify(trimmed))
          .input('mem_type', sql.NVarChar, 'conversation')
          .query(`
            MERGE INTO agent_memory WITH (HOLDLOCK) AS t
            USING (VALUES (@agent_id,@mkey)) AS s(agent_id,memory_key)
              ON t.agent_id = s.agent_id AND t.memory_key = s.memory_key
            WHEN MATCHED THEN UPDATE SET value = @value, updated_at = GETDATE()
            WHEN NOT MATCHED THEN INSERT (id,agent_id,memory_key,value,memory_type)
              VALUES (@id,@agent_id,@mkey,@value,@mem_type);
          `);
      }
    } catch (_) {}

    await sendAgentReply(chatId, reply, db, io, agentConfig);

  } catch (err) {
    console.error('[Telegram] Agent error:', err.message);
    await bot.sendMessage(chatId, `Sorry, I ran into an error: ${err.message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadAgentConfig(db) {
  if (!activeAgentId) return null;
  try {
    const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(activeAgentId);
    if (!agent) return null;
    return {
      ...agent,
      tools:         JSON.parse(agent.tools         || '[]'),
      memory_config: JSON.parse(agent.memory_config  || '{}'),
      guardrails:    JSON.parse(agent.guardrails     || '{}'),
    };
  } catch { return null; }
}

// Same quality filters as web UI and Python backend
function isRealLabel(lbl) {
  const s = (lbl || '').trim();
  if (!s || s.length <= 2) return false;
  if (s.startsWith('(') && s.endsWith(')')) return false;
  const alpha = s.replace(/[^a-zA-Z]/g, '');
  if (alpha.length > 5 && alpha === alpha.toUpperCase()) return false;
  return true;
}
const isRealOption = (t) => (t || '').trim().length > 1;

// Parse user's bulk "all-at-once" reply into { fieldLabel: value } map
function parseAllAtOnce(text, questions) {
  const values = {};

  // Try JSON first
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (v) values[k] = String(v);
      }
      return values;
    }
  } catch (_) {}

  // Parse "Key: Value" lines
  for (const line of text.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key && val && val.toLowerCase() !== 'skip') {
      values[key] = val;
    }
  }

  // Fuzzy match checkbox options mentioned anywhere in the text
  if (Object.keys(values).length === 0) {
    const lower = text.toLowerCase();
    for (const q of questions) {
      if (q.type === 'checkbox') {
        for (const opt of q.options) {
          if (lower.includes(opt.toLowerCase())) {
            values[q.key] = opt;
            break;
          }
        }
      }
    }
  }

  return values;
}

// Escape Telegram MarkdownV1 special chars that break formatting
function escapeMarkdown(text) {
  return (text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Split a long string into ≤maxLen chunks at newline boundaries
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current  = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
