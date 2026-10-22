import { useEffect, useState } from "react";
import { api } from "../lib/bridge";
import type { AiView } from "../lib/types";
import { HEALTH_LABELS, PLATFORMS } from "../lib/platforms";
import { LANGS } from "../ai";
import { THEMES } from "../lib/themes";
import { anchor, DEFAULT_NOTIFY, fail, toast, useApp, type NotifyPrefs } from "../store";
import { removeAccount, renameAccount } from "../App";
import { startWizard } from "./Wizard";
import { Glyph, Icon, type IconName } from "../ui/Icon";

const SHORTCUTS: [string, string][] = [
  ["Thêm account", "⌘N"], ["Chat & lệnh", "⌘K"], ["Tìm tin mọi account", "⌘⇧F"], ["Tìm trong chat", "⌘F"],
  ["Tới tab 1…8 / tab cuối", "⌘1…8 / ⌘9"], ["Tab trước / sau", "⌘[ / ⌘]"], ["Chat chưa đọc", "⌘↑ / ⌘↓"], ["Đổi tên account", "⌘E"],
  ["Xoá account", "⌘⌫"], ["Sidebar / Inspector", "⌘B / ⌘I"], ["Sửa tin vừa gửi", "↑"], ["Huỷ trả lời", "Esc"],
  ["Settings", "⌘,"], ["Đóng tab", "⌘W"], ["Gợi ý trả lời", "⌘J"], ["Dịch nháp", "⌘⇧L"],
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
  const setPrefs = (p: Partial<typeof prefs>) => useApp.setState((s) => ({ prefs: { ...s.prefs, ...p } }));
  const setNotif = (id: string, p: Partial<NotifyPrefs>) =>
    useApp.setState((s) => ({ notif: { ...s.notif, [id]: { ...DEFAULT_NOTIFY, ...s.notif[id], ...p } } }));

  return (
    <>
      <header className="r2-header">
        <div className="od-field">
          <h1>Settings</h1>
          <p>Giao diện, account và thông báo</p>
        </div>
      </header>
      <div className="settings-shell">
        <section className="settings-card">
          <h3>Appearance</h3>
          <Row title="Theme" help="Áp dụng cho toàn bộ cửa sổ." icon="palette">
            <select className="settings-select" aria-label="Theme" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value })}>
              <option value="">Bearded Arc · dark</option>
              {THEMES.filter((t) => t.id !== "dark" && t.id !== "default-dark").map((t) => (
                <option key={t.id} value={t.id}>{t.label}{t.base === "light" ? " · light" : ""}</option>
              ))}
            </select>
          </Row>
          <Row title="Interface font size" help="Bước 0.5px. Bấm giá trị để về 13px.">
            <div className="font-stepper">
              <button type="button" className="tool-btn" aria-label="Giảm cỡ chữ" disabled={prefs.size <= 11} onClick={() => setPrefs({ size: Math.max(11, prefs.size - 0.5) })}>−</button>
              <button type="button" className="tool-btn" aria-label="Đặt lại cỡ chữ" onClick={() => setPrefs({ size: 13 })}>{prefs.size}px</button>
              <button type="button" className="tool-btn" aria-label="Tăng cỡ chữ" disabled={prefs.size >= 18} onClick={() => setPrefs({ size: Math.min(18, prefs.size + 0.5) })}>+</button>
            </div>
          </Row>
          <Row title="Interface font family" help="Font giao diện và nội dung hội thoại.">
            <select className="settings-select" aria-label="Interface font family" value={prefs.uiFont} onChange={(e) => setPrefs({ uiFont: e.target.value })}>
              <option value="">Exo 2 · mặc định</option>
              <option value="system-ui">System UI</option>
            </select>
          </Row>
          <Row title="Editor font family" help="ID, giờ, status, log và phím tắt.">
            <select className="settings-select" aria-label="Editor font family" value={prefs.monoFont} onChange={(e) => setPrefs({ monoFont: e.target.value })}>
              <option value="">Google Sans Code · mặc định</option>
              <option value="ui-monospace">System monospace</option>
            </select>
          </Row>
          <Row title="Compact density" help="Thu gọn hàng hội thoại và khoảng cách.">
            <Toggle checked={prefs.compact} label="Compact density" onChange={(v) => setPrefs({ compact: v })} />
          </Row>
        </section>

        <AiCard />

        <section className="settings-card">
          <h3>Accounts</h3>
          {accounts.length ? (
            accounts.map((a) => {
              const h = health[a.id]?.health ?? "ok";
              const shown = h === "syncing" ? "ok" : h;
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
                            { icon: "refresh-cw", label: "Đăng nhập lại", run: () => startWizard(a.id) },
                            { icon: "trash-2", label: "Xoá account…", danger: true, run: () => removeAccount(a.id) },
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
            <p className="r2-muted">Chưa có account. Thêm account để bắt đầu.</p>
          )}
          <div className="settings-add">
            <button type="button" className="tool-btn primary" onClick={() => startWizard()}>Add account</button>
          </div>
        </section>

        <section className="settings-card">
          <h3>Notifications</h3>
          {accounts.map((a) => {
            const p = { ...DEFAULT_NOTIFY, ...notif[a.id] };
            return (
              <div key={a.id} className="notification-account">
                <h4>{a.name}</h4>
                <Row title="Thông báo" help="Bật thông báo macOS cho account này." icon="bell">
                  <Toggle checked={p.enabled} label={`Thông báo ${a.name}`} onChange={(v) => setNotif(a.id, { enabled: v })} />
                </Row>
                <Row title="Chỉ mention" help="Chỉ báo khi bạn được nhắc tên.">
                  <Toggle checked={p.mentions} label={`Chỉ mention ${a.name}`} onChange={(v) => setNotif(a.id, { mentions: v })} />
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
          {!accounts.length && <p>Thêm account để thiết lập thông báo.</p>}
        </section>

        <section className="settings-card">
          <h3>Shortcuts</h3>
          <div className="shortcut-grid">
            {SHORTCUTS.map(([l, k]) => (
              <div key={l} className="shortcut-row"><span>{l}</span><kbd className="kbd">{k}</kbd></div>
            ))}
          </div>
        </section>
        <p className="r2-muted">Giao diện và thông báo lưu trên máy này. Phiên đăng nhập ở ~/Library/Application Support/com.chatmin.app.</p>
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
          placeholder={ENDPOINT_HINT[cfg.format]}
          defaultValue={cfg.endpoint === ENDPOINT_HINT[cfg.format] ? "" : cfg.endpoint}
          key={`ep-${cfg.format}`}
          onBlur={(e) => save({ endpoint: e.target.value })}
        />
      </Row>
      <Row title="API key" help="Lưu trong config.json của app (chmod 600), không gửi đi đâu ngoài endpoint." icon="key-round">
        <input
          className="settings-select ai-input"
          type="password"
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
      <Row title="Ngôn ngữ viết mặc định" help="Nháp và gợi ý trả lời viết bằng ngôn ngữ này. Đổi riêng từng chat ở nút EN cạnh ô soạn tin." icon="send">
        {langSelect(prefs.aiTo, "Ngôn ngữ viết mặc định", (v) => setPrefs({ aiTo: v }))}
      </Row>
      <Row title="Hướng dẫn dịch" help="Thuật ngữ giữ nguyên, giọng văn… áp dụng cho mọi bản dịch." icon="file-text">
        <textarea
          className="settings-select ai-input ai-guide"
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
