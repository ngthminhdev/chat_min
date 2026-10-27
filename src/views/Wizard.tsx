import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, openUrl, pickFile } from "../lib/bridge";
import { PLATFORMS } from "../lib/platforms";
import type { Platform } from "../lib/types";
import { key, openChat, sortedChats, toast, useApp } from "../store";
import { ColorPicker } from "../components/Overlays";
import { Glyph, Icon } from "../ui/Icon";
import { isMobile } from "../lib/mobile";
import { showMobileList, useMobileBack } from "../mobile";

const STEPS = ["Nền tảng", "Xác thực", "Đồng bộ", "Tên & màu"];
const SYNC = ["Xác thực tài khoản", "Tải danh sách hội thoại", "Đồng bộ tin gần đây"];

/** Opens the add-account wizard, or the re-login flow for an existing account. */
export function startWizard(accountId?: string) {
  useApp.setState((s) => ({ route: "wizard", wizardFor: accountId ?? null, sync: accountId ? { ...s.sync, [accountId]: undefined! } : s.sync }));
}

export function Wizard() {
  const existing = useApp((s) => s.accounts.find((a) => a.id === s.wizardFor));
  const [step, setStep] = useState(existing ? 2 : 1);
  const [platform, setPlatform] = useState<Platform>(existing?.platform ?? "telegram");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const returnTo = useRef(useApp.getState().accounts.length ? "shell" : "welcome");

  const leave = (toastText?: string) => {
    useApp.setState({ route: useApp.getState().accounts.length ? "shell" : returnTo.current === "welcome" ? "welcome" : "shell", wizardFor: null });
    if (toastText) toast(toastText);
    if (isMobile && useApp.getState().accounts.length) showMobileList();
  };
  const cancel = () => {
    void api.loginCancel(accountId ?? undefined).catch(() => {});
    leave();
  };
  const back = () => {
    if (step === 2 && !existing) {
      void api.loginCancel(accountId ?? undefined).catch(() => {});
      setAccountId(null); setError(""); setStep(1);
    } else cancel();
  };
  useMobileBack(back);

  return (
    <>
      <header className="r2-header wizard-header">
        {isMobile && <button className="tool-btn icon-only" aria-label="Quay lại" type="button" onClick={back}><Icon name="chevron-left" /></button>}
        <div className="od-field">
          <h1>{existing ? "Đăng nhập lại" : "Thêm tài khoản"}</h1>
          <p>{existing ? `${existing.name} · ${existing.handle}` : "Kết nối một tài khoản vào ChatMin"}</p>
        </div>
        <div className="r2-actions">
          <button type="button" className="tool-btn" onClick={cancel}>Huỷ</button>
        </div>
      </header>
      <div className="wizard-wrap">
        <nav className="wizard-steps" aria-label="Các bước">
          {STEPS.map((l, i) => (
            <span key={l} className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined}>
              <b>{step > i + 1 ? <Icon name="check" /> : i + 1}</b>
              {l}
            </span>
          ))}
        </nav>
        <div className="create-layout">
          <div className="create-col">
            <section className="create-card">
              <div className="card-step">
                <span className="step-num">{step}</span>
                <h2>{STEPS[step - 1]}</h2>
              </div>
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div className="wizard-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                >
                  {step === 1 && (
                    <PlatformStep
                      platform={platform}
                      setPlatform={setPlatform}
                      next={() => {
                        setError("");
                        // Messenger retains the provider website; Zalo has native QR authentication.
                        if (platform === "messenger") {
                          api.webAdd(platform)
                            .then((a) => {
                              leave(`Đã thêm ${a.name} — đăng nhập ngay trong khung chat`);
                              void openChat(key(a.id, "web"));
                            })
                            .catch((e) => setError(String(e)));
                          return;
                        }
                        setStep(2);
                      }}
                    />
                  )}
                  {step === 2 && (
                    <AuthStep
                      platform={platform}
                      existing={existing?.id}
                      setError={setError}
                      back={existing ? undefined : () => (setError(""), void api.loginCancel(accountId ?? undefined), setAccountId(null), setStep(1))}
                      onAccount={setAccountId}
                      done={(id) => {
                        setAccountId(id);
                        setError("");
                        setStep(3);
                      }}
                    />
                  )}
                  {step === 3 && accountId && <SyncStep accountId={accountId} next={() => (existing ? leave("Đã kết nối lại tài khoản") : setStep(4))} />}
                  {step === 4 && accountId && (
                    <NameStep
                      accountId={accountId}
                      finish={() => {
                        leave("Đã thêm tài khoản");
                        const s = useApp.getState();
                        const first = sortedChats(s.chats, accountId)[0];
                        if (first) void openChat(key(first.accountId, first.id));
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </section>
          </div>
          <aside className="create-col wizard-summary">
            <section className="create-card">
              <div className="card-step"><h3>Tài khoản của bạn</h3></div>
              <div className="conn-summary">
                <div className="conn-summary-row"><span>Nền tảng</span><strong>{PLATFORMS[platform].name}</strong></div>
                <div className="conn-summary-row"><span>Trạng thái</span><strong>{step > 2 ? "Đã xác thực" : "Chưa xác thực"}</strong></div>
                <div className="conn-summary-row"><span>Phiên</span><strong>{existing ? "Đăng nhập lại" : "Tài khoản mới"}</strong></div>
              </div>
            </section>
            <p className="wizard-sim-note">
              {platform === "telegram"
                ? "ChatMin đăng nhập như một thiết bị Telegram mới (TDLib). Phiên lưu trên máy này; xoá tài khoản sẽ đăng xuất thiết bị."
                : platform === "gchat"
                  ? "ChatMin dùng Google Chat API bằng quyền của bạn (OAuth). Cần tài khoản Google Workspace; tin gửi từ ChatMin hiển thị như tin của bạn."
                  : platform === "zalo"
                    ? "Quét QR bằng Zalo trên điện thoại. Phiên lưu riêng trên máy; tin nhắn hiển thị trong ChatMin. Kết nối dùng giao thức không chính thức."
                  : `Đăng nhập ${PLATFORMS[platform].name} trong cửa sổ ứng dụng. Mỗi tài khoản dùng một phiên riêng trên máy này.`}
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}

function PlatformStep({ platform, setPlatform, next }: { platform: Platform; setPlatform: (p: Platform) => void; next: () => void }) {
  const cards: [string, string, boolean][] = [["telegram", "Telegram", true], ["gchat", "Google Chat", true], ["messenger", "Messenger", true], ["zalo", "Zalo", true]];
  return (
    <form className="wizard-form" onSubmit={(e) => (e.preventDefault(), next())}>
      <div className="engine-cards">
        {cards.map(([p, label, on]) => (
          <button
            key={p}
            type="button"
            className={`engine-card${platform === p ? " active" : ""}`}
            aria-pressed={platform === p}
            disabled={!on}
            onClick={() => setPlatform(p as Platform)}
            onDoubleClick={() => on && (setPlatform(p as Platform), next())}
          >
            <span className="provider-logo">{on ? <Glyph platform={p as Platform} /> : <Icon name="messages-square" />}</span>
            <strong>{label}</strong>
            <span className="provider-description">{p === "messenger" ? "Đăng nhập trong ứng dụng" : p === "zalo" ? "Quét QR · Hội thoại trong ChatMin" : p === "telegram" ? "Số điện thoại hoặc mã QR" : "Tài khoản Google Workspace"}</span>
            <span className="provider-selection" aria-hidden="true">{platform === p && <Icon name="check" />}</span>
          </button>
        ))}
      </div>
      <p className="r2-muted">Mỗi tài khoản có tên, màu và phiên đăng nhập riêng.</p>
      <div className="wizard-actions">
        <button type="submit" className="tool-btn primary">Tiếp tục</button>
      </div>
    </form>
  );
}

interface AuthProps {
  platform: Platform;
  existing?: string;
  setError: (e: string) => void;
  back?: () => void;
  onAccount: (id: string) => void;
  done: (accountId: string) => void;
}

function AuthStep(p: AuthProps) {
  const configured = useApp((s) => (p.platform === "telegram" ? s.tgConfigured : s.gchatConfigured));
  if (p.platform === "zalo") return <ZaloAuth {...p} />;
  if (!configured) return <ConfigForm platform={p.platform} back={p.back} setError={p.setError} />;
  return p.platform === "telegram" ? <TelegramAuth {...p} /> : <GoogleAuth {...p} />;
}

function Actions({ back, children }: { back?: () => void; children?: React.ReactNode }) {
  return (
    <div className="wizard-actions">
      {back && <button type="button" className="tool-btn" onClick={back}>Quay lại</button>}
      {children}
    </div>
  );
}

function Field(props: { id: string; label: string; hint?: React.ReactNode; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { id, label, hint, error, ...input } = props;
  return (
    <label className="field wide" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} aria-invalid={!!error} {...input} />
      {hint && <span className="field-hint">{hint}</span>}
      <span className="field-error" role="alert">{error}</span>
    </label>
  );
}

/** One-time developer credentials, stored in ~/Library/Application Support/com.chatmin.app/config.json. */
function ConfigForm({ platform, back, setError }: { platform: Platform; back?: () => void; setError: (e: string) => void }) {
  const [id, setId] = useState("");
  const [hash, setHash] = useState("");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (platform === "telegram") await api.configSet({ tgApiId: id, tgApiHash: hash });
      else await api.configSet({ gchatJson: json });
      useApp.setState(platform === "telegram" ? { tgConfigured: true } : { gchatConfigured: true });
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };
  return (
    <form className="wizard-form" onSubmit={(e) => (e.preventDefault(), void save())}>
      {platform === "telegram" ? (
        <>
          <p>
            ChatMin cần <b>api_id</b> và <b>api_hash</b> của bạn (làm một lần).{" "}
            <a className="msg-link" href="https://my.telegram.org/apps" onClick={(e) => (e.preventDefault(), void openUrl("https://my.telegram.org/apps"))}>
              Lấy ở my.telegram.org
            </a>
          </p>
          <Field id="tg-api-id" label="api_id *" value={id} inputMode="numeric" onChange={(e) => setId(e.target.value)} />
          <Field id="tg-api-hash" label="api_hash *" value={hash} autoComplete="off" onChange={(e) => setHash(e.target.value)} />
        </>
      ) : (
        <>
          <p>
            ChatMin cần OAuth client loại <b>Desktop app</b> của Cloud project có bật Chat API (làm một lần). Dán JSON tải về từ Cloud Console,
            hoặc chọn file.
          </p>
          <label className="field wide" htmlFor="gc-json">
            <span className="field-label">OAuth client JSON *</span>
            <textarea id="gc-json" className="json-input" rows={5} value={json} placeholder='{"installed":{"client_id":"…","client_secret":"…"}}' onChange={(e) => setJson(e.target.value)} />
            <span className="field-hint">JSON phải có client_secret. Console mới không kèm secret khi tải lại — tạo secret mới nếu thiếu.</span>
          </label>
          <div>
            <button type="button" className="tool-btn" onClick={async () => { const f = await pickFile([{ name: "JSON", extensions: ["json"] }]); if (f) setJson(f); }}>
              <Icon name="folder-open" />
              Chọn file…
            </button>
          </div>
        </>
      )}
      <Actions back={back}>
        <button type="submit" className="tool-btn primary" disabled={busy || (platform === "telegram" ? !id || !hash : !json.trim())}>
          Lưu cấu hình
        </button>
      </Actions>
    </form>
  );
}

function TelegramAuth({ existing, setError, back, onAccount, done }: AuthProps) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const auth = useApp((s) => (accountId ? s.auth[accountId] : undefined));
  const [mode, setMode] = useState<"phone" | "qr">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    api
      .tgLoginStart(existing)
      .then((id) => {
        setAccountId(id);
        onAccount(id);
        if (existing) useApp.setState((s) => ({ auth: { ...s.auth, [id]: { step: "phone", info: "", error: "" } } }));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!auth) return;
    if (auth.step === "ready" && accountId) done(accountId);
    if (auth.step === "error") setError(auth.error);
    if (auth.step === "code") setResendAt(Date.now() + 30_000);
    setBusy(false);
  }, [auth]);

  useEffect(() => {
    if (!resendAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFieldErr("");
    setError("");
    try {
      await fn();
    } catch (e) {
      setFieldErr(humanTgError(String(e)));
      setBusy(false);
    }
  };

  if (!auth || !accountId) {
    return (
      <div className="wizard-form">
        <p className="r2-muted"><span className="veil-spinner" /> Đang khởi động Telegram…</p>
        <Actions back={back} />
      </div>
    );
  }

  const step = auth.step;
  const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  if (step === "code") {
    const [num, via] = auth.info.split("|");
    return (
      <form className="wizard-form" onSubmit={(e) => (e.preventDefault(), void run(() => api.tgCode(accountId, code.trim())))}>
        <p>
          Mã xác thực đã gửi tới <strong>{via === "app" ? "app Telegram trên thiết bị khác" : `+${num}`}</strong>
        </p>
        <Field id="wizard-otp" label="Mã OTP *" value={code} autoFocus inputMode="numeric" autoComplete="one-time-code" error={fieldErr} onChange={(e) => setCode(e.target.value)} />
        <div>
          <button type="button" className="tool-btn" disabled={left > 0} onClick={() => void run(() => api.tgResend(accountId).then(() => setResendAt(Date.now() + 30_000)))}>
            {left > 0 ? `Gửi lại sau ${left}s` : "Gửi lại mã"}
          </button>
        </div>
        <Actions back={back}>
          <button type="submit" className="tool-btn primary" disabled={busy || !code.trim()}>Xác thực</button>
        </Actions>
      </form>
    );
  }
  if (step === "password") {
    return (
      <form className="wizard-form" onSubmit={(e) => (e.preventDefault(), void run(() => api.tgPassword(accountId, pw)))}>
        <Field
          id="wizard-password"
          label="Mật khẩu 2FA *"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pw}
          hint={auth.info ? `Gợi ý: ${auth.info}` : "Mật khẩu xác minh 2 bước của Telegram."}
          error={fieldErr}
          onChange={(e) => setPw(e.target.value)}
        />
        <Actions back={back}>
          <button type="submit" className="tool-btn primary" disabled={busy || !pw}>Đăng nhập</button>
        </Actions>
      </form>
    );
  }
  return (
    <form
      className="wizard-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "phone") {
          const v = phone.trim();
          if (!/^\+[1-9][\d\s-]{7,17}$/.test(v)) return setFieldErr("Nhập số có mã quốc gia, ví dụ +84 912 345 678.");
          void run(() => api.tgPhone(accountId, v.replace(/[\s-]/g, "")));
        }
      }}
    >
      <div className="mini-tabs" role="tablist" aria-label="Cách đăng nhập">
        <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>
          Số điện thoại
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "qr"}
          className={mode === "qr" ? "active" : ""}
          onClick={() => {
            setMode("qr");
            if (step !== "qr") void run(() => api.tgQr(accountId));
          }}
        >
          QR
        </button>
      </div>
      {mode === "qr" ? (
        <>
          <div className="qr-box">
            {step === "qr" && auth.info ? <img src={auth.info} alt="Mã QR đăng nhập Telegram" /> : <span className="veil-spinner" />}
          </div>
          <ol className="r2-muted">
            <li>Mở Telegram trên điện thoại</li>
            <li>Settings → Devices → Link Desktop Device</li>
            <li>Quét mã để xác nhận phiên đăng nhập</li>
          </ol>
          {fieldErr && <span className="field-error">{fieldErr}</span>}
          <Actions back={back} />
        </>
      ) : (
        <>
          <Field
            id="wizard-phone"
            label="Số điện thoại *"
            type="tel"
            autoFocus
            value={phone}
            placeholder="+84 912 345 678"
            hint="Kèm mã quốc gia. Telegram gửi mã vào app trên thiết bị khác, hoặc SMS."
            error={fieldErr}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Actions back={back}>
            <button type="submit" className="tool-btn primary" disabled={busy || !phone.trim()}>
              {busy ? "Đang gửi…" : "Gửi mã OTP"}
            </button>
          </Actions>
        </>
      )}
    </form>
  );
}

function humanTgError(e: string): string {
  if (e.includes("PHONE_NUMBER_INVALID")) return "Số điện thoại không hợp lệ.";
  if (e.includes("PHONE_CODE_INVALID")) return "Mã OTP không đúng.";
  if (e.includes("PHONE_CODE_EXPIRED")) return "Mã OTP đã hết hạn — gửi lại mã.";
  if (e.includes("PASSWORD_HASH_INVALID")) return "Mật khẩu 2FA không đúng.";
  if (e.includes("FLOOD_WAIT") || e.includes("Too Many Requests")) return "Thử quá nhiều lần — Telegram yêu cầu chờ một lúc.";
  return e;
}

function GoogleAuth({ setError, back, done }: AuthProps) {
  const [waiting, setWaiting] = useState(false);
  const start = () => {
    setWaiting(true);
    setError("");
    api
      .gchatLogin()
      .then((a) => done(a.id))
      .catch((e) => {
        setWaiting(false);
        if (String(e) !== "cancelled") setError(String(e));
      });
  };
  if (waiting) {
    return (
      <div className="wizard-form">
        <div className="oauth-wait">
          <Icon name="external-link" />
          <h3>{isMobile ? "Chọn tài khoản và cấp quyền Google" : "Đang đợi bạn đăng nhập trong browser"}</h3>
          <p>{isMobile ? "Hoàn tất chọn tài khoản Workspace và cấp quyền trong cửa sổ Google, rồi quay lại ChatMin." : "Trình duyệt đã mở trang đồng ý của Google. Chọn tài khoản Workspace và bấm Cho phép, rồi quay lại đây."}</p>
        </div>
        <Actions>
          <button type="button" className="tool-btn" onClick={() => void api.loginCancel()}>Huỷ đăng nhập</button>
        </Actions>
      </div>
    );
  }
  return (
    <div className="wizard-form">
      <p>Cho phép ChatMin đọc và gửi tin Google Chat bằng tài khoản của bạn.</p>
      <div className="connection-note">Quyền xin: xem space, đọc/gửi tin, xem thành viên, trạng thái đã đọc. Chỉ tài khoản Google Workspace dùng được Chat API.</div>
      <Actions back={back}>
        <button type="button" className="tool-btn primary" onClick={start}>Đăng nhập bằng Google</button>
      </Actions>
    </div>
  );
}

function SyncStep({ accountId, next }: { accountId: string; next: () => void }) {
  const sync = useApp((s) => s.sync[accountId]);
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 20_000);
    return () => clearTimeout(t);
  }, []);
  const checks = sync?.checks ?? ["ok", "run", "idle"];
  const ok = checks.every((c) => c === "ok");
  const err = checks.includes("err");
  return (
    <div className="wizard-form">
      <div className="check-list">
        {SYNC.map((l, i) => (
          <div key={l} className="check-item">
            <span className="step-num">{i + 1}</span>
            <span className="check-label">{l}</span>
            <span className={`check-badge ${checks[i]}`}>{{ idle: "Chờ", run: "Đang chạy", ok: "OK", err: "Lỗi" }[checks[i]]}</span>
          </div>
        ))}
      </div>
      <pre className="check-output" aria-live="polite">
        {sync?.log.length ? (
          sync.log.map((l, i) => <span key={i} className={`check-line${err && i === sync.log.length - 1 ? " err" : ""}`}>{l}{"\n"}</span>)
        ) : (
          <span className="check-line dim">Đang đồng bộ…</span>
        )}
      </pre>
      <Actions>
        {(ok || err || late) && (
          <button type="button" className="tool-btn primary" onClick={next}>
            {ok ? "Tiếp tục" : "Tiếp tục, đồng bộ nền"}
          </button>
        )}
      </Actions>
    </div>
  );
}

function NameStep({ accountId, finish }: { accountId: string; finish: () => void }) {
  const account = useApp((s) => s.accounts.find((a) => a.id === accountId));
  const [name, setName] = useState(account?.name ?? "");
  const [color, setColor] = useState(account?.color ?? "blue");
  const [err, setErr] = useState("");
  return (
    <form
      className="wizard-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setErr("Nhập tên để nhận biết tài khoản này.");
        api.accountUpdate(accountId, { name: name.trim(), color }).then(finish).catch((x) => setErr(String(x)));
      }}
    >
      <Field id="wizard-name" label="Tên tài khoản *" value={name} autoFocus hint="Tên hiển thị trong danh sách hội thoại, tab và thanh trạng thái." error={err} onChange={(e) => setName(e.target.value)} />
      <span className="field-label">Màu nhận diện</span>
      <ColorPicker value={color} onPick={setColor} />
      <p className="r2-muted">Màu luôn đi cùng tên tài khoản.</p>
      <Actions>
        <button type="submit" className="tool-btn primary">Thêm tài khoản</button>
      </Actions>
    </form>
  );
}

function ZaloAuth({ existing, setError, back, onAccount, done }: AuthProps) {
  const [accountId, setAccountId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const auth = useApp(s => accountId ? s.auth[accountId] : undefined);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (auth?.step === "ready" && accountId) done(accountId);
    if (auth?.step === "error") setError(auth.error);
  }, [auth, accountId]);
  const start = async () => {
    setStarting(true); setError("");
    try {
      const id = await api.zaloLoginStart(accountId ?? existing);
      if (!live.current) { void api.loginCancel(id); return; }
      setAccountId(id); onAccount(id);
    } catch (e) { if (live.current) setError(String(e)); }
    finally { if (live.current) setStarting(false); }
  };
  return <div className="wizard-form">
    <p>Mở Zalo trên điện thoại, quét QR và xác nhận đăng nhập.</p>
    {accountId && auth?.step !== "error" && <>
      <div className="qr-box">{auth?.info ? <img src={auth.info} alt="Mã QR đăng nhập Zalo" /> : <span className="veil-spinner" />}</div>
      <p className="r2-muted" role="status">{auth?.info ? "Quét mã trong Zalo trên điện thoại." : "Đang chờ Zalo. Nếu đã quét, xác nhận trên điện thoại."}</p>
    </>}
    <div className="connection-note">Đóng phiên Zalo Web khác để tránh ngắt kết nối. Tin cũ có thể không được Zalo trả đầy đủ; ChatMin giữ các tin đã đồng bộ trên máy.</div>
    <Actions back={back}>
      <button type="button" className="tool-btn primary" disabled={starting} onClick={() => void start()}>{starting ? "Đang tạo mã…" : accountId ? "Tạo mã QR mới" : "Đăng nhập Zalo bằng QR"}</button>
    </Actions>
  </div>;
}
