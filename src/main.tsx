import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { api } from "./lib/bridge";
import { useApp } from "./store";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/chatmin.css";

const report = (what: string) => void api.logJs(what).catch(() => {});
window.addEventListener("error", (e) => report(`${e.message}\n${e.error?.stack ?? ""}`));
window.addEventListener("unhandledrejection", (e) => report(`unhandled: ${e.reason?.stack ?? e.reason}`));

/** A render error must not leave a blank window: say so, log it (Rust stderr), and offer
 *  a way back — closing the open conversation clears most bad states. */
class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    report(`render: ${err.stack ?? err.message}${info.componentStack ?? ""}`);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crash" role="alert">
        <strong>ChatMin gặp lỗi hiển thị</strong>
        <code>{this.state.err.message}</code>
        <button
          className="tool-btn primary"
          onClick={() => {
            useApp.setState({ active: null, route: "shell" });
            this.setState({ err: null });
          }}
        >
          Khôi phục
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
