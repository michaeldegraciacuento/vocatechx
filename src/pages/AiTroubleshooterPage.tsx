import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  FileDown,
  Loader2,
  MessageSquarePlus,
  RotateCw,
  SendHorizontal,
  Square,
  Trash2,
  User,
} from "lucide-react";
import { useAuth } from "../auth/context";
import { MarkdownText } from "../components/MarkdownText";
import {
  api,
  errorMessage,
  isAppError,
  type ChatMessage,
  type ConversationSummary,
  type ImportProgress,
  type RalpStatus,
} from "../lib/api";
import { formatBytes, formatRelativeTime } from "../lib/format";
import { cardClass } from "../styles";

const MAX_MESSAGE_CHARS = 4000;
const STATUS_POLL_MS = 1500;

const SUGGESTIONS = [
  "My PC turns on but there is no display.",
  "Wi-Fi is connected but there is no internet.",
  "The printer shows as offline in Windows.",
  "Windows is very slow right after startup.",
];

const STATUS_CHIP: Record<RalpStatus["state"], { label: string; className: string }> = {
  ready: { label: "Online", className: "bg-[#ecfdf3] text-[#067647]" },
  starting: { label: "Starting…", className: "bg-[#eef4ff] text-[#1d4ed8]" },
  stopped: { label: "Stopped", className: "bg-[#f3f5f8] text-[#5b6577]" },
  model_missing: { label: "Model not found", className: "bg-[#fef3c7] text-[#b45309]" },
  runtime_missing: { label: "Engine missing", className: "bg-[#fef2f2] text-[#b91c1c]" },
  error: { label: "Error", className: "bg-[#fef2f2] text-[#b91c1c]" },
};

function RalpAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid flex-shrink-0 place-items-center rounded-[10px] bg-[#101827] text-[#7db5ff]"
      style={{ width: size, height: size }}
    >
      <Bot size={Math.round(size * 0.55)} />
    </span>
  );
}

function MessageBubble({ role, content, streaming = false }: { role: ChatMessage["role"]; content: string; streaming?: boolean }) {
  if (role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-[#2563eb] px-4 py-2.5 text-[13px] leading-[1.65] whitespace-pre-wrap text-white">
          {content}
        </div>
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[10px] bg-[#e7efff] text-[#2563eb]">
          <User size={16} />
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <RalpAvatar />
      <div className="max-w-[82%] min-w-0 rounded-2xl rounded-tl-md border border-[#e3e8ef] bg-white px-4 py-3 text-[13px] leading-[1.7] text-[#344054]">
        {content ? (
          <MarkdownText text={content} />
        ) : (
          <span className="flex items-center gap-2 text-[#8b95a6]">
            <Loader2 size={14} className="animate-spin" /> Ralp is thinking…
          </span>
        )}
        {streaming && content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#3b82f6] align-middle" />}
      </div>
    </div>
  );
}

function SetupPanel({
  status,
  importing,
  progress,
  onImport,
  onRetry,
}: {
  status: RalpStatus;
  importing: boolean;
  progress: ImportProgress | null;
  onImport: () => void;
  onRetry: () => void;
}) {
  if (status.state === "starting") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <RalpAvatar size={56} />
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-[#172033]">
          <Loader2 size={16} className="animate-spin text-[#2563eb]" /> Ralp is waking up…
        </p>
        <p className="m-0 max-w-[360px] text-xs leading-[1.7] text-[#788397]">
          Loading {status.modelName ?? "the model"} into memory. This usually takes 10–30 seconds.
        </p>
      </div>
    );
  }

  if (status.state === "model_missing") {
    const percent = progress && progress.totalBytes > 0 ? (progress.copiedBytes / progress.totalBytes) * 100 : 0;
    return (
      <div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
        <RalpAvatar size={56} />
        <p className="m-0 text-sm font-semibold text-[#172033]">Ralp needs its model file</p>
        <p className="m-0 text-xs leading-[1.7] text-[#788397]">
          Ralp runs fully offline using a local model (<code className="text-[#344054]">.gguf</code> file). Import the
          model that came with VocaTechX, or place it in this folder and reopen this page:
        </p>
        <code className="max-w-full rounded-[8px] bg-[#f3f5f8] px-3 py-1.5 text-[11px] break-all text-[#344054]">
          {status.modelFolder}
        </code>
        {importing ? (
          <div className="mt-2 grid w-full max-w-[320px] gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-[#eef1f5]">
              <div className="h-full rounded-full bg-[#3b82f6] transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="m-0 text-[11px] text-[#788397]">
              {progress
                ? `Copying… ${formatBytes(progress.copiedBytes)} of ${formatBytes(progress.totalBytes)}`
                : "Waiting for you to choose a file…"}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={onImport}
            className="mt-2 flex cursor-pointer items-center gap-2 rounded-[9px] border-none bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
          >
            <FileDown size={15} /> Import model file…
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fef2f2] text-[#dc2626]">
        <AlertTriangle size={26} />
      </span>
      <p className="m-0 text-sm font-semibold text-[#172033]">Ralp is not available</p>
      <p className="m-0 text-xs leading-[1.7] break-words text-[#788397]">{status.message ?? "Something went wrong."}</p>
      {status.state !== "runtime_missing" && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 flex cursor-pointer items-center gap-2 rounded-[9px] border border-[#dce2eb] bg-white px-4 py-2.5 text-xs font-semibold text-[#344054] hover:bg-[#f7f9fc]"
        >
          <RotateCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

function AiTroubleshooterPage() {
  const { refreshSession } = useAuth();
  const [status, setStatus] = useState<RalpStatus | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sending = streamingText !== null;
  const ready = status?.state === "ready";

  const handleError = useCallback(
    (e: unknown) => {
      if (isAppError(e) && (e.code === "unauthenticated" || e.code === "password_change_required")) {
        refreshSession();
        return;
      }
      setError(errorMessage(e));
    },
    [refreshSession],
  );

  const loadConversations = useCallback(() => {
    api.ralpListConversations().then(setConversations, handleError);
  }, [handleError]);

  const startRalp = useCallback(() => {
    setError(null);
    setStatus((s) => (s ? { ...s, state: "starting", message: null } : s));
    api.ralpStart().then(setStatus, (e) => {
      handleError(e);
      api.ralpStatus().then(setStatus, handleError);
    });
  }, [handleError]);

  // Load status once; start Ralp automatically when the model is present.
  useEffect(() => {
    api.ralpStatus().then((s) => {
      setStatus(s);
      if (s.state === "stopped") startRalp();
    }, handleError);
    loadConversations();
  }, [startRalp, loadConversations, handleError]);

  // While another caller is starting Ralp, keep the status fresh.
  useEffect(() => {
    if (status?.state !== "starting") return;
    const timer = window.setInterval(() => api.ralpStatus().then(setStatus, handleError), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [status?.state, handleError]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  function openConversation(id: number) {
    if (sending) return;
    setError(null);
    setActiveId(id);
    api.ralpGetMessages(id).then(setMessages, handleError);
  }

  function newConversation() {
    if (sending) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  async function deleteConversation(id: number) {
    if (sending || !window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await api.ralpDeleteConversation(id);
      if (id === activeId) newConversation();
      loadConversations();
    } catch (e) {
      handleError(e);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || !ready) return;

    setError(null);
    setDraft("");
    setStreamingText("");
    try {
      await api.ralpSendMessage(activeId, message, (event) => {
        if (event.type === "started") {
          setActiveId(event.conversationId);
          setMessages((m) => [...m, event.userMessage]);
          loadConversations();
        } else if (event.type === "delta") {
          setStreamingText((t) => (t ?? "") + event.text);
        } else if (event.message) {
          const reply = event.message;
          setMessages((m) => [...m, reply]);
        }
      });
    } catch (e) {
      handleError(e);
      setDraft((d) => d || message);
      api.ralpStatus().then(setStatus, () => {});
    } finally {
      setStreamingText(null);
    }
  }

  async function importModel() {
    setImporting(true);
    setImportProgress(null);
    setError(null);
    try {
      const imported = await api.ralpImportModel(setImportProgress);
      if (imported) startRalp();
    } catch (e) {
      handleError(e);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  const chip = status ? STATUS_CHIP[status.state] : null;

  return (
    <div className="grid h-[calc(100vh-132px)] min-h-[520px] grid-cols-[250px_minmax(0,1fr)] gap-5">
      <aside className={`${cardClass} flex min-h-0 flex-col gap-3 p-3`}>
        <button
          type="button"
          onClick={newConversation}
          disabled={sending}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border-none bg-[#2563eb] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MessageSquarePlus size={15} /> New conversation
        </button>
        <p className="m-0 px-1 pt-1 text-[9px] font-bold tracking-[1.5px] text-[#8b95a6]">HISTORY</p>
        <ul className="m-0 grid min-h-0 list-none content-start gap-0.5 overflow-y-auto p-0">
          {conversations.length === 0 && (
            <li className="px-2 py-3 text-[11px] leading-[1.6] text-[#8b95a6]">Your conversations with Ralp will appear here.</li>
          )}
          {conversations.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => openConversation(c.id)}
                className={`w-full cursor-pointer rounded-[8px] border-none px-2.5 py-2 pr-8 text-left ${
                  c.id === activeId ? "bg-[#eef4ff]" : "bg-transparent hover:bg-[#f7f9fc]"
                }`}
              >
                <span className={`block truncate text-xs font-semibold ${c.id === activeId ? "text-[#1d4ed8]" : "text-[#344054]"}`}>
                  {c.title}
                </span>
                <span className="block text-[10px] text-[#8b95a6]">{formatRelativeTime(c.updatedAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => deleteConversation(c.id)}
                aria-label={`Delete conversation ${c.title}`}
                className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-[#a0a9b8] group-hover:block hover:bg-[#fef2f2] hover:text-[#dc2626]"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`${cardClass} flex min-h-0 flex-col p-0`}>
        <header className="flex items-center gap-3 border-b border-[#eef1f5] px-5 py-3.5">
          <RalpAvatar size={36} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="m-0 text-sm font-bold text-[#172033]">Ralp</p>
            <p className="m-0 truncate text-[11px] text-[#788397]">
              Your offline troubleshooting assistant{status?.modelName ? ` · ${status.modelName}` : ""}
            </p>
          </div>
          {chip && <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${chip.className}`}>{chip.label}</span>}
        </header>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#fbfcfe] px-5 py-5">
          {!status ? (
            <div className="m-auto"><Loader2 size={20} className="animate-spin text-[#a0a9b8]" /></div>
          ) : !ready && messages.length === 0 ? (
            <div className="m-auto">
              <SetupPanel status={status} importing={importing} progress={importProgress} onImport={importModel} onRetry={startRalp} />
            </div>
          ) : messages.length === 0 && !sending ? (
            <div className="m-auto flex max-w-[520px] flex-col items-center gap-3 text-center">
              <RalpAvatar size={56} />
              <p className="m-0 text-lg font-bold tracking-[-0.3px] text-[#172033]">Hi, I'm Ralp.</p>
              <p className="m-0 text-xs leading-[1.7] text-[#788397]">
                Describe the problem you're seeing: symptoms, error messages, and what changed recently. I'll walk you
                through the checks step by step.
              </p>
              <div className="mt-2 grid w-full grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="cursor-pointer rounded-[10px] border border-[#e3e8ef] bg-white px-3 py-2.5 text-left text-[11px] leading-[1.5] text-[#344054] hover:border-[#bfd4fb] hover:bg-[#f7faff]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid content-start gap-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} />
              ))}
              {sending && <MessageBubble role="assistant" content={streamingText ?? ""} streaming />}
            </div>
          )}
        </div>

        <div className="border-t border-[#eef1f5] px-5 pt-3 pb-3.5">
          {error && (
            <p role="alert" className="m-0 mb-2.5 rounded-[9px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#b91c1c]">
              {error}
            </p>
          )}
          {status && !ready && messages.length > 0 && status.state !== "starting" && (
            <div className="mb-2.5 flex items-center justify-between gap-3 rounded-[9px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
              <span>{status.message ?? "Ralp is not running."}</span>
              <button
                type="button"
                onClick={startRalp}
                className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 border-none bg-transparent font-semibold text-[#b45309]"
              >
                <RotateCw size={13} /> Restart Ralp
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex items-end gap-2.5"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              disabled={!ready}
              rows={2}
              placeholder={ready ? "Describe the problem… (Enter to send, Shift+Enter for a new line)" : "Ralp is not ready yet"}
              aria-label="Message Ralp"
              className="max-h-40 min-h-[47px] flex-1 resize-none rounded-[11px] border border-[#dce2eb] bg-white px-3.5 py-3 text-[13px] leading-[1.5] text-[#172033] outline-none placeholder:text-[#a0a9b8] focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_#3b82f61a] disabled:bg-[#f7f9fc]"
            />
            {sending ? (
              <button
                type="button"
                onClick={() => api.ralpStopGeneration().catch(handleError)}
                className="flex h-[47px] cursor-pointer items-center gap-2 rounded-[11px] border border-[#dce2eb] bg-white px-4 text-xs font-semibold text-[#344054] hover:bg-[#f7f9fc]"
              >
                <Square size={13} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!ready || !draft.trim()}
                aria-label="Send"
                className="grid h-[47px] w-[47px] cursor-pointer place-items-center rounded-[11px] border-none bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendHorizontal size={18} />
              </button>
            )}
          </form>
          <p className="m-0 mt-2 text-[10px] text-[#8b95a6]">
            Ralp runs offline on this computer and can make mistakes. Double-check steps that could affect data.
          </p>
        </div>
      </section>
    </div>
  );
}

export default AiTroubleshooterPage;
