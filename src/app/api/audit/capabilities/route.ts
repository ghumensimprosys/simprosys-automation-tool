import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isOllamaReachable, isModelAvailable, TEXT_MODEL, VISION_MODEL } from '@/lib/ollama';
import type { AuditCapabilities } from '@/types/audit';

export async function GET() {
  const [ollamaReachable, textModelAvailable, visionModelAvailable] = await Promise.all([
    isOllamaReachable(),
    isModelAvailable(TEXT_MODEL),
    isModelAvailable(VISION_MODEL),
  ]);

  const axePath = path.join(process.cwd(), 'public', 'vendor', 'axe.min.js');
  const axeCoreAvailable = fs.existsSync(axePath);

  const capabilities: AuditCapabilities = {
    ollamaReachable,
    textModel: TEXT_MODEL,
    visionModel: visionModelAvailable ? VISION_MODEL : null,
    hasVision: ollamaReachable && visionModelAvailable,
    axeCoreAvailable,
  };

  return NextResponse.json(capabilities);
}
