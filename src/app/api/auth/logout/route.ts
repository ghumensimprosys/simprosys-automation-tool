import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('qa_session', '', { maxAge: 0, path: '/' });
  return response;
}
