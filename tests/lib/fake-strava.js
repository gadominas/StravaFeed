// More of strava.com for the app tests, on top of the screenshot scenario's feed: kudos that can be refused, and the
// edit page and save requests behind ✍️ Posting assistant › Save to Strava. Everything sent is kept in the state.
//
//   const strava = { kudoFail: new Set(['9100101']), edit: { mode: 'form' } };   fixtures(auth with strava) … strava.kudos
//
// edit.mode: 'form'   the edit page has Strava's form and saving it works
//            'inline' no form on the edit page; the inline edit (PUT /activities/:id) works
//            'form-refused' the form is there but saving it is refused; the inline edit works
//            'refuse' neither works (HTTP 422)
'use strict';

function stravaRoutes(st) {
  st.kudos = st.kudos || []; st.kudoFail = st.kudoFail || new Set();
  const e = st.edit = Object.assign({ mode: 'form', saved: {}, posts: [], extra: { gear: 'g2', visibility: 'followers_only', commute: false } }, st.edit || {});
  const id = (url) => /activities\/(\d+)/.exec(url)[1];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const form = (aid) => {
    const cur = e.saved[aid] || { name: 'Morning Run', description: 'My own words.' };
    return `<!doctype html><html><head><meta name="csrf-token" content="edit-csrf"></head><body>
<form id="edit-activity" action="/activities/${aid}" method="post"><input type="hidden" name="_method" value="patch"><input type="hidden" name="authenticity_token" value="form-token">
<input name="activity[name]" value="${esc(cur.name)}"><textarea name="activity[description]">${esc(cur.description)}</textarea>
<select name="activity[gear_id]"><option value="g1">Old shoes</option><option value="g2"${e.extra.gear === 'g2' ? ' selected' : ''}>Trail shoes</option></select>
<input type="radio" name="activity[visibility]" value="everyone"><input type="radio" name="activity[visibility]" value="followers_only" checked>
<input type="checkbox" name="activity[commute]" value="1"${e.extra.commute ? ' checked' : ''}><input type="submit" name="commit" value="Save"></form></body></html>`;
  };
  const params = (req) => { const q = new URLSearchParams(req.body || ''); const o = {}; for (const [k, v] of q) o[k] = k in o ? [].concat(o[k], v) : v; return o; };
  return [
    // 👍 kudos: kept, or refused for the ids in kudoFail
    { match: (url, req) => /strava\.com\/feed\/activity\/\d+\/kudo$/.test(url) && (req.method || 'GET') !== 'GET', respond: (req) => {
      const aid = /activity\/(\d+)/.exec(req.url)[1]; st.kudos.push(aid);
      return st.kudoFail.has(aid) ? { status: 422, json: { error: 'refused' } } : { json: {} };
    } },
    // ✍️ the edit page
    { match: (url, req) => /strava\.com\/activities\/\d+\/edit/.test(url) && (req.method || 'GET') === 'GET', respond: (req) => (/^form/.test(e.mode)
      ? { body: form(id(req.url)), contentType: 'text/html' } : { status: 200, body: '<!doctype html><html><body><div id="react-edit"></div></body></html>', contentType: 'text/html' }) },
    // saving: the form (POST with _method=patch) or the inline edit (PUT / PATCH / POST with _method=put)
    { match: (url, req) => /strava\.com\/activities\/\d+$/.test(url.split('?')[0]) && (req.method || 'GET') !== 'GET', respond: (req) => {
      const aid = id(req.url), p = params(req), how = p._method === 'patch' ? 'form' : 'inline';
      e.posts.push({ id: aid, method: req.method, how, params: p });
      const works = how === 'form' ? e.mode === 'form' : e.mode === 'inline' || e.mode === 'form-refused';
      if (!works) return { status: 422, body: 'Unprocessable', contentType: 'text/plain' };
      e.saved[aid] = { name: p['activity[name]'], description: p['activity[description]'] };
      if (how === 'form') Object.assign(e.extra, { gear: p['activity[gear_id]'], visibility: p['activity[visibility]'], commute: p['activity[commute]'] === '1' });
      return how === 'form' ? { body: '<html><body>Saved</body></html>', contentType: 'text/html' } : { json: { ok: true } };
    } },
    // the activity page after a save shows the new title and description (other activities: the scenario's page)
    { match: (url, req) => /strava\.com\/activities\/\d+(\?|$)/.test(url) && (req.method || 'GET') === 'GET', respond: (req) => {
      const s = e.saved[id(req.url)]; if (!s) return null;
      return { body: `<!doctype html><html><head><meta property="og:title" content="${esc(s.name)} | Run | Strava"><title>${esc(s.name)} | Strava</title></head><body><h1>${esc(s.name)}</h1><div class="description">${esc(s.description)}</div></body></html>`, contentType: 'text/html' };
    } },
  ];
}

module.exports = { stravaRoutes };
