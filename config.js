'use strict';
require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}. Copy .env.example to .env and fill it in.`);
  return val;
}

function optionalInt(key, fallback) {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

module.exports = {
  smtp: {
    host:   required('SMTP_HOST'),
    port:   optionalInt('SMTP_PORT', 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS'),
    },
    // Retry failed connections up to 3 times
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     30_000,
  },

  sender: {
    name:      required('FROM_NAME'),
    email:     required('FROM_EMAIL'),
    replyTo:   process.env.REPLY_TO || required('FROM_EMAIL'),
  },

  email: {
    subject:        required('EMAIL_SUBJECT'),
    templateText:   process.env.TEMPLATE_TEXT   || 'templates/email.txt',
    templateHtml:   process.env.TEMPLATE_HTML   || '',
    unsubscribeUrl: process.env.UNSUBSCRIBE_URL || '',
  },

  csv: {
    file: process.env.CSV_FILE || 'contacts.csv',
  },

  timing: {
    delayMinSec:   optionalInt('DELAY_MIN_SEC', 3),
    delayMaxSec:   optionalInt('DELAY_MAX_SEC', 8),
    batchSize:     optionalInt('BATCH_SIZE', 20),
    batchBreakSec: optionalInt('BATCH_BREAK_SEC', 300),
    dailyLimit:    optionalInt('DAILY_LIMIT', 0),
  },

  log: {
    file: process.env.LOG_FILE || 'logs/send_log.csv',
  },
};
