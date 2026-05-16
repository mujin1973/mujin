// Basic Auth gate for the admin Cloudflare Pages project.
// 모든 요청 (정적 자산 + /api/*) 에 적용됨.
// ID 고정 = "admin", PW = env.ADMIN_PASSWORD (Cloudflare Pages secret)

interface Env {
    ADMIN_PASSWORD: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
    const auth = request.headers.get('Authorization') || '';

    if (!auth.startsWith('Basic ')) {
        return unauthorized();
    }

    const decoded = decodeBasic(auth.slice(6));
    if (!decoded) return unauthorized();

    const [user, pass] = decoded;
    if (!timingSafeEqual(user, 'admin') || !timingSafeEqual(pass, env.ADMIN_PASSWORD || '')) {
        return unauthorized();
    }

    return next();
};

function unauthorized(): Response {
    return new Response('Unauthorized', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="무진 어드민", charset="UTF-8"',
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function decodeBasic(b64: string): [string, string] | null {
    try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const text = new TextDecoder('utf-8').decode(bytes);
        const idx = text.indexOf(':');
        if (idx === -1) return null;
        return [text.slice(0, idx), text.slice(idx + 1)];
    } catch {
        return null;
    }
}

// 길이 다른 입력에서도 일정 시간으로 비교 (timing attack 완화)
function timingSafeEqual(a: string, b: string): boolean {
    const ae = new TextEncoder().encode(a);
    const be = new TextEncoder().encode(b);
    const len = Math.max(ae.length, be.length);
    let diff = ae.length ^ be.length;
    for (let i = 0; i < len; i++) {
        diff |= (ae[i] ?? 0) ^ (be[i] ?? 0);
    }
    return diff === 0;
}
