import { useEffect, useState } from "react";
import { api, openPath, pickFolder, type StorageView } from "../lib/bridge";
import { fileSize } from "../lib/format";
import type { AiView } from "../lib/types";
import { HEALTH_LABELS, PLATFORMS } from "../lib/platforms";
import { LANGS } from "../ai";
import { THEMES } from "../lib/themes";
import type { BackgroundMode } from "../lib/appearance";
import { anchor, confirmDialog, DEFAULT_NOTIFY, fail, toast, useApp, type NotifyPrefs } from "../store";
import { removeAccount, renameAccount } from "../App";
import { startWizard } from "./Wizard";
import { Glyph, Icon, type IconName } from "../ui/Icon";
import { isMobile } from "../lib/mobile";

const SHORTCUTS: [string, string][] = [
  ["Thêm tài khoản", "⌘N"], ["Chat & lệnh", "⌘K"], ["Tìm tin mọi tài khoản", "⌘⇧F"], ["Tìm trong chat", "⌘F"],
  ["Tới tab 1…8 / tab cuối", "⌘1…8 / ⌘9"], ["Tab trước / sau", "⌘[ / ⌘]"], ["Chat chưa đọc", "⌘↑ / ⌘↓"], ["Đổi tên tài khoản", "⌘E"],
  ["Xoá tài khoản", "⌘⌫"], ["Danh sách / Chi tiết", "⌘B / ⌘R"], ["Sửa tin vừa gửi", "↑"], ["Huỷ trả lời", "Esc"],
  ["Cài đặt", "⌘,"], ["Đóng tab", "⌘W"], ["Gợi ý trả lời", "⌘J"], ["Dịch nháp", "⌥R"],
];

function Row({ title, help, icon = "settings", children }: { title: string; help: string; icon?: IconName; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-icon"><Icon name={icon} /></span>
      <div className="settings-copy">
        <strong>{title}</strong>
        <span>{help}</span>
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span />
    </label>
  );
}

export function Settings() {
  const prefs = useApp((s) => s.prefs);
  const accounts = useApp((s) => s.accounts);
  const health = useApp((s) => s.health);
  const notif = useApp((s) => s.notif);
  const permission = useApp((s) => s.notifyPermission);
  const mac = !isMobile && /Mac/.test(navigator.platform);
  const [island, setIsland] = useState(true);
  const [islandSaving, setIslandSaving] = useState(false);
  useEffect(() => {
    if (!mac) return;
    let live = true;
    void api.notifyIsland().then((enabled) => { if (live) setIsland(enabled); }).catch(fail);
    return () => { live = false; };
  }, [mac]);
  const setPrefs = (p: Partial<typeof prefs>) => useApp.setState((s) => ({ prefs: { ...s.prefs, ...p } }));
  const setNotif = (id: string, p: Partial<NotifyPrefs>) =>
    useApp.setState((s) => ({ notif: { ...s.notif, [id]: { ...DEFAULT_NOTIFY, ...s.notif[id], ...p } } }));

  return (
    <>
      <header className="r2-header mobile-page-heading">
        <div className="od-field">
          <h1>Cài đặt</h1>
          <p>Giao diện, tài khoản, thông báo và bộ nhớ</p>
        </div>
      </header>
      <div className="settings-shell">
        <section className="settings-card">
          <h3>Giao diện</h3>
          <Row title="Chủ đề giao diện" help={isMobile ? "Áp dụng cho toàn bộ ứng dụng." : "Áp dụng cho toàn bộ cửa sổ."} icon="palette">
            <select className="settings-select" aria-label="Chủ đề giao diện" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value })}>
              <option value="">Bearded Arc · dark</option>
              {THEMES.filter((t) => t.id !== "dark" && t.id !== "default-dark").map((t) => (
                <option key={t.id} value={t.id}>{t.label}{t.base === "light" ? " · light" : ""}</option>
              ))}
            </select>
          </Row>
          {!isMobile && <>
          <Row title="Nền cửa sổ" help="Nền toàn cửa sổ, gồm cả hai dock. Các thành phần nội dung giữ nền riêng." icon="palette">
            <select className="settings-select" aria-label="Nền cửa sổ" value={prefs.backgroundMode} onChange={(e) => setPrefs({ backgroundMode: e.target.value as BackgroundMode })}>
              <option value="solid">Nền đặc</option>
              <option value="glass">Kính mờ</option>
              <option value="clear">Xuyên desktop</option>
            </select>
          </Row>
          {prefs.backgroundMode !== "solid" && <Row title="Độ trong suốt của nền" help="Kéo sang phải để thấy desktop rõ hơn. Không làm mờ chữ.">
            <div className="background-slider">
              <input type="range" min="0" max="100" step="1" aria-label="Độ trong suốt của nền" aria-valuetext={`${prefs.backgroundTransparency}%`} value={prefs.backgroundTransparency} onChange={(e) => setPrefs({ backgroundTransparency: Number(e.target.value) })} />
              <output>{prefs.backgroundTransparency}%</output>
              <button type="button" className="tool-btn" onClick={() => setPrefs({ backgroundMode: "glass", backgroundTransparency: 35 })}>Đặt lại</button>
            </div>
          </Row>}
          <p className="r2-muted">Nền xuyên desktop hiển thị trong ứng dụng desktop. Tùy chọn giảm độ trong suốt của hệ thống được ưu tiên.</p>
          </>}
          <Row title="Cỡ chữ giao diện" help="Bước 0.5px. Bấm giá trị để về 13px.">
            <div className="font-stepper">
              <button type="button" className="tool-btn" aria-label="Giảm cỡ chữ" disabled={prefs.size <= 11} onClick={() => setPrefs({ size: Math.max(11, prefs.size - 0.5) })}>−</button>
              <button type="button" className="tool-btn" aria-label="Đặt lại cỡ chữ" onClick={() => setPrefs({ size: 13 })}>{prefs.size}px</button>
              <button type="button" className="tool-btn" aria-label="Tăng cỡ chữ" disabled={prefs.size >= 18} onClick={() => setPrefs({ size: Math.min(18, prefs.size + 0.5) })}>+</button>
            </div>
          </Row>
          <Row title="Phông chữ giao diện" help="Font giao diện và nội dung hội thoại.">
            <select className="settings-select" aria-label="Phông chữ giao diện" value={prefs.uiFont} onChange={(e) => setPrefs({ uiFont: e.target.value })}>
              <option value="">Exo 2 · mặc định</option>
              <option value="system-ui">System UI</option>
            </select>
          </Row>
          <Row title="Phông chữ thông tin phụ" help="Mã định danh, thời gian, trạng thái và phím tắt.">
            <select className="settings-select" aria-label="Phông chữ thông tin phụ" value={prefs.monoFont} onChange={(e) => setPrefs({ monoFont: e.target.value })}>
              <option value="">Google Sans Code · mặc định</option>
              <option value="ui-monospace">System monospace</option>
            </select>
          </Row>
          <Row title="Giao diện thu gọn" help="Thu gọn hàng hội thoại và khoảng cách.">
            <Toggle checked={prefs.compact} label="Giao diện thu gọn" onChange={(v) => setPrefs({ compact: v })} />
          </Row>
        </section>

        <AiCard />

        <section className="settings-card">
          <h3>Tài khoản</h3>
          {accounts.length ? (
            accounts.map((a) => {
              const h = health[a.id]?.health ?? "ok";
              const shown = h;
              return (
                <div key={a.id} className="account-row" style={{ "--conn": `var(--conn-${a.color})` } as React.CSSProperties}>
                  <button
                    type="button"
                    className="account-dot"
                    aria-label={`Đổi màu ${a.name}`}
                    aria-haspopup="dialog"
                    data-tip="Đổi màu"
                    onClick={(e) => useApp.setState({ pop: { kind: "color", ...anchor(e.currentTarget), accountId: a.id } })}
                  >
                    <span className="conn-dot" />
                  </button>
                  <strong className="account-name">{a.name}</strong>
                  <span className="account-platform"><Glyph platform={a.platform} />{PLATFORMS[a.platform].name}</span>
                  <span className="account-handle">{a.handle}</span>
                  <span className={`account-status ${shown}`}><i />{HEALTH_LABELS[shown]}</span>
                  <button
                    type="button"
                    className="tool-btn icon-only"
                    aria-label={`Thao tác với ${a.name}`}
                    aria-haspopup="menu"
                    data-tip="Đổi tên, đăng nhập lại, xoá"
                    onClick={(e) =>
                      useApp.setState({
                        pop: {
                          kind: "menu",
                          ...anchor(e.currentTarget),
                          items: [
                            { icon: "pencil", label: "Đổi tên", run: () => renameAccount(a.id) },
                            a.platform === "messenger" || a.platform === "zalo"
                              ? { icon: "refresh-cw", label: "Tải lại trang", run: () => void api.webReload(a.id) }
                              : { icon: "refresh-cw", label: "Đăng nhập lại", run: () => startWizard(a.id) },
                            { icon: "trash-2", label: "Xoá tài khoản…", danger: true, run: () => removeAccount(a.id) },
                          ],
                        },
                      })
                    }
                  >
                    <Icon name="ellipsis" />
                  </button>
                </div>
              );
            })
          ) : (
            <p className="r2-muted">Chưa có tài khoản. Thêm tài khoản để bắt đầu.</p>
          )}
          <div className="settings-add">
            <button type="button" className="tool-btn primary" onClick={() => startWizard()}>Thêm tài khoản</button>
          </div>
        </section>

        <section className="settings-card">
          <h3>Thông báo</h3>
          {mac && (
            <Row title="Notification Island" help="Chỉ báo ở notch, không trùng banner góc phải. Màu theo giao diện ChatMin; rê chuột để xem các nhóm tin. Island chạy im lặng theo cài đặt ChatMin; tắt để dùng banner và Focus macOS." icon="bell">
              <Toggle checked={island} disabled={islandSaving} label="Notification Island" onChange={(enabled) => {
                setIslandSaving(true);
                void api.notifyIsland(enabled).then(setIsland).catch(fail).finally(() => setIslandSaving(false));
              }} />
            </Row>
          )}
          {isMobile && permission !== "granted" && (
            <Row title="Quyền thông báo" help={permission === "denied" ? "Android đang chặn thông báo của ChatMin. Mở Cài đặt → Ứng dụng → ChatMin → Thông báo để bật." : "ChatMin chưa được phép gửi thông báo."} icon="bell-off">
              <button className="tool-btn primary" onClick={() => void api.notifyPermission(true).then((state) => useApp.setState({ notifyPermission: state })).catch(fail)}>
                Cho phép thông báo
              </button>
            </Row>
          )}
          <Row
            title="Kiểm tra thông báo"
            help={isMobile ? "Gửi một thông báo thử. Nếu không thấy, kiểm tra quyền Thông báo của ChatMin trong Cài đặt Android." : mac && island ? "Hiện thông báo thử ở notch. Rê chuột lên để giữ thông báo, bấm × để đóng." : "Gửi thông báo hệ thống ngay. Nếu không thấy, kiểm tra quyền thông báo của ChatMin trong cài đặt hệ thống."}
            icon="bell"
          >
            <button className="tool-btn" onClick={() => void api.notifyTest().catch(fail)}>
              {mac && island ? "Xem thử ở notch" : "Gửi thông báo thử"}
            </button>
          </Row>
          {accounts.map((a) => {
            const p = { ...DEFAULT_NOTIFY, ...notif[a.id] };
            return (
              <div key={a.id} className="notification-account">
                <h4>{a.name}</h4>
                <Row title="Thông báo" help="Bật thông báo cho tài khoản này." icon="bell">
                  <Toggle checked={p.enabled} label={`Thông báo ${a.name}`} onChange={(v) => setNotif(a.id, { enabled: v })} />
                </Row>
                <Row title="Chỉ khi được nhắc tên" help="Chỉ báo khi bạn được nhắc tên.">
                  <Toggle checked={p.mentions} label={`Chỉ khi được nhắc tên ${a.name}`} onChange={(v) => setNotif(a.id, { mentions: v })} />
                </Row>
                <Row title="Im lặng theo giờ" help="Dùng múi giờ máy. Khung giờ có thể qua nửa đêm.">
                  <Toggle checked={p.quiet} label={`Im lặng ${a.name}`} onChange={(v) => setNotif(a.id, { quiet: v })} />
                </Row>
                <div className="quiet-hours">
                  <label>Từ<input type="time" value={p.from} aria-label={`Im lặng từ ${a.name}`} onChange={(e) => setNotif(a.id, { from: e.target.value })} /></label>
                  <label>Đến<input type="time" value={p.to} aria-label={`Im lặng đến ${a.name}`} onChange={(e) => setNotif(a.id, { to: e.target.value })} /></label>
                </div>
                <Row title="Xem trước nội dung" help="Hiện nội dung tin trong thông báo.">
                  <Toggle checked={p.preview} label={`Xem trước ${a.name}`} onChange={(v) => setNotif(a.id, { preview: v })} />
                </Row>
                <div className="notification-preview">{preview(p)}</div>
              </div>
            );
          })}
          {!accounts.length && <p>Thêm tài khoản để thiết lập thông báo.</p>}
        </section>

        <StorageCard />

        {!isMobile && <section className="settings-card">
          <h3>Phím tắt</h3>
          <div className="shortcut-grid">
            {SHORTCUTS.map(([l, k]) => (
              <div key={l} className="shortcut-row"><span>{l}</span><kbd className="kbd">{k}</kbd></div>
            ))}
          </div>
        </section>}
        <p className="r2-muted">Giao diện, thông báo và phiên đăng nhập được lưu trên máy này.</p>
      </div>
    </>
  );
}

const ENDPOINT_HINT = {
  openai: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
};

function AiCard() {
  const prefs = useApp((s) => s.prefs);
  const [cfg, setCfg] = useState<AiView | null>(null);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    api.aiConfig().then(setCfg).catch(fail);
  }, []);
  if (!cfg) return null;

  const save = (patch: Partial<AiView> & { key?: string }) => {
    const next = { ...cfg, ...patch };
    setCfg({ ...next, hasKey: patch.key !== undefined ? !!patch.key : cfg.hasKey });
    const { hasKey: _, ...body } = next;
    api.aiConfigSet({ ...body, key: patch.key }).catch(fail);
  };
  const setPrefs = (p: Partial<typeof prefs>) => useApp.setState((s) => ({ prefs: { ...s.prefs, ...p } }));
  const test = async () => {
    setTesting(true);
    try {
      const [out] = await api.aiRun("translate_to", ["Chào anh, chiều nay mình họp lúc 3h nhé."], prefs.aiMe, prefs.aiTo);
      toast(`Kết nối ổn · “${out}”`, "check");
    } catch (e) {
      fail(e);
    } finally {
      setTesting(false);
    }
  };
  const langSelect = (value: string, label: string, on: (v: string) => void) => (
    <select className="settings-select" aria-label={label} value={value} onChange={(e) => on(e.target.value)}>
      {LANGS.map(([name, l]) => <option key={name} value={name}>{l}</option>)}
    </select>
  );

  return (
    <section className="settings-card">
      <h3>AI · dịch & gợi ý trả lời</h3>
      <Row title="Định dạng API" help="OpenAI-compatible cho OpenRouter, OpenAI, Ollama… Anthropic cho api.anthropic.com hoặc proxy cùng chuẩn." icon="sparkles">
        <div className="mini-tabs" role="tablist" aria-label="Định dạng API">
          {(["openai", "anthropic"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={cfg.format === f} className={cfg.format === f ? "active" : ""} onClick={() => save({ format: f, endpoint: "" })}>
              {f === "openai" ? "OpenAI · OpenRouter" : "Anthropic"}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Endpoint" help="Base URL. Để trống dùng mặc định." icon="link">
        <input
          className="settings-select ai-input"
          aria-label="Địa chỉ API"
          placeholder={ENDPOINT_HINT[cfg.format]}
          defaultValue={cfg.endpoint === ENDPOINT_HINT[cfg.format] ? "" : cfg.endpoint}
          key={`ep-${cfg.format}`}
          onBlur={(e) => save({ endpoint: e.target.value })}
        />
      </Row>
      <Row title="API key" help="Lưu trên máy này. Chỉ gửi tới địa chỉ API bạn cấu hình." icon="key-round">
        <input
          className="settings-select ai-input"
          type="password"
          aria-label="API key"
          autoComplete="off"
          placeholder={cfg.hasKey ? "•••••••• đã lưu — gõ để thay" : cfg.format === "anthropic" ? "sk-ant-…" : "sk-or-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => {
            if (key.trim()) save({ key: key.trim() });
            setKey("");
          }}
        />
      </Row>
      <Row title="Model" help={cfg.format === "anthropic" ? "Ví dụ claude-opus-5-5, claude-haiku-5-5 (nhanh, rẻ cho dịch)." : "Slug của OpenRouter, ví dụ anthropic/…, openai/…, google/…"} icon="layers">
        <input
          className="settings-select ai-input"
          list={cfg.format === "anthropic" ? "ai-models" : undefined}
          aria-label="Model AI"
          placeholder={cfg.format === "anthropic" ? "claude-opus-5-5" : "provider/model"}
          defaultValue={cfg.model}
          key={`m-${cfg.format}`}
          onBlur={(e) => e.target.value.trim() !== cfg.model && save({ model: e.target.value })}
        />
        <datalist id="ai-models">
          <option value="claude-opus-5-5" />
          <option value="claude-sonnet-5-5" />
          <option value="claude-haiku-5-5" />
        </datalist>
      </Row>
      <Row title="Ngôn ngữ của tôi" help="Tin nhắn được dịch sang ngôn ngữ này để đọc." icon="languages">
        {langSelect(prefs.aiMe, "Ngôn ngữ của tôi", (v) => setPrefs({ aiMe: v }))}
      </Row>
      <Row title="Ngôn ngữ viết mặc định" help="Nháp và gợi ý trả lời viết bằng ngôn ngữ này. Đổi riêng từng hội thoại ở nút ngôn ngữ cạnh ô soạn tin." icon="send">
        {langSelect(prefs.aiTo, "Ngôn ngữ viết mặc định", (v) => setPrefs({ aiTo: v }))}
      </Row>
      <Row title="Hướng dẫn dịch" help="Thuật ngữ giữ nguyên, giọng văn… áp dụng cho mọi bản dịch." icon="file-text">
        <textarea
          className="settings-select ai-input ai-guide"
          aria-label="Hướng dẫn dịch"
          rows={2}
          placeholder="VD: giữ nguyên PR, deploy, staging, rollback; xưng anh/em"
          defaultValue={cfg.guide}
          onBlur={(e) => e.target.value !== cfg.guide && save({ guide: e.target.value })}
        />
      </Row>
      <div className="settings-add">
        <button type="button" className="tool-btn" disabled={testing || !cfg.model} onClick={() => void test()}>
          {testing ? <span className="veil-spinner" /> : <Icon name="sparkles" />} Kiểm tra kết nối
        </button>
      </div>
    </section>
  );
}

function preview(p: NotifyPrefs) {
  if (!p.enabled) return "Thông báo đang tắt";
  const d = new Date();
  const now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const inQuiet = p.from <= p.to ? now >= p.from && now < p.to : now >= p.from || now < p.to;
  if (p.quiet && inQuiet) return `Đang im lặng · ${p.from}–${p.to}`;
  return `${p.mentions ? "Chỉ khi được nhắc tên · " : ""}${p.preview ? "Minh Trần: Anh review giúp PR này nhé?" : "Bạn có tin nhắn mới"}${p.quiet ? ` · Im lặng ${p.from}–${p.to}` : ""}`;
}

const CACHE_MB: [number, string][] = [[1024, "1 GB"], [2048, "2 GB"], [5120, "5 GB"], [10240, "10 GB"], [0, "Không giới hạn"]];
const KEEP_DAYS: [number, string][] = [[3, "3 ngày"], [7, "1 tuần"], [30, "1 tháng"], [0, "Mãi mãi"]];

/** Like Telegram's "Storage usage": cache limit, how long media stays, where saves go. */
function StorageCard() {
  const [v, setV] = useState<StorageView | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => void api.storage().then(setV).catch(fail);
  useEffect(load, []);
  const set = (p: Parameters<typeof api.storageSet>[0]) => void api.storageSet(p).then(load).catch(fail);
  const clean = async (all: boolean) => {
    setBusy(true);
    try {
      const freed = await api.storageClean(all);
      toast(freed ? `Đã dọn ${fileSize(freed)}` : "Không có gì cần dọn", "check");
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card">
      <h3>Bộ nhớ & tải về</h3>
      {!isMobile && <Row title="Thư mục tải về" help={v?.downloadDir ?? "…"} icon="folder-open">
        <button className="tool-btn" onClick={() => void pickFolder().then((d) => d && set({ downloadDir: d }))}>Chọn…</button>
        {v && <button className="tool-btn" onClick={() => void openPath(v.downloadDir).catch(fail)}>Mở</button>}
      </Row>}
      <Row title="Giới hạn bộ nhớ đệm" help="Ảnh, video, tệp đã xem. Vượt giới hạn thì xoá cái lâu không dùng nhất; cần lại sẽ tải lại." icon="download">
        <select className="settings-select" aria-label="Giới hạn bộ nhớ đệm" value={v?.cacheMb ?? 2048} onChange={(e) => set({ cacheMb: +e.target.value })}>
          {CACHE_MB.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
        </select>
      </Row>
      <Row title="Giữ media" help="Xoá khỏi bộ nhớ đệm khi lâu hơn chừng này chưa mở lại." icon="clock">
        <select className="settings-select" aria-label="Giữ media" value={v?.keepDays ?? 30} onChange={(e) => set({ keepDays: +e.target.value })}>
          {KEEP_DAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
        </select>
      </Row>
      <Row title="Đang dùng" help={v ? `Telegram ${fileSize(v.tgBytes) || "0 B"} · Google Chat & tệp chờ gửi ${fileSize(v.localBytes) || "0 B"}` : "Đang tính…"} icon="trash-2">
        <button className="tool-btn" disabled={busy} onClick={() => void clean(false)}>Dọn theo giới hạn</button>
        <button className="tool-btn danger" disabled={busy} onClick={() => confirmDialog("Xoá hết bộ nhớ đệm?", "Ảnh, video, tệp đã tải sẽ bị xoá khỏi máy; mở lại sẽ tải lại. Tin nhắn không bị ảnh hưởng.", "Xoá", () => void clean(true))}>Xoá hết bộ nhớ đệm</button>
      </Row>
    </section>
  );
}
