/**
 * src/lib/ollama.ts
 *
 * Central Ollama client. Single source of truth for base URL, model names,
 * and all request helpers. Every API route imports from here — no more
 * per-file OLLAMA_BASE_URL/OLLAMA_MODEL duplication.
 */

export const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');

/** Code generation, analysis, structured JSON output */
export const TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || 'qwen2.5-coder:14b';

/** Vision + conversational reasoning (gemma4 confirmed vision-capable) */
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'gemma4:latest';

const DEFAULT_OPTIONS = { temperature: 0.1, num_predict: 4096 };

// ─── Connectivity ─────────────────────────────────────────────────────────────

export async function isOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models as { name: string }[] || []).map(m => m.name);
  } catch {
    return [];
  }
}

export async function isModelAvailable(model: string): Promise<boolean> {
  const models = await listModels();
  return models.some(m => m === model || m.startsWith(model.split(':')[0]));
}

// ─── Text generation ──────────────────────────────────────────────────────────

export interface GenerateOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  numPredict?: number;
  stream?: false;
}

/** Non-streaming generate. Returns full response string. */
export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const model = opts.model ?? TEXT_MODEL;
  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: opts.temperature ?? DEFAULT_OPTIONS.temperature,
      num_predict: opts.numPredict ?? DEFAULT_OPTIONS.num_predict,
    },
  };
  if (opts.systemPrompt) body.system = opts.systemPrompt;

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama generate failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data.response as string) || '';
}

// ─── Chat (messages API) ──────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  numPredict?: number;
}

/** Non-streaming chat. Returns assistant message content. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const model = opts.model ?? TEXT_MODEL;
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? DEFAULT_OPTIONS.temperature,
      num_predict: opts.numPredict ?? DEFAULT_OPTIONS.num_predict,
    },
  };

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama chat failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data.message?.content as string) || '';
}

/** Streaming chat. Returns a ReadableStream of text tokens. */
export async function chatStream(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const model = opts.model ?? TEXT_MODEL;
  const body = {
    model,
    messages,
    stream: true,
    options: {
      temperature: opts.temperature ?? DEFAULT_OPTIONS.temperature,
      num_predict: opts.numPredict ?? DEFAULT_OPTIONS.num_predict,
    },
  };

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama chatStream failed (${res.status}): ${text}`);
  }

  const ollamaBody = res.body;

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = ollamaBody.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const token: string = parsed?.message?.content ?? '';
              if (token) controller.enqueue(encoder.encode(token));
              if (parsed.done) { controller.close(); return; }
            } catch { /* partial NDJSON line — skip */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// ─── Vision ───────────────────────────────────────────────────────────────────

export interface VisionOptions {
  model?: string;
  temperature?: number;
  numPredict?: number;
}

/**
 * Send one or more base64 PNG screenshots to the vision model.
 * Returns the model's full text response.
 */
export async function analyzeImages(
  prompt: string,
  base64Images: string[],
  opts: VisionOptions = {},
): Promise<string> {
  const model = opts.model ?? VISION_MODEL;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: prompt,
      images: base64Images,
    },
  ];
  return chat(messages, { model, temperature: opts.temperature, numPredict: opts.numPredict });
}

// ─── JSON extraction helper ───────────────────────────────────────────────────

/**
 * Extract a JSON value from model output that may contain markdown fences,
 * leading prose, or trailing commentary.
 *
 * Returns parsed value on success, throws on parse failure.
 */
export function extractJson<T = unknown>(raw: string): T {
  // 1. Try the whole string first (model may return pure JSON)
  try { return JSON.parse(raw) as T; } catch { /* fall through */ }

  // 2. Strip markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) as T; } catch { /* fall through */ }
  }

  // 3. Find first { or [ to last } or ]
  const objStart = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  let start = -1;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);

  if (start !== -1) {
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)) as T; } catch { /* fall through */ }
    }
  }

  throw new Error(`Could not extract JSON from model output:\n${raw.slice(0, 300)}`);
}
