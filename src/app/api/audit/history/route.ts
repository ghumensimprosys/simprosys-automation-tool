import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/auditHistory';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  const history = readHistory(limit);
  return NextResponse.json({ history, count: history.length });
}
