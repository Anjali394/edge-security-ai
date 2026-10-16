import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useState, useRef, useEffect } from "react";
import "./styles.css";

type ThreatClassification = {
  threatType: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  confidence: number;
  summary: string;
};

type FirewallRule = {
  expression: string;
  action: string;
  ruleName: string;
  rationale: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ff3b3b",
  High: "#ff6b2b",
  Medium: "#f0a500",
  Low: "#22c55e",
};

const EXAMPLE_PROMPTS = [
  "I'm seeing thousands of requests from IPs in the range 192.0.2.0/24 hitting my login endpoint. How do I block them?",
  "My WAF logs show: POST /admin/login HTTP/1.1, User-Agent: sqlmap/1.7.8, Body: username=' OR 1=1--",
  "My site is under a layer 7 DDoS. 50,000 req/s to /api/search with random user agents from 200+ countries.",
  "I see repeated requests: GET /wp-admin/xmlrpc.php from 300 different IPs. What is this?",
];

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className="severity-badge"
      style={{ backgroundColor: SEVERITY_COLORS[severity] ?? "#888" }}
    >
      {severity}
    </span>
  );
}

function FirewallRuleCard({ rule }: { rule: FirewallRule }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(rule.expression);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="firewall-card">
      <div className="firewall-card-header">
        <span className="firewall-rule-name">🔒 {rule.ruleName}</span>
        <span className="firewall-action action-{rule.action}">{rule.action.toUpperCase()}</span>
      </div>
      <div className="firewall-expression-wrap">
        <code className="firewall-expression">{rule.expression}</code>
        <button className="copy-btn" onClick={copy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p className="firewall-rationale">{rule.rationale}</p>
    </div>
  );
}

function ThreatCard({ threat }: { threat: ThreatClassification }) {
  return (
    <div className="threat-card">
      <div className="threat-header">
        <span className="threat-type">⚠ {threat.threatType}</span>
        <SeverityBadge severity={threat.severity} />
      </div>
      <p className="threat-summary">{threat.summary}</p>
      <div className="threat-confidence">
        <div
          className="confidence-bar"
          style={{ width: `${threat.confidence}%` }}
        />
        <span>{threat.confidence}% confidence</span>
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.split("\n");
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre key={i} className="code-block">
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {part}
          </span>
        );
      })}
    </>
  );
}

function App() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessionId = useState(() => {
    const stored = sessionStorage.getItem("session-id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem("session-id", id);
    return id;
  })[0];

  const agent = useAgent({ agent: "SecurityAgent", name: sessionId });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || status === "streaming") return;
    sendMessage({ text: msg });
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🛡</span>
            <div>
              <span className="logo-title">Edge Security AI</span>
              <span className="logo-sub">Powered by Cloudflare Workers AI · Llama 3.3</span>
            </div>
          </div>
          <span className={`status-dot ${status === "streaming" ? "streaming" : status === "ready" ? "ready" : "connecting"}`} />
        </div>
      </header>

      <main className="chat-area">
        {messages.length === 0 && (
          <div className="welcome">
            <h2>Analyze threats. Generate firewall rules. Stay protected.</h2>
            <p>Paste your Cloudflare logs or describe a security incident to get instant analysis and mitigation recommendations.</p>
            <div className="examples">
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  className="example-btn"
                  onClick={() => handleSend(prompt)}
                >
                  {prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const toolResults = msg.parts?.filter((p) => p.type === "tool-invocation") ?? [];
          const textParts = msg.parts?.filter((p) => p.type === "text") ?? [];

          return (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-role">{msg.role === "user" ? "You" : "Security AI"}</div>
              <div className="message-body">
                {textParts.map((part, i) =>
                  part.type === "text" ? (
                    <MessageContent key={i} content={part.text} />
                  ) : null
                )}
                {toolResults.map((part, i) => {
                  if (part.type !== "tool-invocation") return null;
                  const inv = part.toolInvocation;
                  if (inv.state !== "result") return null;
                  if (inv.toolName === "classifyThreat") {
                    return <ThreatCard key={i} threat={inv.result as ThreatClassification} />;
                  }
                  if (inv.toolName === "suggestFirewallRule") {
                    return <FirewallRuleCard key={i} rule={inv.result as FirewallRule} />;
                  }
                  return null;
                })}
              </div>
            </div>
          );
        })}

        {status === "streaming" && (
          <div className="message assistant">
            <div className="message-role">Security AI</div>
            <div className="message-body typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="input-area">
        <div className="input-wrap">
          <textarea
            className="input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Paste logs or describe a security incident… (Enter to send, Shift+Enter for new line)"
            disabled={status === "streaming"}
          />
          <button
            className="send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || status === "streaming"}
          >
            {status === "streaming" ? "…" : "Analyze →"}
          </button>
        </div>
      </footer>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
