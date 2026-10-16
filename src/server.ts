import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import { routeAgentRequest } from "agents";

const SYSTEM_PROMPT = `You are an expert Cloudflare Edge Security Analyst with deep knowledge of:
- DDoS attacks (volumetric, protocol, application-layer)
- Web Application Firewall (WAF) bypass techniques
- Bot detection and mitigation
- Cloudflare Firewall Rules, Rate Limiting, and WAF managed rules
- HTTP request patterns, anomaly detection, and threat classification
- Cloudflare Workers, Pages, and R2 security

When a user pastes logs, request data, or describes a security incident:
1. Identify the threat type and attack vector
2. Assess the severity (Critical / High / Medium / Low)
3. Explain what is happening in plain English
4. Suggest a specific, ready-to-use Cloudflare Firewall Rule expression
5. Recommend additional Cloudflare mitigations (rate limiting, Bot Fight Mode, WAF rules, etc.)

Firewall rule expressions use Cloudflare's filter syntax, for example:
- Block by IP: (ip.src eq 1.2.3.4)
- Block by country: (ip.geoip.country eq "CN")
- Block by user agent: (http.user_agent contains "sqlmap")
- Rate limit by path: (http.request.uri.path eq "/login")
- Block known bots: (cf.client.bot)

Always format firewall rule suggestions in a code block. Be concise but thorough.`;

export class SecurityAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<AIChatAgent["onChatMessage"]>[0]) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools: {
        classifyThreat: tool({
          description:
            "Classify the threat type and severity based on the log or description provided",
          parameters: z.object({
            threatType: z
              .string()
              .describe(
                "Type of threat, e.g. DDoS, SQL Injection, Bot Traffic, WAF Bypass, Credential Stuffing"
              ),
            severity: z
              .enum(["Critical", "High", "Medium", "Low"])
              .describe("Severity level of the threat"),
            confidence: z
              .number()
              .min(0)
              .max(100)
              .describe("Confidence percentage of this classification"),
            summary: z
              .string()
              .describe("One-sentence summary of the threat"),
          }),
          execute: async ({ threatType, severity, confidence, summary }) => ({
            threatType,
            severity,
            confidence,
            summary,
          }),
        }),

        suggestFirewallRule: tool({
          description:
            "Generate a ready-to-use Cloudflare Firewall Rule expression to block or mitigate the threat",
          parameters: z.object({
            expression: z
              .string()
              .describe("Cloudflare filter expression, e.g. (ip.src eq 1.2.3.4)"),
            action: z
              .enum(["block", "challenge", "js_challenge", "managed_challenge", "log"])
              .describe("Action to take when the rule matches"),
            ruleName: z
              .string()
              .describe("Short descriptive name for this rule"),
            rationale: z
              .string()
              .describe("Why this rule will mitigate the threat"),
          }),
          execute: async ({ expression, action, ruleName, rationale }) => ({
            expression,
            action,
            ruleName,
            rationale,
          }),
        }),
      },
      maxSteps: 3,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
