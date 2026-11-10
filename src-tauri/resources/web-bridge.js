(() => {
  const base = location.hostname.includes('zalo') ? 'Zalo' : location.hostname.includes('whatsapp') ? 'WhatsApp' : 'Messenger';
  const send = (kind, o) => { try { window.open('chatmin://' + kind + '/' + encodeURIComponent(JSON.stringify(o))); } catch (e) {} };
  const log = (o) => send('log', o);
  const tx = (el) => ((el && el.innerText) || '').trim();
  const pic = (el) => { const i = el.querySelector('img[src^="https://"]'); return i ? i.src : ''; };
  // "vài giây" / "5 phút" / "3 giờ" / "2 ngày" … → seconds ago (-1 = unknown), so rows sort by real activity
  const UNIT = { giây: 1, phút: 60, giờ: 3600, ngày: 86400, tuần: 604800, tháng: 2592000, năm: 31536000 };
  const ago = (text) => {
    if (/vài giây/i.test(text)) return 30;
    const m = /(\d+)\s*(giây|phút|giờ|ngày|tuần|tháng|năm)(?=\s|$|[·,])/i.exec(text);
    if (m) return +m[1] * UNIT[m[2].toLowerCase()];
    // weekday ("T2"…"T7", "CN") = that day in the past week; "25/10" or "25/10/25" = that date
    const now = new Date();
    const wd = /(?:^|\s)(T[2-7]|CN)(?=\s|$|[·,])/.exec(text);
    if (wd) { const d = wd[1] === 'CN' ? 0 : +wd[1][1] - 1; let back = (now.getDay() - d + 7) % 7; if (!back) back = 7; return back * 86400; }
    const dm = /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$|[·,])/.exec(text);
    if (dm) { let y = dm[3] ? +dm[3] : now.getFullYear(); if (y < 100) y += 2000; const t = new Date(y, +dm[2] - 1, +dm[1]).getTime(); return t > now.getTime() ? -1 : Math.floor((now.getTime() - t) / 1000); }
    const hm = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM|SA|CH))?$/i.exec(text.trim());
    if (hm) { let h = +hm[1]; const ap = (hm[3] || '').toUpperCase(); if ((ap === 'PM' || ap === 'CH') && h < 12) h += 12; if ((ap === 'AM' || ap === 'SA') && h === 12) h = 0; return Math.max(0, Math.floor((now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, +hm[2]).getTime()) / 1000)); }
    if (/^(hôm qua|yesterday)$/i.test(text.trim())) return 86400;
    const day = WEEKDAY[text.trim().toLowerCase()];
    if (day !== undefined) { let back = (now.getDay() - day + 7) % 7; if (!back) back = 7; return back * 86400; }
    return -1;
  };
  const WEEKDAY = { 'chủ nhật': 0, 'thứ hai': 1, 'thứ ba': 2, 'thứ tư': 3, 'thứ năm': 4, 'thứ sáu': 5, 'thứ bảy': 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
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
  // the age sits on its own innerText line (textContent glues "K2024.1" + "3 ngày" into "13 ngày");
  // innerText forces layout, so it is read once per row text and cached
  const zaloAges = new WeakMap();
  const zaloAgo = (e) => {
    const sig = e.textContent;
    const c = zaloAges.get(e);
    if (c && c.sig === sig) return c.v;
    const l = lines(e);
    let v = ago(l[1] || '');
    if (v < 0) v = ago(l.join(' '));
    if (v < 0) v = ago(tc(e)); // last resort: glued textContent
    const out = { ago: v, age_text: (l[1] || '').slice(0, 20) };
    zaloAges.set(e, { sig, v: out });
    return out;
  };
  const zaloRows = () => zaloItems().map((e) => {
    const title = zaloTitle(e);
    const msg = e.querySelector('[class*="z-conv-message"]');
    const preview = (msg ? tc(msg) : lines(e).slice(2).join(' ')).slice(0, 120);
    const badge = e.querySelector('.conv-action__unread-v2 .z-noti-badge__content');
    const m = badge && /fa-(\d+|5_?plus)_24/i.exec(badge.className);
    const unread = m ? (/plus/i.test(m[1]) ? 6 : +m[1]) : (e.querySelector('.z-conv-message.--unread') ? 1 : 0);
    return { id: title, title, preview, unread, outgoing: /^(Bạn|You):\s*/i.test(preview), pinned: /\bpinned\b/.test(e.className), photo: pic(e), ...zaloAgo(e) };
  }).filter((r) => r.id);
  // WhatsApp: rows in #pane-side; innerText lines = name, time label, preview[, badge count]. No thread id
  // in the DOM either, so (like Zalo) the title is the id. Status ticks mark the preview as my own message.
  const waItems = () => { const rows = document.querySelectorAll('#pane-side [role="row"]'); return [...(rows.length ? rows : document.querySelectorAll('#pane-side [role="listitem"]'))]; };
  const waTitle = (e) => tc(e.querySelector('span[title]')) || lines(e)[0] || '';
  const waParsed = new WeakMap();
  const waRows = () => waItems().map((e) => {
    const sig = e.textContent;
    const c = waParsed.get(e);
    if (c && c.sig === sig) return c.v;
    const title = waTitle(e);
    const l = lines(e);
    if (l[0] === title) l.shift();
    const age_text = l.shift() || '';
    const badge = e.querySelector('span[aria-label*="unread" i], span[aria-label*="chưa đọc" i]');
    const unread = badge ? Math.max(1, parseInt(badge.textContent, 10) || 0) : 0;
    const preview = l.filter((s) => !/^\d+$/.test(s)).join(' ').slice(0, 120);
    const v = { id: title, title, preview, unread, outgoing: !!e.querySelector('[data-icon^="msg-"], [data-icon^="status-"]'), pinned: !!e.querySelector('[data-icon^="pinned"]'), photo: pic(e), ago: ago(age_text), age_text: age_text.slice(0, 20) };
    waParsed.set(e, { sig, v });
    return v;
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
  const rows = base === 'Zalo' ? zaloRows : base === 'WhatsApp' ? waRows : fbRows;
  let retry = 0, focusRetry = 0, requested = null, focusTarget = null, focusName = '', focusCandidate = null;
  const onMessengerRoute = (id) => /\/(?:e2ee\/)?t\/(\d+)(?:\/|$|[?#])/.exec(location.pathname)?.[1] === id;
  window.__cm = {
    focus(tries = 60) {
      clearTimeout(focusRetry);
      if (document.hidden) return;
      const ready = base !== 'Messenger' || !focusTarget || onMessengerRoute(focusTarget);
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
      else if (base === 'WhatsApp') { const e = waItems().find((x) => waTitle(x) === id); if (e) { press(e); ok = true; } }
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
    : base === 'WhatsApp'
      ? '#side { position: absolute !important; left: -2000px !important; top: 0 !important; width: 400px !important; height: 100% !important; } #main { flex: 1 1 auto !important; width: 100% !important; max-width: none !important; }'
      : '[role="banner"] { display: none !important; }';
  let parked = null;
  const style = () => {
    if (document.head && !document.getElementById('cm-css')) { const st = document.createElement('style'); st.id = 'cm-css'; st.textContent = CSS + TR_CSS; document.head.appendChild(st); }
    if (base === 'Messenger' && !parked?.isConnected) {
      // Messenger's classes are generated: the list column is the ancestor of a thread link whose
      // parent spans the window. Park it off-screen (re-applied after re-renders; cheap: one walk)
      let e = document.querySelector('a[role="link"][href*="/t/"]');
      while (e && e.parentElement && e.parentElement.getBoundingClientRect().width < window.innerWidth * 0.9) e = e.parentElement;
      if (e && e !== document.body && !e.dataset.cmParked) { parked = e; e.dataset.cmParked = '1'; e.style.cssText += ';position:absolute !important;left:-2000px !important;top:0 !important;height:100% !important;'; }
    }
  };
  // ── Translation: hover a bubble → "Dịch" pill; the shell (languages, cache, AI config) answers through
  // __cm.translated. "Dịch nháp" sends the composer text and __cm.draft types the result back.
  const BUBBLE = base === 'WhatsApp' ? '#main .message-in, #main .message-out' : base === 'Messenger' ? '[role="main"] div[dir="auto"]' : '';
  const EDITOR = base === 'WhatsApp' ? '#main footer [contenteditable="true"]' : '[role="main"] [contenteditable="true"]';
  const bubbleText = (b) => tx(base === 'WhatsApp' ? b.querySelector('.selectable-text.copyable-text') || b.querySelector('span[dir="ltr"], span[dir="auto"]') || b : b);
  const TR_CSS = '#cm-tr-btn,#cm-draft{position:fixed;z-index:2147483647;padding:2px 8px;border:0;border-radius:9px;background:rgba(17,24,39,.78);color:#fff;font:11px/16px -apple-system,sans-serif;cursor:pointer;display:none;box-shadow:0 1px 4px rgba(0,0,0,.25);transform:translateY(-50%)}#cm-tr-btn:hover{background:rgba(17,24,39,.95)}' +
    '#cm-draft{right:20px;bottom:74px;transform:none}' +
    '.cm-tr{margin-top:6px;padding-top:6px;border-top:1px solid rgba(128,128,128,.35);font-size:.95em;opacity:.85;white-space:pre-wrap;user-select:text}.cm-tr.err{color:#d33}.cm-tr.loading{opacity:.5}';
  let trSeq = 0, hovered = null, hideT = 0;
  const pill = (id, text, onClick) => {
    let b = document.getElementById(id);
    if (b || !document.body) return b;
    b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = text;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    document.body.appendChild(b);
    return b;
  };
  const hideTr = () => { clearTimeout(hideT); hideT = setTimeout(() => { const x = document.getElementById('cm-tr-btn'); if (x) x.style.display = 'none'; }, 250); };
  window.__cm.translate = (b) => {
    const old = b.querySelector('.cm-tr');
    if (old) { old.remove(); return false; }
    const text = bubbleText(b);
    if (!text) return false;
    const id = b.dataset.cmTr || (b.dataset.cmTr = String(++trSeq));
    const box = document.createElement('div'); box.className = 'cm-tr loading'; box.textContent = 'Đang dịch…';
    (base === 'WhatsApp' && b.querySelector('.copyable-text') || b).appendChild(box);
    send('translate', { id, text });
    return true;
  };
  window.__cm.translated = (id, text, err) => {
    const b = [...document.querySelectorAll('[data-cm-tr]')].find((x) => x.dataset.cmTr === id);
    const box = b && b.querySelector('.cm-tr');
    if (!box) return;
    box.className = 'cm-tr' + (err ? ' err' : '');
    box.textContent = text;
  };
  window.__cm.draft = (text) => {
    const btn = document.getElementById('cm-draft'); if (btn) btn.textContent = 'Dịch nháp';
    const ed = document.querySelector(EDITOR); if (!ed || !text) return;
    ed.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  };
  if (BUBBLE) document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!t || t.id === 'cm-tr-btn') { clearTimeout(hideT); return; }
    const b = t.closest?.(BUBBLE);
    if (!b || b.closest('[contenteditable]') || !bubbleText(b)) { hideTr(); return; }
    hovered = b; clearTimeout(hideT);
    const btn = pill('cm-tr-btn', 'Dịch', () => { if (hovered) window.__cm.translate(hovered); });
    if (!btn) return;
    btn.addEventListener('mouseleave', hideTr);
    const r = b.getBoundingClientRect();
    const mine = base === 'WhatsApp' ? b.classList.contains('message-out') : r.left + r.width / 2 > window.innerWidth / 2;
    const gap = base === 'WhatsApp' ? 44 : 108;
    btn.style.display = 'block';
    btn.style.top = (r.top + r.height / 2) + 'px';
    btn.style.left = Math.max(0, mine ? r.left - gap - btn.offsetWidth : r.right + gap) + 'px';
  }, true);
  // fixed-position pill would drift from its bubble while the list scrolls
  document.addEventListener('scroll', () => { const x = document.getElementById('cm-tr-btn'); if (x) x.style.display = 'none'; }, true);
  const draftUi = () => {
    if (!BUBBLE) return;
    const ed = document.querySelector(EDITOR);
    const btn = ed && pill('cm-draft', 'Dịch nháp', (b) => { const text = tx(document.querySelector(EDITOR)); if (text) { b.textContent = 'Đang dịch…'; send('draft', { text }); } });
    if (btn) {
      const hasDraft = base === 'Messenger' ? ed.textContent?.trim() : tx(ed);
      const display = hasDraft ? 'block' : 'none';
      if (btn.style.display !== display) btn.style.display = display;
    }
  };
  let lastRows = '', lastState = '';
  const state = (value) => { if (value !== lastState) { if (value !== 'ready') lastRows = ''; lastState = value; send('state', value); } };
  // A failed lazy bundle otherwise leaves Zalo blank until a manual reload. Keep
  // cookies/session intact and bound retries across reloads of this same webview.
  let chunkRecoveryPending = false;
  window.addEventListener?.('unhandledrejection', (event) => {
    if (base !== 'Zalo' || !/ChunkLoadError|Loading chunk .*failed/i.test(String(event.reason))) return;
    state('load-error');
    if (chunkRecoveryPending) return;
    try {
      const key = 'chatmin.chunk-recovery', now = Date.now();
      let record = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!record || now - record.at > 300000) record = { at: now, attempts: 0 };
      if (record.attempts >= 2) return;
      record.attempts++;
      sessionStorage.setItem(key, JSON.stringify(record));
      chunkRecoveryPending = true;
      setTimeout(() => {
        chunkRecoveryPending = false;
        const url = new URL(location.href);
        url.searchParams.set('_cm_reload', String(Date.now()));
        location.replace(url.href);
      }, 1000);
    } catch (_) { /* unavailable sessionStorage: leave the manual reload action */ }
  });
  const tick = (scanRows) => {
    try {
      if (scanRows) style();
      draftUi();
      if (!scanRows) return;
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
        else if (base === 'WhatsApp' && document.querySelector('[data-ref], canvas[aria-label*="Scan" i], canvas[aria-label*="Quét" i]')) state('login');
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
  let pending = 0, rowsPending = false;
  const schedule = (scanRows = true) => {
    rowsPending ||= scanRows;
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      const scan = rowsPending;
      rowsPending = false;
      tick(scan);
    }, 100);
  };
  const observer = new MutationObserver((records) => {
    if (base !== 'Messenger' || !parked?.isConnected || !records.length) { schedule(); return; }
    // Timeline and editor changes in a separate Messenger pane only affect the draft button.
    // While the parked list is missing or its layout overlaps the pane, reconcile normally.
    const { target } = records[0];
    const element = target.closest ? target : target.parentElement;
    const main = element?.closest?.('[role="main"]');
    const timelineOnly = main && !main.contains(parked) && !parked.contains(main)
      && records.every((record) => main.contains(record.target));
    schedule(!timelineOnly);
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'aria-label', 'href', 'src'] });
  document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden && focusTarget) window.__cm.focus(); });
  window.addEventListener?.('pageshow', () => schedule());
  setInterval(() => schedule(), 15000);
  schedule();
})();
