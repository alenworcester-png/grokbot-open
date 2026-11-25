// Web search with graceful fallback. No API key required by default (DuckDuckGo Lite HTML).
// Optional: set SEARCH_PROVIDER=serper + SERPER_API_KEY for higher reliability.

const SERPER_URL = 'https://google.serper.dev/search';

async function searchSerper(query, key, timeout) {
  const res = await fetch(SERPER_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 5 }),
    signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error('Serper ' + res.status);
  const data = await res.json();
  return (data.organic || []).map((r) => ({
    title: r.title || '',
    url: r.link || '',
    snippet: r.snippet || r.description || ''
  }));
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchDdg(query, timeout) {
  const url = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrokBotOpen/1.0)' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error('DDG ' + res.status);
  const html = await res.text();
  const results = [];
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const links = [...html.matchAll(linkRe)].map((m) => ({ url: m[1], title: stripTags(m[2]) }));
  const snippets = [...html.matchAll(snippetRe)].map((m) => stripTags(m[1]));
  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || '' });
  }
  return results;
}

async function webSearch(query) {
  const timeout = 8000;
  try {
    if (process.env.SEARCH_PROVIDER === 'serper' && process.env.SERPER_API_KEY) {
      return { results: await searchSerper(query, process.env.SERPER_API_KEY, timeout), provider: 'serper' };
    }
    return { results: await searchDdg(query, timeout), provider: 'duckduckgo' };
  } catch (err) {
    try {
      return { results: await searchSerper(query, process.env.SERPER_API_KEY || '', timeout), provider: 'serper' };
    } catch (e) {
      return { results: [], provider: 'none', error: 'Search unavailable: ' + err.message };
    }
  }
}

function formatResults(results) {
  if (!results.length) return 'No web results found.';
  return results.map((r, i) =>
    '[' + (i + 1) + '] ' + r.title + '\nURL: ' + r.url + '\n' + r.snippet
  ).join('\n\n');
}

module.exports = { webSearch, formatResults };
