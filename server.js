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
 *
 * NOTE: Telegram's reaction field shape may vary by API version.
 * This server attempts to be robust: it looks for reactions in several places.
 */
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // URL to POST results
const SECRET = process.env.WEBHOOK_SECRET || ''; // optional secret to verify source

function extractBarcode(text) {
  if (!text) return null;
  const m = text.match(/(\d{11,13})/);
  return m ? m[1] : null;
}

// Determine final status and the "last reactor" based on update object.
// Priority rule (as requested):
//  - If any 👍 present => status = "Найдено"
//  - Else if any 👎 present => status = "Не найдено"
// Additionally: in column I we must write the last reactor's name (last reaction event)
function analyzeReactionsFromUpdate(update) {
  // Try several locations where reactions may appear
  const candidates = [];
  let reactions = null;

  // Common places:
  if (update.message && update.message.reactions) reactions = update.message.reactions;
  if (!reactions && update.edited_message && update.edited_message.reactions) reactions = update.edited_message.reactions;
  if (!reactions && update.message && update.message.html) {
    // fallback: no reactions object; some bots may receive reaction events separately
    reactions = null;
  }

  // If Telegram sends reaction events separately, try update.messageReaction or update.reaction
  if (!reactions && update.messageReaction) reactions = update.messageReaction.reactions;
  if (!reactions && update.reaction) reactions = update.reaction;

  // If still no 'reactions' array, try to look for 'entities' or 'caption_entities' (unlikely to hold reactions)
  if (!reactions) {
    // No reactions array; try heuristic: if update has 'from' and 'reaction' fields (custom)
    if (update.reaction && update.reaction.emoji) {
      reactions = [ { emoji: update.reaction.emoji, actor: update.from || update.user || null } ];
    } else {
      reactions = null;
    }
  }

  // If there is a 'reactions' array, normalize into {emoji, actor, date} entries
  if (Array.isArray(reactions)) {
    reactions.forEach(r => {
      // Expected shape guessed: { emoji: '👍', actor: { first_name, last_name, username }, date: ... }
      const emoji = r.emoji || r.type || '';
      const actor = r.actor || r.user || r.from || {};
      const name = actor.last_name ? `${actor.last_name}` : (actor.username ? actor.username : (actor.first_name || 'Неизвестно'));
      const ts = r.date || r.time || null;
      candidates.push({ emoji, name, ts });
    });
  }

  // If the update itself represents a single reaction event:
  if (!candidates.length && update.reaction && update.from) {
    const emoji = update.reaction.emoji || '';
    const actor = update.from;
    const name = actor.last_name ? `${actor.last_name}` : (actor.username ? actor.username : (actor.first_name || 'Неизвестно'));
    candidates.push({ emoji, name, ts: update.date || null });
  }

  if (!candidates.length) return null;

  // determine if any 👍 or 👎 exist among candidates
  const hasLike = candidates.some(c => c.emoji && c.emoji.indexOf('👍') !== -1);
  const hasDislike = candidates.some(c => c.emoji && (c.emoji.indexOf('👎') !== -1 || c.emoji.toLowerCase().indexOf('dislike') !== -1));

  // Determine last reaction by ts if available, otherwise by array order (last element)
  candidates.sort((a,b) => {
    if (a.ts && b.ts) return a.ts - b.ts;
    return 0;
  });
  const last = candidates[candidates.length - 1];

  // Final status according to priority (but column I must contain last reactor)
  let finalStatus = null;
  if (hasLike) finalStatus = 'Найдено';
  else if (hasDislike) finalStatus = 'Не найдено';
  else finalStatus = null;

  return { status: finalStatus, lastReactor: last ? last.name : 'Неизвестно', candidates };
}

app.post('/webhook', async (req, res) => {
  try {
    // Optional simple secret check
    if (SECRET) {
      const header = req.get('x-webhook-secret') || '';
      if (header !== SECRET) {
        return res.status(401).send('Invalid secret');
      }
    }

    const update = req.body;
    // Determine where message text can be
    const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
    const text = message ? (message.text || message.caption || '') : '';
    const barcode = extractBarcode(text);
    if (!barcode) {
      // nothing to do
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
      chatId: message.chat ? message.chat.id : null,
      messageId: message.message_id || null
    };

    // POST to Apps Script
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
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
