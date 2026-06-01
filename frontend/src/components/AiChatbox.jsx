import { useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

const QUICK_PROMPTS = {
  EMPLOYEE: [
    "Summarize my current assignments.",
    "Do I have any recent attendance issues?",
    "What request status should I check?"
  ],
  HR_MANAGER: [
    "Summarize current HR operation risks.",
    "Which requests or face enrollments need attention?",
    "How is workforce allocation looking?"
  ],
  PROJECT_MANAGER: [
    "Summarize project progress and risks.",
    "Which materials need attention?",
    "Summarize costs by status and category."
  ],
  ADMIN: [
    "Summarize system operations.",
    "What project or HR risks should be checked first?",
    "Give me a management summary."
  ],
  SUPER_ADMIN: [
    "Summarize system operations.",
    "What project or HR risks should be checked first?",
    "Give me a management summary."
  ]
};

export default function AiChatbox({ token, profile }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Ask me about projects, workforce, materials, costs, attendance, requests, RFx, or construction diaries."
    }
  ]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  const prompts = useMemo(() => {
    const role = String(profile?.role || "EMPLOYEE").toUpperCase();
    return QUICK_PROMPTS[role] || QUICK_PROMPTS.EMPLOYEE;
  }, [profile?.role]);

  const sendMessage = async (messageText = input) => {
    const text = String(messageText || "").trim();
    if (!text || loading) {
      return;
    }
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    window.setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }, 0);

    try {
      const response = await apiRequest("/ai/chat", token, {
        method: "POST",
        body: {
          message: text,
          messages: nextMessages.slice(-8)
        },
        toast: false
      });
      setMessages((current) => [...current, { role: "assistant", content: response?.answer || "No answer returned." }]);
      window.setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      }, 0);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error.message || "AI assistant is unavailable." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[950] sm:bottom-5 sm:right-5">
      {open && (
        <section className="mb-3 flex h-[min(640px,calc(100vh-96px))] w-[calc(100vw-32px)] max-w-[420px] flex-col overflow-hidden rounded-2xl border border-steel/15 bg-white shadow-2xl sm:w-[420px]">
          <header className="flex items-center justify-between border-b border-steel/10 bg-gradient-to-r from-steel to-emerald-700 px-4 py-3 text-white">
            <div>
              <h3 className="text-sm font-bold">AI Assistant</h3>
              <p className="text-xs text-white/75">{profile?.role || "User"} support</p>
            </div>
            <button
              type="button"
              aria-label="Close AI assistant"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <CloseIcon />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {messages.map((item, index) => (
              <div key={`${item.role}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    item.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "border border-steel/10 bg-white text-steel shadow-sm"
                  }`}
                >
                  {item.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-steel/10 bg-white px-3 py-2 text-sm text-graphite/70 shadow-sm">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-steel/10 bg-white p-3">
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="shrink-0 rounded-full border border-steel/15 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-steel hover:bg-emerald-50 hover:text-emerald-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage();
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask the AI assistant..."
                className="min-w-0 flex-1 rounded-xl border border-steel/20 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </section>
      )}

      <button
        type="button"
        aria-label="Open AI assistant"
        title="AI Assistant"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-steel to-emerald-600 text-white shadow-xl ring-1 ring-white/40 transition hover:scale-105 hover:shadow-2xl"
      >
        <ChatIcon />
      </button>
    </div>
  );
}
