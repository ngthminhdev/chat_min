(() => {
  const base = location.hostname.includes('zalo') ? 'Zalo' : 'Messenger';
  const send = (kind, o) => { try { window.open('chatmin://' + kind + '/' + encodeURIComponent(JSON.stringify(o))); } catch (e) {} };
  const log = (o) => send('log', o);
  const tx = (el) => ((el && el.innerText) || '').trim();
  const pic = (el) => { const i = el.querySelector('img[src^="https://"]'); return i ? i.src : ''; };
  // "vài giây" / "5 phút" / "3 giờ" / "2 ngày" … → seconds ago (-1 = unknown), so rows sort by real activity
  const UNIT = { giây: 1, phút: 60, giờ: 3600, ngày: 86400, tuần: 604800, tháng: 2592000, năm: 31536000 };
  const ago = (text) => { if (/vài giây/i.test(text)) return 30; const m = /(\d+)\s*(giây|phút|giờ|ngày|tuần|tháng|năm)(?=\s|$|[·,])/i.exec(text); return m ? +m[1] * UNIT[m[2].toLowerCase()] : -1; };
  const lines = (el) => tx(el).split('\n').map((s) => s.trim()).filter(Boolean);
  // a real pointer sequence: these apps often act on mousedown/pointerdown, not click
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, detail: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { ...at, buttons: t.endsWith('down') ? 1 : 0 }));
  };
  const zaloItems = () => [...document.querySelectorAll('.conv-item')].filter((e) => !e.parentElement.closest('.conv-item'));
  // ponytail: Zalo's DOM carries no thread id, so the title is the id (collisions = one row)
  // textContent, not innerText: no forced layout on 16+ rows every tick
  const tc = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const zaloTitle = (e) => tc(e.querySelector('.truncate')) || lines(e)[0] || '';
  const zaloRows = () => zaloItems().map((e) => {
    const title = zaloTitle(e);
    const msg = e.querySelector('[class*="z-conv-message"]');
    const preview = (msg ? tc(msg) : lines(e).slice(2).join(' ')).slice(0, 120);
    const badge = e.querySelector('.conv-action__unread-v2 .z-noti-badge__content');
    const m = badge && /fa-(\d+|5_?plus)_24/i.exec(badge.className);
    const unread = m ? (/plus/i.test(m[1]) ? 6 : +m[1]) : (e.querySelector('.z-conv-message.--unread') ? 1 : 0);
    return { id: title, title, preview, unread, outgoing: /^(Bạn|You):\s*/i.test(preview), pinned: /\bpinned\b/.test(e.className), photo: pic(e), ago: ago(tc(e)) };
  }).filter((r) => r.id);
  // Messenger: thread links in grid cells; cell text = [Đang hoạt động] Name [Tin nhắn chưa đọc:] preview · age
  const AGE = /^(vài giây|\d+ (phút|giờ|ngày|tuần|tháng|năm))( trước)?$/i;
  const UNREAD = /^(Tin nhắn chưa đọc|Unread messages?)\s*:?\s*/i;
  const parsedRows = new WeakMap();
  const fbRows = () => {
    const out = [], seen = new Set();
    for (const a of document.querySelectorAll('a[role="link"][href*="/t/"]')) {
      const m = /\/(?:e2ee\/)?t\/(\d+)(?:\/|$|[?#])/.exec(a.getAttribute('href') || '');
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const row = a.closest('[role="gridcell"], [role="row"], [role="listitem"]') || a;
      const label = (a.getAttribute('aria-label') || '').replace(/^Nhóm chat:\s*/i, '');
      const photo = pic(row);
      const signature = (row.textContent || '') + '\0' + label + '\0' + photo;
      const cached = parsedRows.get(row);
      if (cached?.signature === signature && cached.value.id === m[1]) { out.push(cached.value); continue; }
      // lines: [Đang hoạt động] name [Tin nhắn chưa đọc:] preview · age [Trả lời?] — keep what sits before the age
      const raw = lines(row).map((s) => s.replace(/\s*·\s*$/, ''));
      const cut = raw.findIndex((s) => AGE.test(s));
      const l = (cut >= 0 ? raw.slice(0, cut) : raw).filter((s) => s && s !== '·' && s !== 'Đang hoạt động');
      const title = label || l[0] || '';
      if (l[0] === title) l.shift();
      let preview = l.join(' ').replace(/\s*·\s*(vài giây|\d+ (phút|giờ|ngày|tuần|tháng|năm)).*$/i, '');
      const unread = UNREAD.test(preview) ? 1 : 0;
      preview = preview.replace(UNREAD, '');
      if (title) {
        const value = { id: m[1], title, preview: preview.slice(0, 120), unread, outgoing: /^(Bạn|You):\s*/i.test(preview), pinned: false, photo, ago: ago(raw.slice(cut < 0 ? 0 : cut).join(' ')) };
        parsedRows.set(row, { signature, value });
        out.push(value);
      }
    }
    return out;
  };
  const rows = base === 'Zalo' ? zaloRows : fbRows;
  let retry = 0, focusRetry = 0, requested = null, focusTarget = null, focusName = '', focusCandidate = null;
  const onMessengerRoute = (id) => /\/(?:e2ee\/)?t\/(\d+)(?:\/|$|[?#])/.exec(location.pathname)?.[1] === id;
  window.__cm = {
    focus(tries = 60) {
      clearTimeout(focusRetry);
      if (document.hidden) return;
      const ready = base === 'Zalo' || !focusTarget || onMessengerRoute(focusTarget);
      const editor = ready && [...document.querySelectorAll('[contenteditable="true"], textarea')].find((e) => e.getClientRects().length);
      const name = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const correctChat = !focusName || (editor && name(editor.getAttribute?.('aria-label') || '').includes(name(focusName))) ||
        [...document.querySelectorAll('h1, h2, h3, [role="heading"]')].some((h) => name(tc(h)) === name(focusName));
      if (editor && correctChat && editor === focusCandidate) editor.focus({ preventScroll: true });
      else if (tries > 0) {
        focusCandidate = editor && correctChat ? editor : null;
        focusRetry = setTimeout(() => window.__cm.focus(tries - 1), 50);
      }
    },
    // the row may not be rendered yet right after a load: keep trying for ~10 s
    open(id, tries = 20) {
      requested = id;
      focusTarget = id;
      focusName = base === 'Messenger' ? fbRows().find((r) => r.id === id)?.title || '' : '';
      focusCandidate = null;
      clearTimeout(retry);
      clearTimeout(focusRetry);
      retry = 0;
      let ok = false;
      if (base === 'Zalo') { const e = zaloItems().find((x) => zaloTitle(x) === id); if (e) { e.click(); ok = true; } }
      else if (onMessengerRoute(id)) ok = true;
      else {
        const a = [...document.querySelectorAll('a[role="link"][href*="/t/"]')].find((a) => /\/(?:e2ee\/)?t\/(\d+)(?:\/|$|[?#])/.exec(a.getAttribute('href') || '')?.[1] === id);
        if (a) { press(a); ok = true; }
        else {
          // Its cached thread may be outside the virtual list. Messenger has stable URLs:
          // navigate immediately, instead of leaving the previous chat on screen for 10 s.
          location.assign('/messages/' + (location.pathname.includes('/e2ee/') ? 'e2ee/' : '') + 't/' + encodeURIComponent(id) + '/');
          return false;
        }
      }
      if (ok) {
        requested = null;
        // Let the provider commit the new conversation before restoring its editor.
        focusRetry = setTimeout(() => window.__cm.focus(), 0);
      }
      if (!ok && tries > 0) retry = setTimeout(() => window.__cm.open(id, tries - 1), 500);
      else log({ open: id, ok });
      return ok;
    },
  };
  // ChatMin draws the thread list itself: park the site's own list + nav off-screen (still laid out,
  // so the virtualized list keeps rendering rows for us) and let the chat pane take the width
  const CSS = base === 'Zalo'
    ? '#sidebarNav { position: absolute !important; left: -2000px !important; top: 0 !important; height: 100% !important; }'
    : '[role="banner"] { display: none !important; }';
  let parked = null;
  const style = () => {
    if (CSS && document.head && !document.getElementById('cm-css')) { const st = document.createElement('style'); st.id = 'cm-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (base !== 'Zalo' && !parked?.isConnected) {
      // Messenger's classes are generated: the list column is the ancestor of a thread link whose
      // parent spans the window. Park it off-screen (re-applied after re-renders; cheap: one walk)
      let e = document.querySelector('a[role="link"][href*="/t/"]');
      while (e && e.parentElement && e.parentElement.getBoundingClientRect().width < window.innerWidth * 0.9) e = e.parentElement;
      if (e && e !== document.body && !e.dataset.cmParked) { parked = e; e.dataset.cmParked = '1'; e.style.cssText += ';position:absolute !important;left:-2000px !important;top:0 !important;height:100% !important;'; }
    }
  };
  let lastRows = '', lastState = '';
  const state = (value) => { if (value !== lastState) { if (value !== 'ready') lastRows = ''; lastState = value; send('state', value); } };
  const tick = () => {
    try {
      style();
      const r = rows();
      if (r && r.length) {
        state('ready');
        if (requested && !retry) window.__cm.open(requested);
        const s = JSON.stringify(r);
        if (s !== lastRows) { lastRows = s; send('rows', r); }
      } else {
        const body = document.body?.textContent || '';
        if (base === 'Zalo' && /mở Zalo trên một Tab khác|không sử dụng Zalo quá lâu/i.test(body)) state('inactive');
        else if (location.hostname === 'id.zalo.me' || /\/(login|checkpoint)(\/|\.|$)/.test(location.pathname)) state('login');
        let n = null;
        for (const a of document.querySelectorAll('a[role="link"][aria-label]')) {
          const l = a.getAttribute('aria-label') || '';
          if (/unread|chưa đọc/i.test(l) && /^\/(messages\/)?(e2ee\/)?t\//.test(a.getAttribute('href') || '')) { const m = /\d+/.exec(l); if (m) { n = +m[0]; break; } }
        }
        if (n > 0 && !document.title.startsWith(`(${n})`)) document.title = `(${n}) ${base}`;
      }
    } catch (e) { log({ err: String(e) }); }
  };
  // A leading bounded debounce cannot starve under a continuous mutation stream.
  // The slow timer reconciles title-only changes and missed site updates.
  let pending = 0;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; tick(); }, 100);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'aria-label', 'href', 'src'] });
  document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden && focusTarget) window.__cm.focus(); });
  window.addEventListener?.('pageshow', schedule);
  setInterval(schedule, 15000);
  schedule();
})();
