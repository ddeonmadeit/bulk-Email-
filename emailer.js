'use strict';

/**
 * Bulk Emailer
 * ─────────────────────────────────────────────────────────────────────────────
 * Anti-spam measures implemented:
 *  1. Random per-email delay  (DELAY_MIN_SEC – DELAY_MAX_SEC)
 *  2. Batch breaks            (pause BATCH_BREAK_SEC every BATCH_SIZE emails)
 *  3. Daily / run send limit  (DAILY_LIMIT)
 *  4. List-Unsubscribe header (one-click unsubscribe, required by Gmail/Yahoo)
 *  5. Proper Message-ID       (unique per message)
 *  6. Multipart text + HTML   (plain-text fallback reduces spam score)
 *  7. Personalisation         ({{name}} etc. — identical bulk copies score higher)
 *  8. X-Mailer omitted        (some spam filters penalise known bulk mailers)
 *  9. Full send log           (CSV — lets you skip already-sent on re-runs)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs         = require('fs');
const path       = require('path');
const { parse }  = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const config     = require('./config');

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Resolve a path relative to the project root (where this file lives). */
function projectPath(...parts) {
  return path.resolve(__dirname, ...parts);
}

/** Return a random integer between min and max (inclusive). */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Format seconds as a human-readable string, e.g. "5m 3s". */
function fmtSec(sec) {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** Replace {{placeholders}} in a template string with values from a data map. */
function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

/** Ensure a directory exists, creating it (and parents) if needed. */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Logging ─────────────────────────────────────────────────────────────────

const logFile = projectPath(config.log.file);
ensureDir(logFile);

/** Append one row to the CSV send-log. */
function logResult(row, status, error) {
  const ts     = new Date().toISOString();
  const safe   = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const line   = [ts, row.email, row.name, status, error].map(safe).join(',') + '\n';
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '"timestamp","email","name","status","error"\n');
  }
  fs.appendFileSync(logFile, line);
}

/**
 * Load already-sent email addresses from the log so we can skip them on
 * re-runs (prevents duplicate sends if a run is interrupted and restarted).
 */
function loadSentEmails() {
  if (!fs.existsSync(logFile)) return new Set();
  const raw  = fs.readFileSync(logFile, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  return new Set(
    rows.filter(r => r.status === 'sent').map(r => r.email.toLowerCase())
  );
}

// ─── CSV Loading ─────────────────────────────────────────────────────────────

/**
 * Load contacts from a CSV file.
 *
 * Required column: email
 * Optional columns: name, company, (any other column is available as {{column}})
 *
 * Column headers are trimmed and lowercased for consistent template access.
 */
function loadContacts(csvPath) {
  const resolved = projectPath(csvPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`CSV file not found: ${resolved}`);
  }

  const raw  = fs.readFileSync(resolved, 'utf8');
  const rows = parse(raw, {
    columns:           header => header.map(h => h.trim().toLowerCase()),
    skip_empty_lines:  true,
    trim:              true,
    bom:               true,  // handle files saved with BOM from Excel
  });

  // Validate required column
  if (rows.length > 0 && !('email' in rows[0])) {
    throw new Error('CSV must have an "email" column (case-insensitive).');
  }

  // Filter out rows with no email address
  const valid = rows.filter(r => r.email && r.email.includes('@'));
  console.log(`Loaded ${valid.length} valid contacts (${rows.length - valid.length} skipped).`);
  return valid;
}

// ─── Template Loading ─────────────────────────────────────────────────────────

function loadTemplate(filePath) {
  if (!filePath) return null;
  const resolved = projectPath(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`Warning: template not found: ${resolved}`);
    return null;
  }
  return fs.readFileSync(resolved, 'utf8');
}

// ─── Email Building ───────────────────────────────────────────────────────────

/**
 * Build the nodemailer message object for a single contact.
 *
 * Anti-spam notes baked in here:
 *  - List-Unsubscribe + List-Unsubscribe-Post  (RFC 8058 one-click)
 *  - Precedence: bulk                          (signals bulk but done right)
 *  - Unique Message-ID                         (prevents dedup issues)
 *  - Both text and HTML parts                  (plain-text fallback lowers spam score)
 *  - Subject personalised with recipient name  (reduces identical-message penalties)
 */
function buildMessage(contact, textTmpl, htmlTmpl) {
  const data = {
    ...contact,
    name:            contact.name    || contact.email.split('@')[0],
    company:         contact.company || '',
    subject:         config.email.subject,
    unsubscribe_url: config.email.unsubscribeUrl,
  };

  const subject   = renderTemplate(config.email.subject, data);
  const textBody  = textTmpl ? renderTemplate(textTmpl, data) : undefined;
  const htmlBody  = htmlTmpl ? renderTemplate(htmlTmpl, data) : undefined;

  // Unique Message-ID using timestamp + random suffix + sender domain
  const senderDomain = config.sender.email.split('@')[1] || 'mail.local';
  const msgId = `<${Date.now()}.${randInt(100000, 999999)}@${senderDomain}>`;

  const headers = {
    'Message-ID':                  msgId,
    'Precedence':                  'bulk',
    'X-Auto-Response-Suppress':    'OOF, AutoReply',
  };

  if (config.email.unsubscribeUrl) {
    headers['List-Unsubscribe']      = `<${config.email.unsubscribeUrl}?email=${encodeURIComponent(contact.email)}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return {
    from:    `"${config.sender.name}" <${config.sender.email}>`,
    to:      contact.name
               ? `"${contact.name}" <${contact.email}>`
               : contact.email,
    replyTo: config.sender.replyTo,
    subject,
    text:    textBody,
    html:    htmlBody,
    headers,
  };
}

// ─── SMTP Transport ───────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    ...config.smtp,
    pool:            true,   // reuse connections (more efficient, less suspicious)
    maxConnections:  1,      // single connection — avoids parallel-send red flags
    maxMessages:     100,    // recycle connection every 100 messages
    rateDelta:       1000,   // rate-limiting window (ms)
    rateLimit:       1,      // max messages per rateDelta (nodemailer-level guard)
  });
}

// ─── Preview Mode ─────────────────────────────────────────────────────────────

function runPreview(contacts, textTmpl, htmlTmpl) {
  console.log('\n═══════════════════ PREVIEW MODE ═══════════════════');
  console.log('No emails will be sent. Showing first contact only.\n');

  const contact = contacts[0];
  const msg     = buildMessage(contact, textTmpl, htmlTmpl);

  console.log('To:       ', msg.to);
  console.log('From:     ', msg.from);
  console.log('Subject:  ', msg.subject);
  console.log('Headers:  ', JSON.stringify(msg.headers, null, 2));
  console.log('\n── Text Body ──────────────────────────────────────');
  console.log(msg.text || '(no text template)');
  if (msg.html) {
    console.log('\n── HTML Body (truncated) ──────────────────────────');
    console.log(msg.html.slice(0, 500) + (msg.html.length > 500 ? '…' : ''));
  }
  console.log('\n════════════════════════════════════════════════════\n');
  console.log(`Total contacts loaded: ${contacts.length}`);
  const { timing } = config;
  console.log(`Timing: ${timing.delayMinSec}–${timing.delayMaxSec}s per email, ` +
              `batch break of ${fmtSec(timing.batchBreakSec)} every ${timing.batchSize} emails.`);
  if (timing.dailyLimit > 0)
    console.log(`Run limit: ${timing.dailyLimit} emails.`);
}

// ─── Main Send Loop ───────────────────────────────────────────────────────────

async function run() {
  const isPreview = process.argv.includes('--preview');

  // Load resources
  const contacts  = loadContacts(config.csv.file);
  const textTmpl  = loadTemplate(config.email.templateText);
  const htmlTmpl  = loadTemplate(config.email.templateHtml);

  if (!textTmpl && !htmlTmpl) {
    throw new Error('At least one template (text or HTML) is required. Check TEMPLATE_TEXT / TEMPLATE_HTML in .env.');
  }

  if (isPreview) {
    runPreview(contacts, textTmpl, htmlTmpl);
    return;
  }

  // Skip already-sent addresses
  const alreadySent = loadSentEmails();
  const queue = contacts.filter(c => !alreadySent.has(c.email.toLowerCase()));
  console.log(`${alreadySent.size} already sent (from log). Queued: ${queue.length} recipients.`);

  // Apply daily / run limit
  const { timing } = config;
  const limit       = timing.dailyLimit > 0 ? Math.min(timing.dailyLimit, queue.length) : queue.length;
  const batch       = queue.slice(0, limit);

  if (batch.length === 0) {
    console.log('Nothing to send. All contacts already processed or limit reached.');
    return;
  }

  const transport = createTransport();

  // Verify SMTP credentials before starting
  console.log('Verifying SMTP connection…');
  await transport.verify();
  console.log('SMTP connection OK.\n');

  let sent = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const contact = batch[i];

    // ── Batch break ────────────────────────────────────────────────────────
    if (i > 0 && i % timing.batchSize === 0) {
      console.log(`\n[Batch break] Sent ${i} so far. Pausing ${fmtSec(timing.batchBreakSec)}…`);
      await sleep(timing.batchBreakSec * 1000);
      console.log('Resuming…\n');
    }

    // ── Per-email random delay ─────────────────────────────────────────────
    if (i > 0) {
      const delaySec = randInt(timing.delayMinSec, timing.delayMaxSec);
      process.stdout.write(`  Waiting ${delaySec}s… `);
      await sleep(delaySec * 1000);
    }

    // ── Send ───────────────────────────────────────────────────────────────
    const msg = buildMessage(contact, textTmpl, htmlTmpl);
    const idx = `[${i + 1}/${batch.length}]`;

    try {
      const info = await transport.sendMail(msg);
      sent++;
      logResult(contact, 'sent', '');
      console.log(`${idx} ✓ ${contact.email}  (msgId: ${info.messageId})`);
    } catch (err) {
      failed++;
      logResult(contact, 'failed', err.message);
      console.error(`${idx} ✗ ${contact.email}  ERROR: ${err.message}`);
    }
  }

  transport.close();

  console.log('\n══════════════════════════════════════════');
  console.log(`Done. Sent: ${sent}  Failed: ${failed}  Total: ${batch.length}`);
  console.log(`Log saved to: ${logFile}`);
  console.log('══════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('To retry failed addresses, run again — already-sent emails are skipped automatically.');
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

run().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
