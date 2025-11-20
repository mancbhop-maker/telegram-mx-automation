/**
 * Minimal Telegram webhook server
 * - Extracts barcode from message
 * - Checks reactions 👍 / 👎
 * - Sends result to Google Apps Script
 */

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// Extract 11-13 digit barcode from text
function extractBarcode(text) {
  const match = text?.match(/\d{11,13}/);
  return match ? match[0] : null;
}

// Analyze reactions: 👍 = Найдено, 👎 = Не найдено
function analyzeReactions(update) {
  const reactions = update.message?.reactions || update.edited_message?.reactions || [];
  const candidates = reactions.map(r => ({
    emoji: r.emoji,
    name: r.actor?.last_name || r.actor?.username || r.actor?.first_name || 'Неизвестно',
    ts: r.date || 0
  }));

  if (!candidates.length && update.reaction && update.from) {
    candidates.push({
      emoji: update.reaction.emoji,
      name: update.from.last_name || update.from.username || update.from.first_name || 'Неизвестно',
      ts: update.date || 0
    });
  }

  if (!candidates.length) return null;

  const hasLike = candidates.some(c => c.emoji?.includes('👍'));
  const hasDislike = candidates.some(c => c.emoji?.includes('👎'));

  candidates.sort((a,b) => a.ts - b.ts);
  const last = candidates[candidates.length-1];

  let status = null;
  if (hasLike) status = 'Найдено';
  else if (hasDislike) status = 'Не найдено';

  return { status, lastReactor: last?.name ?? 'Неизвестно' };
}

// Webhook endpoint
app.post('/webhook', async (req,res) => {
  console.log("UPDATE RECEIVED:", JSON.stringify(req.body, null, 2));

  const message = req.body.message || req.body.edited_message;
  const text = message?.text || message?.caption || '';
  const barcode = extractBarcode(text);
  if (!barcode) return res.status(200).send('no barcode');

  const analysis = analyzeReactions(req.body);
  if (!analysis?.status) return res.status(200).send('no relevant reaction');

  const payload = {
    barcode,
    status: analysis.status,
    user: analysis.lastReactor,
    chatId: message.chat?.id || null,
    messageId: message.message_id || null
  };

  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.status(200).send('ok');
  } catch(e) {
    console.error(e);
    return res.status(500).send('error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));
