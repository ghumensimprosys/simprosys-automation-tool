import { NextResponse } from 'next/server';
import { createSessionToken } from '@/middleware';

export async function POST(request: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: 'Auth is not configured on this server' }, { status: 503 });
  }

  let password: string;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!password || password !== adminPassword) {
    // Deliberate fixed delay to blunt brute-force timing attacks
    await new Promise(r => setTimeout(r, 200));
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set('qa_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60, // 24h in seconds
    path: '/',
  });
  return response;
}
