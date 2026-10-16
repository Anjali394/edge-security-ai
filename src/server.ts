import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages } from "ai";
import { routeAgentRequest } from "agents";

const SYSTEM_PROMPT = `You are an expert Cloudflare Edge Security Analyst. When a user describes a security incident or pastes logs, respond with this exact structure:

## Threat Analysis
**Type:** [e.g. DDoS, Credential Stuffing, SQL Injection, Bot Traffic, WAF Bypass]
**Severity:** [Critical / High / Medium / Low]
**Summary:** [One sentence explaining what is happening]

## What's Happening
[2-3 sentences explaining the attack in plain English]

## Recommended Firewall Rule
\`\`\`
(your cloudflare filter expression here)
\`\`\`
**Action:** [block / challenge / js_challenge / managed_challenge]

## Additional Mitigations
- [Cloudflare-specific recommendation 1]
- [Cloudflare-specific recommendation 2]
- [Cloudflare-specific recommendation 3]

Cloudflare filter expression examples:
- Block IP range: (ip.src in {1.2.3.0/24})
- Block country: (ip.geoip.country eq "RU")
- Block user agent: (http.user_agent contains "sqlmap")
- Rate limit path: (http.request.uri.path eq "/api/login")
- Block bots: (cf.client.bot)
- Combined: (ip.geoip.country eq "RU" and http.request.uri.path eq "/api/login")

Always be concise and actionable. Every response must include a ready-to-use firewall rule expression.`;

export class SecurityAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<AIChatAgent["onChatMessage"]>[0]) {
    try {
      const workersai = createWorkersAI({ binding: this.env.AI });

      const result = streamText({
        model: workersai("@cf/meta/llama-3.1-8b-instruct-fp8"),
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(this.messages),
        onFinish,
      });

      return result.toUIMessageStreamResponse();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("onChatMessage error:", msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
