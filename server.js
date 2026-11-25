require('dotenv').config();
const express = require('express');
const path = require('path');
const { MODES } = require('./lib/prompts');
const { webSearch, formatResults } = require('./lib/search');

const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const CHAT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const THINK_MODEL = process.env.DEEPSEEK_THINK_MODEL || 'deepseek-reasoner';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keyConfigured: !!KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL, thinkModel: THINK_MODEL });
});

app.get('/api/modes', (_req, res) => {
  res.json(Object.entries(MODES).map(([id, m]) => ({ id, label: m.label, icon: m.icon })));
});

app.post('/api/chat', async (req, res) => {
  const { messages = [], mode = 'grok' } = req.body;
  if (!KEY) return res.status(400).json({ error: 'DEEPSEEK_API_KEY not configured. See .env.example.' });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages required' });
  const m = MODES[mode] ? mode : 'grok';

  const lastUser = [...messages].reverse().find((x) => x.role === 'user');
  let system = MODES[m].system;

  if (m === 'search' && lastUser) {
    const { results, provider, error } = await webSearch(String(lastUser.content).slice(0, 300));
    system += '\n\nWeb search results (' + provider + '):\n' + formatResults(results);
    if (error) system += '\nNote: ' + error;
  }

  const model = m === 'think' ? THINK_MODEL : CHAT_MODEL;
  const payload = {
    model,
    stream: true,
    temperature: m === 'think' ? 1.0 : 1.3,
    max_tokens: 4096,
    messages: [{ role: 'system', content: system }, ...messages.map((x) => ({
      role: x.role === 'assistant' ? 'assistant' : 'user',
      content: String(x.content || '').slice(0, 12000)
    }))]
  };

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  try {
    const upstream = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000)
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      res.write('data: ' + JSON.stringify({ error: 'Upstream ' + upstream.status + ': ' + t.slice(0, 500) }) + '\n\n');
      return res.end();
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const j = JSON.parse(raw);
          const d = j.choices?.[0]?.delta || {};
          const out = {};
          if (d.content) out.content = d.content;
          if (d.reasoning_content) out.reasoning = d.reasoning_content;
          if (Object.keys(out).length) res.write('data: ' + JSON.stringify(out) + '\n\n');
        } catch (_) { /* ignore keepalive / malformed chunk */ }
      }
    }
  } catch (err) {
    res.write('data: ' + JSON.stringify({ error: 'Request failed: ' + err.message }) + '\n\n');
  }
  res.end();
});

app.listen(PORT, () => console.log('GrokBot running at http://localhost:' + PORT));
