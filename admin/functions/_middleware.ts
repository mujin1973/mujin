// 세션 쿠키 기반 인증 미들웨어.
// 최초 로그인은 /login 페이지 → POST /api/login → 7일 HttpOnly 쿠키 발급.
// 쿠키 없거나 만료 시: API 요청 → 401 JSON, 그 외 → /login 리다이렉트.

interface Env {
    ADMIN_PASSWORD: string;
}

const COOKIE_NAME = 'mujin_session';
// /login 페이지와 /api/login 은 인증 없이 통과
const BYPASS_PATHS = new Set(['/login', '/login.html', '/api/login']);

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
    const url = new URL(request.url);

    if (BYPASS_PATHS.has(url.pathname)) return next();

    const cookie = getCookie(request, COOKIE_NAME);
    if (cookie && await verifySession(cookie, env.ADMIN_PASSWORD || '')) {
        return next();
    }

    if (url.pathname.startsWith('/api/')) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    return Response.redirect(new URL('/login', request.url).href, 302);
};

// ─── 세션 토큰 ───────────────────────────────────────────────────
// 형식: "{expiry_ms}.{hmac_hex}"
// HMAC-SHA256(key=ADMIN_PASSWORD, data=expiry_ms 문자열)

const SESSION_DAYS = 7;

export async function createSessionToken(password: string): Promise<string> {
    const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    const data = String(expiry);
    const key = await importHmacKey(password);
    const sig = await hmacHex(key, data);
    return `${data}.${sig}`;
}

async function verifySession(token: string, password: string): Promise<boolean> {
    const dot = token.lastIndexOf('.');
    if (dot === -1) return false;
    const data = token.slice(0, dot);
    const sig  = token.slice(dot + 1);
    const expiry = parseInt(data, 10);
    if (!expiry || Date.now() > expiry) return false;
    const key = await importHmacKey(password);
    const expected = await hmacHex(key, data);
    return timingSafeEqual(sig, expected);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret || '_fallback_'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

async function hmacHex(key: CryptoKey, data: string): Promise<string> {
    const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── 헬퍼 ────────────────────────────────────────────────────────

function getCookie(req: Request, name: string): string | null {
    const header = req.headers.get('Cookie') || '';
    for (const part of header.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k.trim() === name) return decodeURIComponent(rest.join('='));
    }
    return null;
}

function timingSafeEqual(a: string, b: string): boolean {
    const ae = new TextEncoder().encode(a);
    const be = new TextEncoder().encode(b);
    const len = Math.max(ae.length, be.length);
    let diff = ae.length ^ be.length;
    for (let i = 0; i < len; i++) diff |= (ae[i] ?? 0) ^ (be[i] ?? 0);
    return diff === 0;
}
