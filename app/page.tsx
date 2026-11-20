"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type Message = { id: string; role: "user" | "bot"; text: string; time: string };
type BackendStatus = "checking" | "ready" | "local" | "unavailable";
type Theme = "dark" | "light";

const STORAGE_KEY = "infinitive-chat-v1";
const MAX_CHARS = 1000;

const suggestions = [
  {
    eyebrow: "HOSTING & VPS",
    title: "Find the right cloud setup",
    prompt: "What hosting and VPS options are available for my project?",
    icon: "cloud",
  },
  {
    eyebrow: "MIGRATION",
    title: "Plan a smooth migration",
    prompt: "How can I plan a migration to Infinitive Cloud?",
    icon: "arrows",
  },
  {
    eyebrow: "SECURITY",
    title: "Protect your workloads",
    prompt: "What security and backup options can help protect my workload?",
    icon: "shield",
  },
] as const;

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

async function getReply(history: Message[]): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history.slice(-12).map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.text,
      })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Chat service unavailable.");
  }
  if (typeof data?.reply !== "string" || !data.reply.trim()) {
    throw new Error("The assistant returned an empty response.");
  }
  return data.reply;
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>;
  if (name === "moon") return <svg {...common}><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2" /></svg>;
  if (name === "stop") return <svg {...common} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === "chevron") return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
  if (name === "cloud") return <svg {...common}><path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18Z" /><path d="M9 14h.01M12 14h.01M15 14h.01" /></svg>;
  if (name === "arrows") return <svg {...common}><path d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></svg>;
  return <svg {...common}><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></svg>;
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const output: ReactNode[] = [];
  let list: string[] = [];

  const flush = (key: number) => {
    if (!list.length) return;
    output.push(<ul key={`list-${key}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>);
    list = [];
  };

  lines.forEach((line, index) => {
    if (/^\s*[-•]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-•]\s+/, ""));
      return;
    }
    flush(index);
    if (line.trim()) output.push(<p key={`line-${index}`}>{inline(line)}</p>);
  });
  flush(lines.length);
  return <>{output}</>;
}

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [typing, setTyping] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [loaded, setLoaded] = useState(false);
  const [showDown, setShowDown] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data.messages)) {
          setMessages(data.messages.map((message: Message) =>
            message.role === "bot" ? { ...message, text: cleanOldAnswer(message.text) } : message,
          ));
        }
        if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
      }
    } catch {
      // Ignore invalid or unavailable local storage and start with a fresh chat.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkBackend = async () => {
      try {
        const response = await fetch("/api/chat", { cache: "no-store" });
        const health = await response.json();
        if (!mounted) return;
        setStatus(!response.ok || health.status !== "ready" ? "unavailable" : health.mode === "ai" ? "ready" : "local");
      } catch {
        if (mounted) setStatus("unavailable");
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
    } catch {
      // Chat remains usable if browser storage is full or disabled.
    }
  }, [messages, theme, loaded]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
  }, [input]);

  const streamReply = (fullText: string, update: (text: string) => void) =>
    new Promise<void>((resolve) => {
      let position = 0;
      const timer = window.setInterval(() => {
        if (stopRef.current || position >= fullText.length) {
          window.clearInterval(timer);
          resolve();
          return;
        }
        position = Math.min(fullText.length, position + 3);
        update(fullText.slice(0, position));
      }, 16);
    });

  const respond = useCallback(async (history: Message[]) => {
    setBusy(true);
    stopRef.current = false;
    setTyping(true);
    let reply: string;
    try {
      reply = await getReply(history);
    } catch (error) {
      reply = error instanceof Error && error.message.includes("backend is unreachable")
        ? "I can’t connect to the chatbot service right now. Please try again in a moment."
        : "The assistant is temporarily unavailable. Please try again shortly.";
    }

    setTyping(false);
    const id = uid();
    setMessages((current) => [...current, { id, role: "bot", text: "", time: now() }]);
    await streamReply(reply, (partial) =>
      setMessages((current) => current.map((message) => message.id === id ? { ...message, text: partial } : message)),
    );
    setBusy(false);
  }, []);

  const send = async (suggestedText?: string) => {
    const content = (suggestedText ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { id: uid(), role: "user" as const, text: content, time: now() }];
    setMessages(next);
    setInput("");
    await respond(next);
  };

  const clearChat = () => {
    stopRef.current = true;
    setMessages([]);
    setTyping(false);
    setBusy(false);
  };

  const regenerate = async () => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "bot") return;
    const history = messages.slice(0, -1);
    setMessages(history);
    await respond(history);
  };

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(message.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const onScroll = () => {
    const container = scrollRef.current;
    if (container) setShowDown(container.scrollHeight - container.scrollTop - container.clientHeight > 140);
  };

  const lastId = messages[messages.length - 1]?.id;
  const statusLabel = status === "ready"
    ? "AI assistant online"
    : status === "local"
      ? "Knowledge base online"
      : status === "checking"
        ? "Connecting to assistant"
        : "Assistant offline";

  return (
    <main className="app-shell" data-theme={theme}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <div className="background-grid" />

      <section className="chat-window" aria-label="Infinitive Cloud chat assistant">
        <header className="topbar">
          <div className="brand-area">
            <Image
              className="brand-logo"
              src="/infinitive-cloud-logo.jpeg"
              alt="Infinitive Cloud Private Limited"
              width={970}
              height={205}
              priority
            />
            <div className="connection-status" data-status={status}>
              <span className="status-dot" />
              <span>{statusLabel}</span>
            </div>
          </div>
          <div className="toolbar">
            <span className="secure-label"><span className="secure-dot" /> Cloud support</span>
            <span className="toolbar-divider" />
            <button
              className="icon-button"
              type="button"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <button
              className="icon-button danger-button"
              type="button"
              title="Clear conversation"
              aria-label="Clear conversation"
              disabled={!messages.length}
              onClick={clearChat}
            >
              <Icon name="trash" />
            </button>
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 && !typing ? (
            <div className="welcome-screen">
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR CLOUD, MADE SIMPLE <span className="eyebrow-line" /></div>
              <div className="welcome-orbit" aria-hidden="true">
                <div className="orbit orbit-a" />
                <div className="orbit orbit-b" />
                <div className="orbit-core"><Icon name="sparkle" size={34} /></div>
                <span className="orbit-node node-a"><Icon name="cloud" size={16} /></span>
                <span className="orbit-node node-b"><Icon name="shield" size={15} /></span>
                <span className="orbit-node node-c"><Icon name="arrows" size={16} /></span>
              </div>
              <h1>What can we build<br className="desktop-break" /> <span>in the cloud?</span></h1>
              <p className="welcome-copy">Your Infinitive Cloud guide is ready. Ask about hosting, migration, security, or the right setup for your next idea.</p>

              <div className="suggestion-grid" aria-label="Suggested questions">
                {suggestions.map((suggestion, index) => (
                  <button
                    className="suggestion-card"
                    key={suggestion.eyebrow}
                    type="button"
                    style={{ "--card-index": index } as CSSProperties}
                    onClick={() => void send(suggestion.prompt)}
                  >
                    <span className="suggestion-icon"><Icon name={suggestion.icon} size={19} /></span>
                    <span className="suggestion-copy">
                      <span className="suggestion-eyebrow">{suggestion.eyebrow}</span>
                      <span className="suggestion-title">{suggestion.title}</span>
                    </span>
                    <span className="suggestion-arrow"><Icon name="arrow" size={16} /></span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message.id}>
                  {message.role === "bot" && <div className="assistant-avatar"><Icon name="sparkle" size={17} /></div>}
                  <div className="message-column">
                    <div className="message-bubble">
                      {message.role === "bot" ? <Markdown text={message.text || " "} /> : <p>{message.text}</p>}
                    </div>
                    <div className="message-meta">
                      <time>{message.time}</time>
                      {message.role === "bot" && message.text && (
                        <>
                          <button type="button" title="Copy answer" aria-label="Copy answer" onClick={() => void copyMessage(message)}>
                            <Icon name={copied === message.id ? "check" : "copy"} size={14} />
                          </button>
                          {message.id === lastId && !busy && (
                            <button type="button" title="Regenerate answer" aria-label="Regenerate answer" onClick={() => void regenerate()}>
                              <Icon name="refresh" size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {typing && (
                <div className="message-row bot typing-row" aria-label="Assistant is thinking">
                  <div className="assistant-avatar"><Icon name="sparkle" size={17} /></div>
                  <div className="typing-bubble"><span /><span /><span /></div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {showDown && (
          <button className="scroll-latest" type="button" aria-label="Scroll to latest message" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}>
            <Icon name="chevron" />
          </button>
        )}

        <footer className="chat-footer">
          <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className="input-shell">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                maxLength={MAX_CHARS}
                aria-label="Message the Infinitive Cloud assistant"
                placeholder="Ask anything about your cloud journey..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="input-hint"><span>↵</span> to send <i /> Shift + ↵ for a new line</div>
              <span className="character-count">{input.length}/{MAX_CHARS}</span>
            </div>
            {busy ? (
              <button className="send-button stop-button" type="button" onClick={() => { stopRef.current = true; }}>
                <Icon name="stop" size={17} /><span>Stop</span>
              </button>
            ) : (
              <button className="send-button" type="submit" disabled={!input.trim()} aria-label="Send message">
                <span>Send</span><Icon name="arrow" size={18} />
              </button>
            )}
          </form>
          <div className="footer-note"><Icon name="sparkle" size={13} /> Infinitive Cloud Assistant may make mistakes. Verify important details.</div>
        </footer>
      </section>
      <div className="page-caption"><span /> BUILT FOR WHAT’S NEXT <span /></div>
    </main>
  );
}
