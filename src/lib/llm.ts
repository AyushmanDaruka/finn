// Model routing + content-addressed cache + cost ledger.
//   cheap   → bulk, low-stakes (classify ambiguous filings, one-liners)
//   extract → reading long primary documents into structured JSON
//   reason  → the few judgment calls (promise vs delivery, bull/bear)
// Every call is cached by hash(model + prompt + document), so a document is read once, ever.
import { GoogleGenAI } from "@google/genai";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { hash } from "./screener";
import type { CostEntry } from "./types";

export type Tier = "cheap" | "extract" | "reason";

const MODELS: Record<Tier, string[]> = {
  // First entry preferred; later ones are fallbacks on quota/overload errors.
  // Free tier has no Pro quota, so "reason" = Flash with thinking ON; set FINN_MODEL_REASON to a Pro model on a paid key.
  cheap: [process.env.FINN_MODEL_CHEAP ?? "gemini-3.1-flash-lite", "gemini-3.5-flash"],
  extract: [process.env.FINN_MODEL_EXTRACT ?? "gemini-3.5-flash", "gemini-3.1-flash-lite"],
  reason: [process.env.FINN_MODEL_REASON ?? "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"],
};

// USD per 1M tokens (in, out). We run free; this estimates what the same work would cost on a paid key.
// Unlisted models are estimated at Flash-class rates.
const PRICE: Record<string, [number, number]> = {
  "gemini-3.1-flash-lite": [0.1, 0.4],
  "gemini-3.5-flash": [0.3, 2.5],
  "gemini-3.8-flash": [0.3, 2.5],
};

const CACHE_DIR = process.env.VERCEL ? "/tmp/finn-cache" : path.join(process.cwd(), ".cache", "llm");

export const ledger: CostEntry[] = [];
export const hasKey = () => !!process.env.GEMINI_API_KEY;

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

interface Opts {
  tier: Tier;
  step: string; // label for the cost ledger
  prompt: string;
  doc?: string; // long primary-source text, placed before the prompt
  pdf?: Uint8Array; // raw PDF when text extraction failed (scanned filings)
  schema?: object; // JSON schema → structured output
  search?: boolean; // Google Search grounding (push-side enrichment only)
  system?: string;
}

export async function llm<T = string>(o: Opts): Promise<T> {
  if (!hasKey()) throw new Error("GEMINI_API_KEY not set");
  const key = hash(JSON.stringify([o.tier, o.prompt, o.system, o.doc, o.pdf ? hash(Buffer.from(o.pdf).toString("base64")) : "", o.schema, o.search]));
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    const hit = JSON.parse(await readFile(file, "utf8"));
    ledger.push({ ...hit.cost, cached: true, usd: 0 });
    return hit.value;
  } catch {}

  let lastErr: unknown;
  // Overload (503) → retry the same model with backoff; quota (429) / unavailable → next model.
  const attempts = MODELS[o.tier].flatMap((m) => [m, m, m]);
  for (const [n, model] of attempts.entries()) {
    if (n % 3 && !/503|UNAVAILABLE|overloaded|high demand/i.test(String(lastErr))) continue;
    if (n % 3) await new Promise((r) => setTimeout(r, 2500 * (n % 3)));
    try {
      const parts: object[] = [];
      if (o.pdf) parts.push({ inlineData: { mimeType: "application/pdf", data: Buffer.from(o.pdf).toString("base64") } });
      if (o.doc) parts.push({ text: `<document>\n${o.doc}\n</document>` });
      parts.push({ text: o.prompt });
      const res = await ai().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          temperature: 0.1,
          systemInstruction: o.system,
          ...(o.schema && !o.search ? { responseMimeType: "application/json", responseJsonSchema: o.schema } : {}),
          ...(o.search ? { tools: [{ googleSearch: {} }] } : {}),
          // Thinking only where judgment lives; extraction doesn't need it.
          // Bounded on "reason" so a live report fits a 5-minute serverless budget.
          thinkingConfig: { thinkingBudget: o.tier === "reason" ? 3072 : 0 },
        },
      });
      const text = res.text ?? "";
      const u = res.usageMetadata ?? {};
      const inTok = u.promptTokenCount ?? 0;
      const outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      const [pi, po] = PRICE[model] ?? [0.3, 2.5];
      const cost: CostEntry = { step: o.step, model, inTok, outTok, usd: (inTok * pi + outTok * po) / 1e6 };
      ledger.push(cost);

      let value: unknown = text;
      if (o.schema) value = JSON.parse(o.search ? (text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? "null") : text);
      if (o.search) {
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        value = { value, sources: chunks.map((c) => c.web?.uri).filter(Boolean).slice(0, 3) };
      }
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify({ value, cost }));
      return value as T;
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      // quota / model-unavailable → route to the next model; anything else is a real error
      if (!/429|RESOURCE_EXHAUSTED|404|not found|403|PERMISSION|503|UNAVAILABLE|overloaded/i.test(msg)) throw e;
    }
  }
  throw lastErr;
}

export const totalUsd = (l: CostEntry[] = ledger) => l.reduce((s, c) => s + c.usd, 0);
