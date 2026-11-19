"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ───────────── Types & config ───────────── */
type Msg = { id: string; role: "user" | "bot"; text: string; time: string };

const STORAGE_KEY = "infinitive-chat-v1";
const MAX_CHARS = 1000;

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const cleanOldAnswer = (text: string) =>
  text
    .replace(/\s*\(PDF page \d+\)|\s*\[PDF page \d+\]|\s*\[PDF pages? \d+[-–]\d+\]/gi, "")
    .replace(/^\s*(?:the )?training guide says:\s*/i, "")
    .replace(/^\s*training guide mein yeh likha hai:\s*/i, "")
    .replace(/^Mujhe Infinitive Cloud training guide mein is sawal ka jawab nahi mila.*$/gim, "Mujhe is sawal ka jawab nahi mila.")
    .replace(/^Training guide mein current prices.*$/gim, "Current pricing details available nahi hain.")
    .trim();

/* The Next.js route proxies to the local, PDF-grounded backend. */
async function getReply(history: Msg[]): Promise<{ reply: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history.slice(-12).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Chat service unavailable.");
  if (typeof data?.reply !== "string" || !data.reply.trim()) throw new Error("The assistant returned an empty response.");
  return { reply: data.reply };
}
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      out.push(
        <ul key={"ul" + k}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    if (/^\s*[-•]\s+/.test(line)) list.push(line.replace(/^\s*[-•]\s+/, ""));
    else {
      flush(i);
      if (line.trim()) out.push(<p key={i}>{inline(line)}</p>);
    }
  });
  flush(lines.length);
  return <>{out}</>;
}

/* ───────────── Icons ───────────── */
const Icon = {
  send: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  stop: (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>),
  copy: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
  check: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>),
  redo: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>),
  trash: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>),
  sun: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>),
  moon: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>),
  down: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>),
};

/* ───────────── Page ───────────── */
export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "ready" | "pdf-only" | "local" | "unavailable">("checking");
  const [typing, setTyping] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [loaded, setLoaded] = useState(false);
  const [showDown, setShowDown] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef(false);

  /* load / save */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.messages)) {
          setMessages(d.messages.map((message: Msg) =>
            message.role === "bot" ? { ...message, text: cleanOldAnswer(message.text) } : message
          ));
        }
        if (d.theme === "light" || d.theme === "dark") setTheme(d.theme);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkBackend = async () => {
      try {
        const response = await fetch("/api/chat", { cache: "no-store" });
        const health = await response.json();
        if (mounted) {
          setBackendStatus(
            !response.ok || health.status !== "ready"
              ? "unavailable"
              : health.mode === "pdf-only"
                ? "pdf-only"
                : health.mode === "ai"
                ? "ready"
                : "local"
          );
        }
      } catch {
        if (mounted) setBackendStatus("unavailable");
      }
    };
    void checkBackend();
    const interval = window.setInterval(checkBackend, 15000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-60), theme }));
    } catch {}
  }, [messages, theme, loaded]);

  /* auto scroll */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowDown(el.scrollHeight - el.scrollTop - el.clientHeight > 140);
  };

  /* autosize textarea */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  }, [input]);

  /* streaming effect */
  const stream = (full: string, cb: (t: string) => void) =>
    new Promise<void>((resolve) => {
      let i = 0;
      const t = setInterval(() => {
        if (stopRef.current || i >= full.length) {
          clearInterval(t);
          resolve();
          return;
        }
        i = Math.min(full.length, i + 3);
        cb(full.slice(0, i));
      }, 16);
    });

  const respond = useCallback(async (history: Msg[]) => {
    setBusy(true);
    stopRef.current = false;
    setTyping(true);
    let response: { reply: string };
    try {
      response = await getReply(history);
    } catch (error) {
      response = {
        reply: error instanceof Error && error.message.includes("backend is unreachable")
          ? "I can't connect to the chatbot backend right now. Please start the backend and try again."
          : "The assistant is temporarily unavailable. Please try again shortly.",
      };
    }
    setTyping(false);
    const id = uid();
    setMessages((m) => [...m, { id, role: "bot", text: "", time: now() }]);
    await stream(response.reply, (partial) =>
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: partial } : x)))
    );
    setBusy(false);
  }, []);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { id: uid(), role: "user" as const, text: content, time: now() }];
    setMessages(next);
    setInput("");
    await respond(next);
  };

  const stop = () => {
    stopRef.current = true;
  };

  const regenerate = async () => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "bot") return;
    const history = messages.slice(0, -1);
    setMessages(history);
    await respond(history);
  };

  const clearChat = () => {
    stopRef.current = true;
    setMessages([]);
    setTyping(false);
    setBusy(false);
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const lastId = messages[messages.length - 1]?.id;

  return (
    <main className="ic" data-theme={theme}>
      <style>{css}</style>
      <div className="orb o1" />
      <div className="orb o2" />
      <div className="orb o3" />
      <div className="grid" />

      <section className="card">
        {/* Header */}
        <header className="head">
          <div className="brand">
            <div className="logo">∞</div>
            <div>
              <h1>Infinitive Cloud Assistant</h1>
              <span className="status" data-state={backendStatus}>
                <i /> {backendStatus === "pdf-only" ? "Assistant ready" : backendStatus === "ready" || backendStatus === "local" ? "Assistant ready" : backendStatus === "checking" ? "Connecting to assistant…" : "Backend unavailable"}
              </span>
            </div>
          </div>
          <div className="tools">
            <button title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? Icon.sun : Icon.moon}
            </button>
            <button title="Clear chat" onClick={clearChat} disabled={!messages.length}>
              {Icon.trash}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="body" ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 && !typing ? (
            <div className="hero">
              <div className="hero-logo">∞</div>
              <h2>Hello! Welcome to Infinitive Cloud.</h2>
              <p>
                Tell me what you want to <b>host</b>, <b>build</b>, <b>migrate</b>, or <b>manage</b>,
                and I&apos;ll guide you to a suitable solution.
              </p>
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <div key={m.id} className={`row ${m.role}`}>
                  {m.role === "bot" && <div className="mini">∞</div>}
                  <div className="col">
                    <div className="bubble">
                      {m.role === "bot" ? <Markdown text={m.text || "…"} /> : <p>{m.text}</p>}
                    </div>
                    <div className="meta">
                      <small>{m.time}</small>
                      {m.role === "bot" && m.text && (
                        <>
                          <button title="Copy" onClick={() => copy(m)}>
                            {copied === m.id ? Icon.check : Icon.copy}
                          </button>
                          {m.id === lastId && !busy && (
                            <button title="Regenerate" onClick={regenerate}>{Icon.redo}</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="row bot">
                  <div className="mini">∞</div>
                  <div className="bubble dots"><span /><span /><span /></div>
                </div>
              )}
            </>
          )}
          <div ref={endRef} />
        </div>

        {showDown && (
          <button className="down" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}>
            {Icon.down}
          </button>
        )}

        {/* Composer */}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="field">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              placeholder="Ask about hosting, VPS, migration..."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <span className="count">{input.length}/{MAX_CHARS}</span>
          </div>
          {busy ? (
            <button type="button" className="send stopbtn" onClick={stop}>
              {Icon.stop} Stop
            </button>
          ) : (
            <button type="submit" className="send" disabled={!input.trim()}>
              Send {Icon.send}
            </button>
          )}
        </form>
        <p className="foot">Infinitive Cloud Assistant can make mistakes. Verify important details.</p>
      </section>
    </main>
  );
}

/* ───────────── Styles ───────────── */
const css = `
*{box-sizing:border-box}
body{margin:0}
.ic{
  --bg:#060914;--card:rgba(255,255,255,.05);--card-b:rgba(255,255,255,.1);--txt:#e9edfb;--sub:#8f9bc2;
  --bot:rgba(255,255,255,.07);--bot-b:rgba(255,255,255,.09);--field:rgba(255,255,255,.07);--field-b:rgba(255,255,255,.13);
  --code:rgba(99,102,241,.22);--shadow:0 40px 100px rgba(0,0,0,.6);--grid:rgba(255,255,255,.035);
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden;
  background:var(--bg);color:var(--txt);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;transition:background .4s,color .4s;
}
.ic[data-theme=light]{
  --bg:#eef1fb;--card:rgba(255,255,255,.72);--card-b:rgba(255,255,255,.9);--txt:#171c33;--sub:#667096;
  --bot:#fff;--bot-b:rgba(20,30,80,.08);--field:#fff;--field-b:rgba(20,30,80,.14);--code:rgba(99,102,241,.13);
  --shadow:0 30px 80px rgba(60,70,140,.22);--grid:rgba(20,30,80,.045);
}
.orb{position:absolute;border-radius:50%;filter:blur(120px);pointer-events:none;animation:float 14s ease-in-out infinite}
.o1{width:480px;height:480px;background:#4f46e5;top:-160px;left:-120px;opacity:.5}
.o2{width:440px;height:440px;background:#06b6d4;bottom:-160px;right:-120px;opacity:.32;animation-delay:-5s}
.o3{width:320px;height:320px;background:#a855f7;top:40%;left:55%;opacity:.2;animation-delay:-9s}
.ic[data-theme=light] .orb{opacity:.28}
.grid{position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:44px 44px;mask-image:radial-gradient(circle at 50% 40%,#000 20%,transparent 75%);-webkit-mask-image:radial-gradient(circle at 50% 40%,#000 20%,transparent 75%)}

.card{position:relative;z-index:1;width:100%;max-width:900px;height:min(820px,94vh);display:flex;flex-direction:column;
  background:var(--card);backdrop-filter:blur(26px) saturate(140%);-webkit-backdrop-filter:blur(26px) saturate(140%);
  border:1px solid var(--card-b);border-radius:28px;box-shadow:var(--shadow);overflow:hidden;animation:pop .6s cubic-bezier(.2,.8,.2,1) both}

.head{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid var(--card-b)}
.brand{display:flex;align-items:center;gap:14px}
.brand h1{margin:0;font-size:17px;font-weight:700;letter-spacing:.2px}
.logo{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:26px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#6366f1,#06b6d4);box-shadow:0 8px 24px rgba(99,102,241,.55)}
.status{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--sub);margin-top:3px}
.status i{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:pulse 2s infinite}
.status[data-state=ready] i{background:#22c55e}
.status[data-state=unavailable] i{background:#ef4444;animation:none}
.tools{display:flex;gap:8px}
.tools button{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;cursor:pointer;color:var(--sub);
  background:var(--field);border:1px solid var(--field-b);transition:.2s}
.tools button:hover:not(:disabled){color:var(--txt);transform:translateY(-2px);border-color:#818cf8}
.tools button:disabled{opacity:.35;cursor:not-allowed}

.body{flex:1;overflow-y:auto;padding:26px 26px 10px;display:flex;flex-direction:column;gap:18px}
.body::-webkit-scrollbar{width:6px}
.body::-webkit-scrollbar-thumb{background:var(--field-b);border-radius:6px}

.hero{margin:auto;text-align:center;max-width:620px;animation:rise .6s both}
.hero-logo{width:72px;height:72px;margin:0 auto 18px;border-radius:24px;display:grid;place-items:center;font-size:42px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#6366f1,#06b6d4);box-shadow:0 16px 44px rgba(99,102,241,.55);animation:float 5s ease-in-out infinite}
.hero h2{margin:0 0 10px;font-size:28px;font-weight:750;letter-spacing:-.3px;
  background:linear-gradient(90deg,var(--txt),#818cf8 60%,#22d3ee);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero p{margin:0 0 26px;color:var(--sub);font-size:15.5px;line-height:1.65}
.hero p b{color:var(--txt);font-weight:600}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left}
.actions button{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:16px;cursor:pointer;color:var(--txt);
  background:var(--bot);border:1px solid var(--bot-b);transition:.25s;font-family:inherit}
.actions button:hover{transform:translateY(-3px);border-color:#818cf8;box-shadow:0 14px 34px rgba(99,102,241,.25)}
.ai{width:38px;height:38px;flex:none;border-radius:12px;display:grid;place-items:center;font-size:19px;background:rgba(99,102,241,.16)}
.actions strong{display:block;font-size:14px;margin-bottom:3px}
.actions em{display:block;font-style:normal;font-size:12px;color:var(--sub);line-height:1.4}

.row{display:flex;align-items:flex-end;gap:10px;animation:rise .35s both}
.row.user{justify-content:flex-end}
.mini{width:32px;height:32px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:18px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#6366f1,#06b6d4)}
.col{max-width:76%;display:flex;flex-direction:column}
.row.user .col{align-items:flex-end}
.bubble{padding:13px 17px;border-radius:20px;font-size:15px;line-height:1.6;word-break:break-word}
.bubble p{margin:0}
.bubble p+p,.bubble ul+p,.bubble p+ul{margin-top:9px}
.bubble ul{margin:0;padding-left:20px}
.bubble li{margin:4px 0}
.bubble code{padding:2px 7px;border-radius:7px;background:var(--code);font-family:ui-monospace,Menlo,monospace;font-size:13px}
.bot .bubble{background:var(--bot);border:1px solid var(--bot-b);border-bottom-left-radius:6px}
.user .bubble{color:#fff;border-bottom-right-radius:6px;background:linear-gradient(135deg,#6366f1,#4f46e5 55%,#0ea5e9);box-shadow:0 12px 30px rgba(79,70,229,.4)}
.meta{display:flex;align-items:center;gap:6px;margin:5px 6px 0;min-height:22px}
.meta small{font-size:11px;color:var(--sub)}
.meta button{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--sub);background:transparent;border:0;transition:.2s}
.meta button:hover{background:var(--field);color:var(--txt)}
.dots{display:flex;gap:5px;align-items:center;padding:17px 19px}
.dots span{width:7px;height:7px;border-radius:50%;background:var(--sub);animation:bounce 1.2s infinite}
.dots span:nth-child(2){animation-delay:.15s}
.dots span:nth-child(3){animation-delay:.3s}

.down{position:absolute;right:28px;bottom:132px;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:#fff;border:0;
  background:linear-gradient(135deg,#6366f1,#0ea5e9);box-shadow:0 10px 26px rgba(79,70,229,.5);animation:rise .25s both}

.composer{display:flex;align-items:flex-end;gap:12px;padding:14px 22px 6px}
.field{flex:1;position:relative}
.field textarea{width:100%;resize:none;display:block;padding:15px 18px 22px;border-radius:18px;font:inherit;font-size:15px;line-height:1.5;
  color:var(--txt);outline:none;background:var(--field);border:1px solid var(--field-b);transition:.2s;max-height:150px}
.field textarea::placeholder{color:var(--sub)}
.field textarea:focus{border-color:#818cf8;box-shadow:0 0 0 4px rgba(99,102,241,.2)}
.count{position:absolute;right:14px;bottom:6px;font-size:10.5px;color:var(--sub);pointer-events:none}
.send{height:52px;display:flex;align-items:center;gap:8px;padding:0 24px;border:0;border-radius:16px;cursor:pointer;font:inherit;font-size:15px;font-weight:650;color:#fff;
  background:linear-gradient(135deg,#6366f1,#0ea5e9);box-shadow:0 12px 28px rgba(79,70,229,.45);transition:.2s;white-space:nowrap}
.send:hover:not(:disabled){transform:translateY(-2px);filter:brightness(1.1)}
.send:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.stopbtn{background:linear-gradient(135deg,#ef4444,#f97316);box-shadow:0 12px 28px rgba(239,68,68,.4)}
.foot{margin:0;padding:6px 22px 16px;text-align:center;font-size:11.5px;color:var(--sub)}

@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-6px);opacity:1}}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)}}

@media(max-width:640px){
  .ic{padding:0}
  .card{height:100dvh;max-width:none;border-radius:0;border:0}
  .head{padding:14px 16px}
  .brand h1{font-size:15px}
  .body{padding:18px 14px 8px}
  .col{max-width:86%}
  .actions{grid-template-columns:1fr}
  .hero h2{font-size:23px}
  .composer{padding:12px 12px 4px}
  .send{padding:0 16px}
  .down{right:16px}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
