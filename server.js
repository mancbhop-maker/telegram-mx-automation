/**
 * Simple Node.js Express webhook server for Telegram updates.
 * - Receives updates from Telegram via webhook
 * - Extracts barcode from message text (11-13 digits)
 * - Determines status using reactions (priority: 👍 then 👎)
 * - Sends POST to Google Apps Script endpoint with {barcode, status, user}
 *
 * Usage:
 *  - copy .env.example -> .env and fill values
 *  - npm install
 *  - run with node server.js (or use PM2)
 */

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

/* 🔥 SECRET BLOCK REMOVED COMPLETELY 
   because Telegram webhook returns 401 when expecting x-webhook-secret
*/

function extractBarcode(text) {
  if (!text) return null;
  const m = text.match(/(\d{11,13})/);
  return m ? m[1] : null;
}

function analyzeReactionsFromUpdate(update) {
  const candidates = [];
  let reactions = null;

  if (update.message?.reactions) reactions = update.message.reactions;
  if (!reactions && update.edited_message?.reactions) reactions = update.edited_message.reactions;

  if (!reactions && update.messageReaction?.reactions)
    reactions = update.messageReaction.reactions;

  if (!reactions && update.reaction)
    reactions = update.reaction;

  if (Array.isArray(reactions)) {
    reactions.forEach(r => {
      const emoji = r.emoji || r.type || '';
      const actor = r.actor || r.user || r.from || {};
      const name =
        actor.last_name ||
        actor.username ||
        actor.first_name ||
        'Неизвестно';
      const ts = r.date || r.time || null;
      candidates.push({ emoji, name, ts });
    });
  }

  if (!candidates.length && update.reaction && update.from) {
    const emoji = update.reaction.emoji;
    const actor = update.from;
    const name =
      actor.last_name ||
      actor.username ||
      actor.first_name ||
      'Неизвестно';
    candidates.push({ emoji, name, ts: update.date || null });
  }

  if (!candidates.length) return null;

  const hasLike = candidates.some(c => c.emoji?.includes('👍'));
  const hasDislike = candidates.some(
    c => c.emoji?.includes('👎') || c.emoji?.toLowerCase().includes('dislike')
  );

  candidates.sort((a, b) => {
    if (a.ts && b.ts) return a.ts - b.ts;
    return 0;
  });

  const last = candidates[candidates.length - 1];

  let finalStatus = null;
  if (hasLike) finalStatus = 'Найдено';
  else if (hasDislike) finalStatus = 'Не найдено';

  return {
    status: finalStatus,
    lastReactor: last?.name ?? 'Неизвестно',
    candidates
  };
}

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    const message =
      update.message ||
      update.edited_message ||
      update.channel_post ||
      update.edited_channel_post;

    const text = message ? message.text || message.caption || '' : '';
    const barcode = extractBarcode(text);

    if (!barcode) {
      return res.status(200).send('no barcode');
    }

    const analysis = analyzeReactionsFromUpdate(update);
    if (!analysis || !analysis.status) {
      return res.status(200).send('no relevant reaction');
    }

    const payload = {
      barcode: barcode,
      status: analysis.status,
      user: analysis.lastReactor,
      chatId: message.chat?.id ?? null,
      messageId: message.message_id ?? null
    };

    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    return res.status(500).send('error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Webhook server listening on port ${PORT}`)
);
