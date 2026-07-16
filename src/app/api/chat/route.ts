import { NextResponse } from 'next/server';
import { OLLAMA_BASE_URL, TEXT_MODEL, chatStream } from '@/lib/ollama';

const SYSTEM_PROMPT = `You are a QA automation expert assistant embedded in Simprosys Testing Tool.
You help users write, debug, and improve UI test automation scripts using plain English commands.

You are deeply familiar with:
- Simprosys Testing Tool syntax (plain English commands like: click "Login", enter "value" into "Field", check that page contains "text")
- Playwright automation (JavaScript/TypeScript)
- Test best practices and QA strategies
- Browser behavior, selectors, and timing issues

When suggesting test commands, use the Simprosys Testing Tool syntax.
When suggesting code, use Playwright JavaScript.
Be concise, practical, and actionable. Format code blocks with triple backticks.`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    // Health check
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`).catch(() => null);
    if (!health?.ok) {
      return NextResponse.json(
        { error: `Ollama is not running at ${OLLAMA_BASE_URL}. Run: ollama serve` },
        { status: 503 }
      );
    }

    const stream = await chatStream(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      { model: TEXT_MODEL, temperature: 0.7, numPredict: 2048 },
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
