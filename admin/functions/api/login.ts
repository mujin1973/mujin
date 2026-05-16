// POST /api/login  — 자격증명 검증 후 7일 세션 쿠키 발급
// body: { username, password }

import { createSessionToken } from '../_middleware';

interface Env {
    ADMIN_PASSWORD: string;
}

const COOKIE_NAME  = 'mujin_session';
const COOKIE_DAYS  = 7;
const MAX_AGE      = COOKIE_DAYS * 24 * 60 * 60;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    let body: { username?: unknown; password?: unknown };
    try {
        body = await request.json();
    } catch {
        return fail('잘못된 요청입니다.');
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // 타이밍 공격 완화: 비교는 항상 두 번 다 실행
    const userOk = timingSafeEqual(username, 'admin');
    const passOk = timingSafeEqual(password, env.ADMIN_PASSWORD || '');

    if (!userOk || !passOk) {
        return fail('아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    const token = await createSessionToken(env.ADMIN_PASSWORD);
    const cookieVal = encodeURIComponent(token);
    const cookie = `${COOKIE_NAME}=${cookieVal}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`;

    return Response.json({ ok: true }, {
        headers: {
            'Set-Cookie': cookie,
            'Cache-Control': 'no-store',
        },
    });
};

function fail(message: string): Response {
    return Response.json({ ok: false, message }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
    });
}

function timingSafeEqual(a: string, b: string): boolean {
    const ae = new TextEncoder().encode(a);
    const be = new TextEncoder().encode(b);
    const len = Math.max(ae.length, be.length);
    let diff = ae.length ^ be.length;
    for (let i = 0; i < len; i++) diff |= (ae[i] ?? 0) ^ (be[i] ?? 0);
    return diff === 0;
}
