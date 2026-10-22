(() => {
  const state = {
    route: 'shell', returnRoute: 'shell', wizard: null, debug: false,
    inboxAccount: '', inboxFilter: 'all', inboxQuery: '', emptyList: false,
    loadingList: false, loadingMessages: false, syncFailure: false, require2fa: true,
    preferences: { size: 13, theme: '', uiFont: '', monoFont: '', compact: false },
  };
  const colors = ['blue', 'purple', 'green', 'orange', 'red', 'amber', 'pink', 'slate'];
  const labels = { blue: 'Xanh dương', purple: 'Tím', green: 'Xanh lá', orange: 'Cam', red: 'Đỏ', amber: 'Vàng', pink: 'Hồng', slate: 'Slate' };
  const healthLabels = { ok: 'Đã đồng bộ', offline: 'Offline', reconnecting: 'Đang kết nối lại', expired: 'Phiên hết hạn', rate: 'Rate limit' };
  const themes = [...$('#theme-select').options].map(option => [option.value, option.textContent]);
  const main = $('.main');
  const view = document.createElement('section');
  view.id = 'round2-view'; view.hidden = true; main.append(view);
  const button = (action, label, primary = false, extra = '') => `<button type="button" class="tool-btn${primary ? ' primary' : ''}" data-r2="${action}" ${extra}>${label}</button>`;
  const field = (name, label, value = '', type = 'text', hint = '') => `<label class="field wide" for="${name}"><span class="field-label">${label}</span><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${type === 'password' ? 'autocomplete="off"' : ''} /><span class="field-hint">${hint}</span><span class="field-error" id="${name}-error" role="alert"></span></label>`;
  const select = (id, options, value, extra = '') => `<select id="${id}" class="settings-select" ${extra}>${options.map(([key, label]) => `<option value="${esc(key)}" ${String(value) === String(key) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const toggle = (id, checked, label, extra = '') => `<label class="switch"><input id="${id}" type="checkbox" aria-label="${esc(label)}" ${checked ? 'checked' : ''} ${extra}/><span></span></label>`;
  const header = (title, subtitle, actions = '', back = true) => `<header class="r2-header"><div class="od-field"><h1>${title}</h1><p>${subtitle}</p></div><div class="r2-actions">${actions}${back ? button('shell', 'Về hội thoại') : ''}</div></header>`;
  // Inbox and Settings open as a workspace tab inside the shell; Welcome and the wizard take the whole window
  const TAB_ROUTES = ['inbox', 'settings'];
  const PAGE_TABS = { inbox: ['inbox', 'All inboxes'], settings: ['settings', 'Settings'] };
  const swatches = (value, account = '') => `<div class="account-colors" role="group" aria-label="Màu account">${colors.map(color => `<button type="button" class="color-choice${value === color ? ' selected' : ''}" style="--conn:var(--conn-${color})" data-r2="color" data-color="${color}" data-account="${account}" aria-label="${labels[color]}" aria-pressed="${value === color}"><span class="conn-dot"></span>${value === color ? icon('check') : ''}</button>`).join('')}</div>`;
  const accountSettings = account => account.notifications ||= { enabled: true, mentions: false, quiet: false, from: '22:00', to: '08:00', preview: true };
  const statusOf = account => account?.health || 'ok';
  const countdown = deadline => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  function showShell() {
    state.route = 'shell'; view.hidden = true; main.classList.remove('r2-page', 'r2-tab');
    document.body.classList.remove('r2-global', 'inspector-unavailable');
    $('#btn-left').disabled = false; $('#btn-right').disabled = false;
  }
  function navigate(route) {
    if (route !== 'wizard') state.wizard = null;
    state.route = route;
    if (route === 'shell') { showShell(); renderAll(); decorateStatus(); return; }
    renderRoute();
  }
  function renderRoute() {
    if (!S.accounts.length && state.route === 'shell') state.route = 'welcome';
    if (state.route === 'shell') return false;
    const inTab = TAB_ROUTES.includes(state.route);
    view.hidden = false; (inTab ? $('.workspace') : main).append(view);
    main.classList.toggle('r2-page', !inTab); main.classList.toggle('r2-tab', inTab);
    document.body.classList.toggle('r2-global', !inTab); document.body.classList.toggle('inspector-unavailable', inTab);
    $('#btn-left').disabled = !inTab; $('#btn-right').disabled = true;
    if (inTab) { renderSidebar(); renderPageTabs(); }
    renderStatus(); decorateStatus();
    if (state.route === 'welcome') $('#statusbar').innerHTML = '<div><span>Chưa có account</span></div><div class="right-status"><span>⌘N Add account</span></div>';
    if (state.route === 'welcome') renderWelcome();
    if (state.route === 'wizard') renderWizard();
    if (state.route === 'inbox') renderInbox();
    if (state.route === 'settings') renderSettings();
    return true;
  }
  function renderPageTabs() {
    renderTabs();
    document.querySelectorAll('#tabs .tab.active').forEach(tab => { tab.classList.remove('active'); tab.setAttribute('aria-selected', 'false'); });
    const [glyphName, title] = PAGE_TABS[state.route];
    $('#tab-add').insertAdjacentHTML('beforebegin', `<div class="tab active page-tab" role="tab" tabindex="0" aria-selected="true">${icon(glyphName)}<span class="tab-title">${title}</span><button class="tab-close" data-r2="shell" aria-label="Đóng ${title}" data-tip="Đóng" data-kbd="⌘W">×</button></div>`);
    $('#tabs .page-tab').scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderWelcome() {
    view.innerHTML = `<div class="welcome-view"><div class="welcome-mark">${icon('messages-square')}</div><span class="welcome-eyebrow">CHATMIN</span><h1>Mọi cuộc trò chuyện.<br>Một nơi làm việc.</h1><p>Thêm account đầu tiên để bắt đầu.<br>Chuyển giữa công việc và cá nhân bằng một phím tắt.</p>${button('add', `Add account <kbd class="kbd">⌘N</kbd>`, true)}<div class="welcome-platforms"><span>${glyph('telegram')} Telegram</span><span>${glyph('gchat')} Google Chat</span></div><small>Tài khoản được quản lý riêng · Không trộn lịch sử hội thoại</small></div>`;
  }

  function startWizard(accountId) {
    const existing = S.accounts.find(account => account.id === accountId);
    state.returnRoute = state.route === 'wizard' ? 'shell' : state.route;
    state.wizard = { step: existing ? 2 : 1, platform: existing?.platform || 'telegram', existing: existing?.id || '', name: existing?.name || '', color: existing?.color || 'blue', auth: 'phone', phone: '', checks: ['idle', 'idle', 'idle'], log: [], otpUntil: 0, error: '', busy: false };
    state.route = 'wizard'; renderRoute();
  }
  function wizardError(message, inputId) {
    const wizard = state.wizard;
    if (!wizard) return;
    wizard.error = message;
    const error = $('#wizard-error'); if (error) { error.textContent = message; error.hidden = false; }
    if (inputId) { const input = $('#' + inputId); input?.setAttribute('aria-invalid', 'true'); input?.focus(); const hint = $('#' + inputId + '-error'); if (hint) hint.textContent = message; }
  }
  function renderWizard() {
    const wizard = state.wizard;
    if (!wizard) return;
    const steps = ['Nền tảng', 'Xác thực', 'Đồng bộ', 'Tên & màu'];
    let content = '', primary = '';
    if (wizard.step === 1) {
      content = `<div class="engine-cards">${[['telegram', 'Telegram'], ['gchat', 'Google Chat'], ['messenger', 'Messenger'], ['zalo', 'Zalo']].map(([platform, label], index) => `<button type="button" class="engine-card ${wizard.platform === platform ? 'active' : ''}" data-r2="platform" data-platform="${platform}" ${index > 1 ? 'disabled' : ''}>${index < 2 ? glyph(platform) : icon('messages-square')}<strong>${label}</strong><span>${index > 1 ? 'Coming soon' : 'Kết nối account'}</span></button>`).join('')}</div><p class="r2-muted">Mỗi account có tên, màu và phiên đăng nhập riêng.</p>`;
      primary = button('wizard-next', 'Tiếp tục', true);
    } else if (wizard.step === 2 && wizard.platform === 'telegram') {
      const qr = wizard.auth === 'qr';
      content = `<div class="mini-tabs" role="tablist" aria-label="Cách đăng nhập"><button type="button" role="tab" aria-selected="${!qr}" data-r2="auth-phone" class="${!qr ? 'active' : ''}">Số điện thoại</button><button type="button" role="tab" aria-selected="${qr}" data-r2="auth-qr" class="${qr ? 'active' : ''}">QR</button></div>`;
      if (qr) { content += `<div class="qr-placeholder">${icon('phone')}<strong>QR đăng nhập mô phỏng</strong><span>Prototype không tạo mã đăng nhập Telegram thật.</span></div><ol class="r2-muted"><li>Mở Telegram trên điện thoại</li><li>Settings → Devices → Link Desktop Device</li><li>Quét mã để xác nhận phiên đăng nhập</li></ol>`; primary = button('qr-confirm', 'Mô phỏng đã quét QR', true); }
      else if (wizard.auth === 'phone') { content += field('wizard-phone', 'Số điện thoại *', wizard.phone, 'tel', 'Kèm mã quốc gia, ví dụ +84 912 345 678. Chỉ dùng số mẫu.'); primary = button('phone-submit', 'Gửi mã OTP', true); }
      else if (wizard.auth === 'otp') { content += `<p>Mã xác thực đã gửi tới <strong>${esc(wizard.phone)}</strong></p>${field('wizard-otp', 'Mã OTP *', '', 'text', 'Mã demo: 123456. Mã khác sẽ báo lỗi; không gửi SMS thật.')}<div>${button('otp-resend', 'Gửi lại', false, 'id="otp-resend"')}</div>`; primary = button('otp-submit', 'Xác thực', true); }
      else { content += field('wizard-password', 'Mật khẩu 2FA *', '', 'password', 'Mật khẩu demo: chatmin. Không nhập mật khẩu thật.'); primary = button('twofa-submit', 'Đăng nhập', true); }
    } else if (wizard.step === 2) {
      if (wizard.auth === 'oauth-wait') content = `<div class="oauth-wait">${icon('external-link')}<h3>Đang đợi bạn đăng nhập trong browser</h3><p>Phiên mô phỏng đang chờ phản hồi. Không mở Google thật và không nhận thông tin đăng nhập.</p><div class="r2-actions">${button('oauth-cancel', 'Huỷ')}${button('oauth-reopen', 'Mở lại link')}</div><div class="simulation-actions"><span>Phản hồi browser mô phỏng</span>${button('oauth-allow', 'Cho phép', true)}${button('oauth-deny', 'Từ chối')}</div><p id="oauth-reopen-note" role="status"></p></div>`;
      else { content = `<p>Cho phép ChatMin truy cập Google Chat qua phiên đăng nhập của bạn.</p><div class="connection-note">Bản prototype chỉ mô phỏng OAuth. Không nhập email hoặc mật khẩu thật.</div>`; primary = button('oauth-start', 'Đăng nhập bằng Google', true); }
    } else if (wizard.step === 3) {
      content = `<div class="check-list">${['Xác thực account', 'Tải danh sách chat', 'Sync tin gần đây'].map((label, index) => `<div class="check-item"><span class="step-num">${index + 1}</span><span class="check-label">${label}</span><span class="check-badge ${wizard.checks[index]}">${{ idle: 'Chờ', run: 'Đang chạy', ok: 'OK', err: 'Lỗi' }[wizard.checks[index]]}</span></div>`).join('')}</div><pre class="check-output" aria-live="polite">${wizard.log.map((line, index) => `<span class="check-line${wizard.checks.includes('err') && index === wizard.log.length - 1 ? ' err' : ''}">${esc(line)}</span>`).join('') || '<span class="check-line dim">Sẵn sàng đồng bộ…</span>'}</pre>${wizard.busy ? '<p class="r2-muted">Đang tải dữ liệu mẫu…</p>' : ''}`;
      primary = wizard.checks.includes('err') ? button('sync-retry', 'Thử lại', true) : wizard.checks.every(check => check === 'ok') ? button('wizard-next', 'Tiếp tục', true) : '';
    } else {
      content = `${field('wizard-name', 'Tên account *', wizard.name || (wizard.platform === 'telegram' ? 'Telegram cá nhân' : 'Google Chat công việc'), 'text', 'Tên hiển thị trong sidebar, tab và statusbar.')}<span class="field-label">Màu nhận diện</span>${swatches(wizard.color)}<p class="r2-muted">Màu luôn đi cùng tên account.</p>`;
      primary = button('wizard-finish', wizard.existing ? 'Lưu & kết nối lại' : 'Thêm account', true);
    }
    const back = wizard.step > 1 && !wizard.busy ? button('wizard-back', 'Quay lại') : '';
    if (back || primary) content += `<div class="wizard-actions">${back}${primary}</div>`;
    view.innerHTML = `${header(wizard.existing ? 'Đăng nhập lại' : 'Add account', 'Kết nối một account vào ChatMin', button('wizard-cancel', 'Huỷ'))}<div class="wizard-wrap"><nav class="wizard-steps" aria-label="Các bước">${steps.map((label, index) => `<span class="${wizard.step === index + 1 ? 'current' : wizard.step > index + 1 ? 'done' : ''}" ${wizard.step === index + 1 ? 'aria-current="step"' : ''}><b>${index + 1}</b>${label}</span>`).join('')}</nav><div class="create-layout"><div class="create-col"><section class="create-card"><div class="card-step"><span class="step-num">${wizard.step}</span><h2>${steps[wizard.step - 1]}</h2></div><div id="wizard-error" class="wizard-error" role="alert" ${wizard.error ? '' : 'hidden'}>${esc(wizard.error)}</div><form id="wizard-form">${content}</form></section></div><aside class="create-col"><section class="create-card"><div class="card-step"><h3>Account của bạn</h3></div><div class="conn-summary"><div class="conn-summary-row"><span>Nền tảng</span><strong>${PLATFORMS[wizard.platform].name}</strong></div><div class="conn-summary-row"><span>Trạng thái</span><strong>${wizard.step > 2 ? 'Đã xác thực' : 'Chưa xác thực'}</strong></div><div class="conn-summary-row"><span>Phiên</span><strong>${wizard.existing ? 'Đăng nhập lại' : 'Account mới'}</strong></div></div></section><p class="wizard-sim-note">Xác thực và đồng bộ trong bản này đều là mô phỏng, không kết nối Telegram/Google thật.</p></aside></div></div>`;
    tickCountdowns();
  }
  function startSync() {
    const wizard = state.wizard; if (!wizard) return;
    wizard.step = 3; wizard.error = ''; wizard.busy = true; wizard.checks = ['run', 'idle', 'idle']; wizard.log = ['[auth] verifying demo session']; renderWizard();
    const proceed = index => setTimeout(() => {
      if (state.wizard !== wizard || state.route !== 'wizard') return;
      if (index === 1 && state.syncFailure) {
        wizard.checks[index] = 'err'; wizard.busy = false; wizard.log.push('[chats] timeout · chưa tải được danh sách'); renderWizard(); return;
      }
      wizard.checks[index] = 'ok'; wizard.log.push(['[auth] session accepted', '[chats] chat list loaded', '[sync] recent messages synchronized'][index]);
      if (index < 2) { wizard.checks[index + 1] = 'run'; proceed(index + 1); }
      else wizard.busy = false;
      renderWizard();
    }, 900);
    proceed(0);
  }
  function finishWizard() {
    const wizard = state.wizard; const name = $('#wizard-name').value.trim();
    if (!name) return wizardError('Nhập tên để nhận biết account này.', 'wizard-name');
    const existing = S.accounts.find(account => account.id === wizard.existing);
    if (existing) { existing.name = name; existing.color = wizard.color; existing.health = 'ok'; existing.sync = 'ok'; existing.syncText = 'synced'; }
    else {
      const id = 'account-' + Date.now(); const chatId = id + '-welcome';
      S.accounts.push({ id, platform: wizard.platform, name, color: wizard.color, handle: wizard.platform === 'telegram' ? wizard.phone || 'QR · demo' : 'demo@example.com', health: 'ok', sync: 'ok', syncText: 'synced' });
      S.chats[chatId] = { id: chatId, acc: id, kind: 'dm', person: 'minh', name: 'Minh Trần', chatId: wizard.platform === 'telegram' ? String(5000000000 + Date.now() % 1000000000) : 'spaces/AAAA' + Date.now().toString(36).slice(-7), unread: 0, messages: [day('Hôm nay'), m('minh', nowHM(), 'Account đã kết nối. Đây là hội thoại mẫu để bạn thử gửi tin.')] };
      S.active = chatId; S.tabs.push(chatId);
    }
    state.wizard = null; navigate('shell'); toast(existing ? 'Đã kết nối lại account' : 'Đã thêm account');
  }

  function inboxRows() {
    const rows = Object.values(S.chats).filter(chat => (!state.inboxAccount || chat.acc === state.inboxAccount) && (state.inboxFilter === 'all' || (state.inboxFilter === 'unread' ? chat.unread > 0 : chat.mention)) && norm(chat.name + ' ' + (realMsgs(chat).at(-1)?.text || '')).includes(norm(state.inboxQuery)));
    const latestTimestamp = chat => {
      let date = new Date(); let latest = 0;
      for (const message of chat.messages) {
        if (message.type === 'day') {
          const match = message.label.match(/(\d{1,2})\/(\d{1,2})/);
          date = new Date();
          if (match) date = new Date(date.getFullYear(), Number(match[2]) - 1, Number(match[1]));
          else if (message.label.includes('Hôm qua')) date.setDate(date.getDate() - 1);
        } else if (message.from && message.time) {
          const [hour, minute] = message.time.split(':').map(Number);
          date.setHours(hour, minute, 0, 0); latest = date.getTime();
        }
      }
      return latest;
    };
    return rows.sort((first, second) => latestTimestamp(second) - latestTimestamp(first));
  }
  function renderInbox() {
    const rows = state.emptyList ? [] : inboxRows();
    view.innerHTML = `${header('All inboxes', 'Hội thoại gần đây từ mọi account', '', false)}<div class="inbox-shell"><div class="inbox-filters"><label>Account${select('inbox-account', [['', 'Mọi account'], ...S.accounts.map(account => [account.id, account.name])], state.inboxAccount)}</label><label>Trạng thái${select('inbox-filter', [['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['mention', 'Được mention']], state.inboxFilter)}</label><label class="inbox-search">Tìm hội thoại<input id="inbox-search" value="${esc(state.inboxQuery)}" placeholder="Tên hoặc tin gần đây" /></label></div><div class="inbox-count">${rows.length} hội thoại · mới nhất trước</div><div class="inbox-list">${rows.map(chat => { const account = acc(chat.acc); const latest = lastInfo(chat); return `<button class="inbox-row" data-r2="open-chat" data-chat="${chat.id}">${avatar(chat)}<span class="od-field od-fill"><strong>${esc(chat.name)}</strong><span class="od-truncate">${esc(latest.preview || 'Chưa có tin nhắn')}</span></span><span class="inbox-account" style="${connVar(account)}"><span class="conn-dot"></span>${esc(account.name)}</span><span class="inbox-unread">${chat.mention ? '@' : ''}${chat.unread ? `<span class="badge unread">${chat.unread}</span>` : ''}</span><time>${esc(latest.time || '—')}</time>${icon('chevron-right')}</button>`; }).join('') || '<div class="r2-empty"><h2>Không có hội thoại phù hợp</h2><p>Thử đổi account, bỏ lọc hoặc tìm bằng tên khác.</p>' + button('inbox-reset', 'Xoá bộ lọc') + '</div>'}</div></div>`;
  }
  const settingsRow = (title, help, control, glyphName = 'settings') => `<div class="settings-row"><span class="settings-icon">${icon(glyphName)}</span><div class="settings-copy"><strong>${title}</strong><span>${help}</span></div><div class="settings-control">${control}</div></div>`;
  function renderSettings() {
    const prefs = state.preferences;
    const shortcuts = [['Thêm account', '⌘N'], ['Chat & lệnh', '⌘K'], ['Tìm tin mọi account', '⌘⇧F'], ['Đổi account', '⌘1…9'], ['Tab trước / sau', '⌘[ / ⌘]'], ['Chat chưa đọc', '⌘↑ / ⌘↓'], ['Đổi tên account', '⌘E'], ['Xoá account', '⌘⌫'], ['Sidebar / Inspector', '⌘B / ⌘I'], ['Huỷ trả lời', 'Esc'], ['Settings', '⌘,'], ['Đóng tab', '⌘W']];
    view.innerHTML = `${header('Settings', 'Giao diện, account và thông báo', '', false)}<div class="settings-shell"><section class="settings-card"><h3>Appearance</h3>
      ${settingsRow('Theme', 'Áp dụng cho toàn bộ cửa sổ.', select('settings-theme', themes, document.body.dataset.theme || ''), 'palette')}
      ${settingsRow('Interface font size', 'Bước 0.5px. Bấm giá trị để về 13px.', `<div class="font-stepper">${button('font-down', '−', false, 'aria-label="Giảm cỡ chữ"')}${button('font-reset', prefs.size + 'px', false, 'aria-label="Đặt lại cỡ chữ"')}${button('font-up', '+', false, 'aria-label="Tăng cỡ chữ"')}</div>`)}
      ${settingsRow('Interface font family', 'Font giao diện và nội dung hội thoại.', select('settings-uiFont', [['', 'Exo 2 · mặc định'], ['system-ui', 'System UI']], prefs.uiFont))}
      ${settingsRow('Editor font family', 'ID, giờ, status, log và phím tắt.', select('settings-monoFont', [['', 'Google Sans Code · mặc định'], ['ui-monospace', 'System monospace']], prefs.monoFont))}
      ${settingsRow('Compact density', 'Thu gọn hàng hội thoại và khoảng cách.', toggle('settings-compact', prefs.compact, 'Compact density'))}
      ${settingsRow('Vim mode', 'Không áp dụng: ChatMin không có code editor. Composer giữ nhập chat thông thường.', toggle('settings-vim', false, 'Vim mode không hỗ trợ', 'disabled'))}
      </section><section class="settings-card"><h3>Accounts</h3>${S.accounts.map(account => { const health = statusOf(account); return `<div class="account-row" style="${connVar(account)}"><button type="button" class="account-dot" data-r2="color-pop" data-account="${account.id}" aria-label="Đổi màu ${esc(account.name)}, đang là ${labels[account.color]}" aria-haspopup="dialog" data-tip="Đổi màu"><span class="conn-dot"></span></button><strong class="account-name">${esc(account.name)}</strong><span class="account-platform">${glyph(account.platform)}${PLATFORMS[account.platform].name}</span><span class="account-handle">${esc(account.handle)}</span><span class="account-status ${health}"><i></i>${healthLabels[health]}</span><button type="button" class="tool-btn icon-only" data-r2="account-menu" data-account="${account.id}" aria-label="Thao tác với ${esc(account.name)}" aria-haspopup="menu" data-tip="Đổi tên, đăng nhập lại, xoá">${icon('ellipsis')}</button></div>`; }).join('') || '<p class="r2-muted">Chưa có account. Thêm account để bắt đầu.</p>'}<div class="settings-add">${button('add', 'Add account', true)}</div></section>
      <section class="settings-card"><h3>Notifications</h3>${S.accounts.map(account => { const prefs = accountSettings(account); return `<div class="notification-account"><h4>${esc(account.name)}</h4>${settingsRow('Thông báo', 'Bật thông báo cho account này.', toggle('notify-' + account.id, prefs.enabled, 'Thông báo ' + account.name, `data-notification="enabled" data-account="${account.id}"`), 'bell')}${settingsRow('Chỉ mention', 'Chỉ báo khi bạn được nhắc tên.', toggle('mention-' + account.id, prefs.mentions, 'Chỉ mention ' + account.name, `data-notification="mentions" data-account="${account.id}"`))}${settingsRow('Im lặng theo giờ', 'Dùng múi giờ máy. Khung giờ có thể qua nửa đêm.', toggle('quiet-' + account.id, prefs.quiet, 'Im lặng ' + account.name, `data-notification="quiet" data-account="${account.id}"`))}<div class="quiet-hours"><label>Từ<input type="time" aria-label="Im lặng từ ${esc(account.name)}" value="${prefs.from}" data-notification="from" data-account="${account.id}" /></label><label>Đến<input type="time" aria-label="Im lặng đến ${esc(account.name)}" value="${prefs.to}" data-notification="to" data-account="${account.id}" /></label></div>${settingsRow('Xem trước nội dung', 'Hiện nội dung tin trong thông báo.', toggle('preview-' + account.id, prefs.preview, 'Xem trước ' + account.name, `data-notification="preview" data-account="${account.id}"`))}<div class="notification-preview" id="notification-preview-${account.id}">${notificationPreview(account)}</div></div>`; }).join('') || '<p>Thêm account để thiết lập thông báo.</p>'}<p class="r2-muted">Prototype áp dụng tuỳ chọn vào bản xem trước; chưa gửi thông báo hệ điều hành.</p></section>
      <section class="settings-card"><h3>Shortcuts</h3><div class="shortcut-grid">${shortcuts.map(([label, keys]) => `<div class="shortcut-row"><span>${label}</span><kbd class="kbd">${keys}</kbd></div>`).join('')}</div></section><p class="r2-muted">Tuỳ chọn giao diện lưu trên trình duyệt này. Dữ liệu account và tin nhắn là dữ liệu mẫu trong phiên.</p></div>`;
  }
  function accountPopover(kind, anchor) {
    closePop();
    const account = acc(anchor.dataset.account); const id = account.id;
    const node = document.createElement('div'); node.className = 'index-context-menu account-pop';
    if (kind === 'color-pop') { node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', 'Màu ' + account.name); node.innerHTML = `<div class="account-pop-head">Màu nhận diện</div>${swatches(account.color, id)}`; }
    else { node.setAttribute('role', 'menu'); node.innerHTML = [['pencil', 'Đổi tên', 'rename'], ['refresh-cw', 'Đăng nhập lại', 'reauth'], ['trash-2', 'Xoá account…', 'delete']].map(([glyphName, label, action]) => `<button type="button" class="context-item${action === 'delete' ? ' danger' : ''}" role="menuitem" data-r2="${action}" data-account="${id}">${icon(glyphName)}<span>${label}</span><span></span></button>`).join(''); }
    placePop(node, anchor);
  }
  function notificationPreview(account) {
    const prefs = accountSettings(account);
    if (!prefs.enabled) return 'Thông báo đang tắt';
    const current = new Date().toTimeString().slice(0, 5);
    const inQuiet = prefs.from <= prefs.to ? current >= prefs.from && current < prefs.to : current >= prefs.from || current < prefs.to;
    if (prefs.quiet && inQuiet) return `Đang im lặng · ${prefs.from}–${prefs.to}`;
    return `${prefs.mentions ? 'Chỉ khi được nhắc tên · ' : ''}${prefs.preview ? 'Minh Trần: Bạn review giúp PR này nhé?' : 'Bạn có tin nhắn mới'}${prefs.quiet ? ` · Im lặng ${prefs.from}–${prefs.to}` : ''}`;
  }
  function applyPreferences() {
    const prefs = state.preferences;
    document.documentElement.style.setProperty('--ui-font-size', prefs.size + 'px');
    document.documentElement.style.setProperty('--font-body', prefs.uiFont || 'var(--font-body-default)');
    document.documentElement.style.setProperty('--font-mono', prefs.monoFont || 'var(--font-mono-default)');
    document.body.classList.toggle('chatmin-compact', prefs.compact);
    if (prefs.theme) document.body.dataset.theme = prefs.theme; else delete document.body.dataset.theme;
    document.body.classList.toggle('light', LIGHT.includes(prefs.theme)); $('#theme-select').value = prefs.theme;
    try { localStorage.setItem('chatmin.preferences', JSON.stringify(prefs)); } catch {}
  }

  function decorateSidebar() {
    for (const account of S.accounts) {
      const group = $(`[data-collapse="${account.id}"]`)?.parentElement;
      if (!group) continue;
      const health = statusOf(account);
      if (health !== 'ok') {
        const head = $('.acc-head', group); $('.acc-state', head)?.remove();
        head.insertAdjacentHTML('beforeend', `<span class="account-health ${health}" title="${healthLabels[health]}"><i></i><span>${healthLabels[health]}</span></span>`);
      }
    }
    const inbox = $('#all-inbox');
    if (inbox) { inbox.classList.toggle('active', state.route === 'inbox'); state.route === 'inbox' ? inbox.setAttribute('aria-current', 'page') : inbox.removeAttribute('aria-current'); }
    if (TAB_ROUTES.includes(state.route)) document.querySelectorAll('#sidebar .chat-row.active').forEach(row => row.classList.remove('active'));
    const scroll = $('.side-scroll'); if (!scroll) return;
    if (state.emptyList) scroll.innerHTML = `<div class="r2-empty small"><strong>Chưa có hội thoại</strong><p>Thêm account hoặc làm mới danh sách.</p>${button('clear-states', 'Làm mới')}</div>`;
    if (state.loadingList) scroll.insertAdjacentHTML('beforeend', `<div class="section-veil on" role="status"><span class="veil-spinner"></span><span>Đang tải danh sách…</span></div>`);
  }
  function decorateStatus() {
    const statuses = document.querySelectorAll('#statusbar .acc-status');
    statuses.forEach((element, index) => { const account = S.accounts[index]; if (!account) return; const health = statusOf(account); if (health !== 'ok') element.innerHTML = `<span class="conn-dot"></span>${esc(account.name)}<span class="health-text ${health}">${healthLabels[health]}</span>`; });
  }
  function sendBlocked() {
    const account = acc(S.chats[S.active]?.acc);
    return ['rate', 'expired', 'offline', 'reconnecting'].includes(statusOf(account)) || state.loadingMessages;
  }
  function decorateChat() {
    const chat = S.chats[S.active]; if (!chat || state.route !== 'shell') return;
    const account = acc(chat.acc); const health = statusOf(account);
    $('#health-banner')?.remove();
    const head = $('.conv-head');
    const messages = { offline: 'Account đang offline. Nháp vẫn được giữ trên máy.', reconnecting: 'Đang kết nối lại. Tin nhắn sẽ khả dụng khi có kết nối.', expired: 'Phiên đăng nhập đã hết hạn.', rate: 'Gửi quá nhanh. Thử lại sau' };
    if (messages[health] && head) head.insertAdjacentHTML('beforeend', `<div class="health-banner ${health}" id="health-banner" role="status">${icon(health === 'offline' ? 'wifi-off' : 'circle-alert')}<span>${messages[health]}${health === 'rate' ? ` <b id="rate-countdown">${countdown(account.rateUntil)}s</b>` : ''}</span>${health === 'expired' ? button('reauth', 'Đăng nhập lại', false, `data-account="${account.id}"`) : health === 'offline' ? button('reconnect', 'Kết nối lại', false, `data-account="${account.id}"`) : ''}</div>`);
    $('#content')?.classList.toggle('with-health', !!messages[health]);
    const composer = $('#composer');
    if (composer) { composer.querySelectorAll('textarea, button').forEach(control => control.disabled = sendBlocked()); composer.classList.toggle('composer-blocked', sendBlocked()); }
    $('#message-veil')?.remove();
    if (state.loadingMessages) $('#msgs')?.insertAdjacentHTML('beforeend', `<div class="section-veil on" id="message-veil" role="status"><span class="veil-spinner"></span><span>Đang tải tin nhắn…</span></div>`);
  }
  function setHealth(health, accountId) {
    const account = acc(accountId) || activeAccount(); if (!account) return;
    account.health = health; if (health === 'rate') account.rateUntil = Date.now() + 15000;
    if (health === 'ok') { account.sync = 'ok'; account.syncText = 'synced'; }
    renderAll(); decorateStatus();
  }
  function clearStates() {
    state.emptyList = state.loadingList = state.loadingMessages = state.syncFailure = false;
    for (const account of S.accounts) { account.health = 'ok'; account.sync = 'ok'; account.syncText = 'synced'; }
    renderAll(); decorateStatus();
  }
  function openDebug() {
    $('#debug-panel')?.remove(); state.debug = true;
    $('#overlay-root').insertAdjacentHTML('beforeend', `<div class="debug-panel" id="debug-panel" role="dialog" aria-label="Debug review"><div class="debug-head"><strong>Review states</strong>${button('debug-close', 'Đóng')}</div><p>Dữ liệu mẫu được giữ khi chuyển màn.</p><div class="r2-actions">${['welcome', 'wizard', 'shell', 'inbox', 'settings'].map(route => button('debug-route', route, false, `data-route="${route}"`)).join('')}</div><label>Account${select('debug-account', S.accounts.map(account => [account.id, account.name]), activeAccount()?.id)}</label><div class="debug-states">${Object.entries(healthLabels).map(([health, label]) => button('debug-health', label, false, `data-health="${health}"`)).join('')}</div><div class="debug-flags">${[['emptyList', 'Danh sách rỗng'], ['loadingList', 'Tải danh sách'], ['loadingMessages', 'Tải tin nhắn'], ['syncFailure', 'Lỗi sync wizard'], ['require2fa', 'Telegram có 2FA']].map(([key, label]) => `<label><input type="checkbox" data-debug-flag="${key}" ${state[key] ? 'checked' : ''}/>${label}</label>`).join('')}</div>${button('clear-states', 'Đặt lại trạng thái')}<small>⌘⇧D bật/tắt · Esc đóng<br>OTP đúng: 123456 · 2FA: chatmin</small></div>`);
    $('#debug-panel button')?.focus();
  }
  function tickCountdowns() {
    const wizard = state.wizard;
    const resend = $('#otp-resend');
    if (resend && wizard) { const left = countdown(wizard.otpUntil); resend.disabled = left > 0; resend.textContent = left > 0 ? `Gửi lại sau ${left}s` : 'Gửi lại mã'; }
    for (const account of S.accounts) if (statusOf(account) === 'rate') {
      const left = countdown(account.rateUntil);
      if (acc(S.chats[S.active]?.acc) === account && $('#rate-countdown')) $('#rate-countdown').textContent = left + 's';
      if (!left) { account.health = 'ok'; if (state.route === 'shell') { renderSidebar(); renderStatus(); decorateChat(); } }
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-r2]'); if (!target) return;
    const action = target.dataset.r2; const wizard = state.wizard;
    if (target.closest('.index-context-menu')) closePop();
    if (action === 'shell') return navigate('shell');
    if (action === 'color-pop' || action === 'account-menu') return accountPopover(action, target);
    if (action === 'add') return startWizard();
    if (action === 'reauth') return startWizard(target.dataset.account);
    if (action === 'open-chat') return openChat(target.dataset.chat);
    if (action === 'wizard-cancel') { state.wizard = null; return navigate(state.returnRoute === 'wizard' ? 'shell' : state.returnRoute); }
    if (action === 'platform') { wizard.platform = target.dataset.platform; wizard.color = wizard.platform === 'gchat' ? 'purple' : 'blue'; return renderWizard(); }
    if (action === 'wizard-next') { wizard.step++; wizard.error = ''; if (wizard.step === 2) wizard.auth = 'phone'; return renderWizard(); }
    if (action === 'wizard-back') { wizard.error = ''; if (wizard.step === 2 && ['otp', 'twofa'].includes(wizard.auth)) wizard.auth = 'phone'; else if (wizard.existing && wizard.step === 2) return navigate(state.returnRoute); else { wizard.step = Math.max(wizard.existing ? 2 : 1, wizard.step - 1); if (wizard.step === 2) wizard.auth = 'phone'; } return renderWizard(); }
    if (action === 'auth-phone' || action === 'auth-qr') { wizard.auth = action === 'auth-qr' ? 'qr' : 'phone'; wizard.error = ''; return renderWizard(); }
    if (action === 'phone-submit') {
      const phone = $('#wizard-phone').value.trim();
      if (!/^\+[1-9][\d\s-]{7,17}$/.test(phone)) return wizardError('Nhập số có mã quốc gia, ví dụ +84 912 345 678.', 'wizard-phone');
      wizard.phone = phone; wizard.auth = 'otp'; wizard.otpUntil = Date.now() + 30000; wizard.error = ''; return renderWizard();
    }
    if (action === 'otp-resend') { if (countdown(wizard.otpUntil)) return; wizard.otpUntil = Date.now() + 30000; tickCountdowns(); toast('Đã gửi lại mã demo'); return; }
    if (action === 'otp-submit') { if ($('#wizard-otp').value.trim() !== '123456') return wizardError('OTP không đúng. Dùng 123456 để tiếp tục demo hoặc gửi lại mã.', 'wizard-otp'); wizard.error = ''; if (state.require2fa) { wizard.auth = 'twofa'; return renderWizard(); } return startSync(); }
    if (action === 'twofa-submit') { if ($('#wizard-password').value !== 'chatmin') return wizardError('Mật khẩu demo không đúng. Dùng chatmin.', 'wizard-password'); return startSync(); }
    if (action === 'qr-confirm' || action === 'oauth-allow') return startSync();
    if (action === 'oauth-start' || action === 'oauth-reopen') { wizard.auth = 'oauth-wait'; wizard.error = ''; renderWizard(); if (action === 'oauth-reopen') $('#oauth-reopen-note').textContent = 'Đã mở lại yêu cầu đăng nhập mô phỏng.'; return; }
    if (action === 'oauth-cancel' || action === 'oauth-deny') { wizard.auth = 'phone'; wizard.error = action === 'oauth-deny' ? 'Google đã từ chối quyền truy cập. Đăng nhập lại và chọn Cho phép để tiếp tục.' : ''; return renderWizard(); }
    if (action === 'sync-retry') { state.syncFailure = false; return startSync(); }
    if (action === 'wizard-finish') return finishWizard();
    if (action === 'color') {
      if (target.dataset.account) { const id = target.dataset.account; acc(id).color = target.dataset.color; renderRoute(); return $(`[data-r2="color-pop"][data-account="${id}"]`)?.focus(); }
      wizard.name = $('#wizard-name').value; wizard.color = target.dataset.color; return renderWizard();
    }
    if (action === 'rename') { const account = acc(target.dataset.account); return promptDialog('Đổi tên account', account.name, value => { account.name = value; renderRoute(); }); }
    if (action === 'delete') {
      const account = acc(target.dataset.account);
      return confirmDialog(`Xoá account “${account.name}”?`, 'Gỡ account và dữ liệu mẫu của account khỏi phiên này. Không xoá tài khoản trên nền tảng.', 'Xoá account', () => {
        for (const chat of Object.values(S.chats)) if (chat.acc === account.id) { delete S.chats[chat.id]; delete S.drafts[chat.id]; delete S.replyTo[chat.id]; delete S.editing[chat.id]; S.tabs = S.tabs.filter(id => id !== chat.id); }
        S.accounts = S.accounts.filter(item => item.id !== account.id); if (!S.chats[S.active]) S.active = S.tabs[0] || null;
        navigate(S.accounts.length ? 'settings' : 'welcome');
      });
    }
    if (action.startsWith('font-')) { state.preferences.size = action === 'font-reset' ? 13 : Math.min(18, Math.max(11, state.preferences.size + (action === 'font-up' ? .5 : -.5))); applyPreferences(); return renderSettings(); }
    if (action === 'inbox-reset') { state.inboxAccount = ''; state.inboxFilter = 'all'; state.inboxQuery = ''; state.emptyList = false; return renderInbox(); }
    if (action === 'reconnect') { const accountId = target.dataset.account; setHealth('reconnecting', accountId); setTimeout(() => { if (statusOf(acc(accountId)) === 'reconnecting') setHealth('ok', accountId); }, 2000); return; }
    if (action === 'debug-close') { state.debug = false; $('#debug-panel').remove(); return; }
    if (action === 'debug-route') { target.dataset.route === 'wizard' ? startWizard() : navigate(target.dataset.route); return; }
    if (action === 'debug-health') return setHealth(target.dataset.health, $('#debug-account').value);
    if (action === 'clear-states') { clearStates(); if (state.debug) openDebug(); }
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'wizard-form') return;
    event.preventDefault(); const primary = event.target.querySelector('.tool-btn.primary'); primary?.click();
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'inbox-account') { state.inboxAccount = target.value; return renderInbox(); }
    if (target.id === 'inbox-filter') { state.inboxFilter = target.value; return renderInbox(); }
    if (['settings-theme', 'settings-uiFont', 'settings-monoFont', 'settings-compact'].includes(target.id)) { const key = target.id.slice(9); state.preferences[key] = target.type === 'checkbox' ? target.checked : target.value; applyPreferences(); return; }
    if (target.id === 'theme-select') { state.preferences.theme = target.value; applyPreferences(); }
    if (target.dataset.notification) {
      const account = acc(target.dataset.account); accountSettings(account)[target.dataset.notification] = target.type === 'checkbox' ? target.checked : target.value;
      $('#notification-preview-' + account.id).textContent = notificationPreview(account); return;
    }
    if (target.dataset.debugFlag) { state[target.dataset.debugFlag] = target.checked; renderAll(); decorateStatus(); }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'inbox-search') { const position = event.target.selectionStart; state.inboxQuery = event.target.value; renderInbox(); const input = $('#inbox-search'); input.focus(); input.setSelectionRange(position, position); }
  });
  document.addEventListener('focusout', event => {
    if (event.target.id === 'wizard-phone' && event.target.value && !/^\+[1-9][\d\s-]{7,17}$/.test(event.target.value)) { const hint = $('#wizard-phone-error'); hint.textContent = 'Số điện thoại cần có mã quốc gia, ví dụ +84.'; event.target.setAttribute('aria-invalid', 'true'); }
  });
  document.addEventListener('keydown', event => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); event.stopImmediatePropagation(); if ($('#debug-panel')) { $('#debug-panel').remove(); state.debug = false; } else openDebug(); return; }
    if (mod && event.key.toLowerCase() === 'n') { event.preventDefault(); event.stopImmediatePropagation(); startWizard(); return; }
    if (mod && event.key === ',') { event.preventDefault(); event.stopImmediatePropagation(); navigate('settings'); return; }
    if (event.key === 'Escape' && $('#debug-panel')) { event.stopImmediatePropagation(); $('#debug-panel').remove(); state.debug = false; return; }
    if (TAB_ROUTES.includes(state.route) && mod && ['i', 'w'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'w') navigate('shell'); return; }
    if (['welcome', 'wizard'].includes(state.route) && !(mod && ['k', 'f'].includes(event.key.toLowerCase()))) {
      if (mod && ['b', 'i', 'w', 'e', 'Backspace', '[', ']', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
  }, true);
  window.CM2 = { route: () => state.route, navigate, showShell, startWizard, renderRoute, decorateChat, decorateSidebar, decorateStatus, sendBlocked };
  try {
    const saved = JSON.parse(localStorage.getItem('chatmin.preferences') || '{}');
    state.preferences.size = Math.max(11, Math.min(18, Number(saved.size) || 13));
    state.preferences.theme = themes.some(([key]) => key === saved.theme) ? saved.theme : '';
    state.preferences.uiFont = saved.uiFont === 'system-ui' ? saved.uiFont : '';
    state.preferences.monoFont = saved.monoFont === 'ui-monospace' ? saved.monoFont : '';
    state.preferences.compact = saved.compact === true;
  } catch {}
  applyPreferences();
  setInterval(tickCountdowns, 1000);
  renderAll(); decorateStatus();
})();
