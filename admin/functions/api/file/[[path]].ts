// GET (and later PUT) /api/file/{...path}
// 임의 경로의 파일을 GitHub Contents API로 read/write 하는 프록시.
// 인증은 부모 _middleware.ts 에서 이미 처리됨.

interface Env {
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;        // "mujin1973/mujin"
    GITHUB_BRANCH: string;      // "main"
}

const TEXT_EXT = new Set(['html', 'htm', 'css', 'js', 'mjs', 'ts', 'json', 'svg', 'txt', 'md', 'xml']);

// 안전성: 호출자가 ../ 같은 경로 트래버설을 못 넣게
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
    const path = normalizePath(params.path);
    if (!path) return badRequest('invalid path');
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return serverError('missing GitHub config');

    const branch = env.GITHUB_BRANCH || 'main';
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;

    const ghRes = await fetch(url, {
        headers: githubHeaders(env.GITHUB_TOKEN),
    });

    if (ghRes.status === 404) return notFound(path);
    if (!ghRes.ok) {
        const body = await ghRes.text();
        return new Response(`GitHub API error: ${ghRes.status}\n${body}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    const data = await ghRes.json() as { content?: string; sha: string; encoding?: string; size?: number };
    const isText = isTextPath(path);

    let content: string;
    if (data.encoding === 'base64' && typeof data.content === 'string' && isText) {
        // base64 → utf-8 text
        const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
        content = new TextDecoder('utf-8').decode(bytes);
    } else {
        content = (data.content || '').replace(/\n/g, '');
    }

    return Response.json({
        path,
        sha: data.sha,
        encoding: isText ? 'text' : 'base64',
        content,
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
};

interface PutBody {
    content?: unknown;
    sha?: unknown;
    message?: unknown;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, params, env }) => {
    const path = normalizePath(params.path);
    if (!path) return badRequest('invalid path');
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return serverError('missing GitHub config');

    let body: PutBody;
    try {
        body = await request.json();
    } catch {
        return badRequest('invalid JSON body');
    }
    if (typeof body.content !== 'string') return badRequest('body.content (string) required');
    // sha는 기존 파일 업데이트 시 필수, 새 파일 생성 시 빈 문자열 허용
    const shaVal = typeof body.sha === 'string' ? body.sha.trim() : '';

    const message = typeof body.message === 'string' && body.message.trim()
        ? body.message
        : `chore(content): update ${path} via admin`;
    const branch = env.GITHUB_BRANCH || 'main';

    // utf-8 → base64 (GitHub Contents API 요구)
    const bytes = new TextEncoder().encode(body.content);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const contentB64 = btoa(bin);

    const ghPayload: Record<string, unknown> = { message, content: contentB64, branch };
    if (shaVal) ghPayload.sha = shaVal; // 빈 sha면 신규 파일 생성

    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`;
    const ghRes = await fetch(url, {
        method: 'PUT',
        headers: {
            ...githubHeaders(env.GITHUB_TOKEN),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(ghPayload),
    });

    if (ghRes.ok) {
        const data = await ghRes.json() as {
            content?: { sha?: string; path?: string };
            commit?: { sha?: string; message?: string; html_url?: string };
        };
        return Response.json({
            ok: true,
            path,
            sha: data.content?.sha,
            commit: {
                sha: data.commit?.sha,
                message: data.commit?.message,
                url: data.commit?.html_url,
            },
        }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    }

    const errText = await ghRes.text();
    // GitHub은 SHA 불일치 시 보통 409 "Conflict" 또는 422 + "does not match" 메시지로 응답.
    // 둘 다 admin이 통일된 형태로 해석할 수 있게 409로 정규화한다.
    if (ghRes.status === 409 || (ghRes.status === 422 && /sha|does not match|expected/i.test(errText))) {
        return Response.json({
            error: 'sha_conflict',
            message: '다른 곳에서 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요.',
        }, { status: 409 });
    }
    if (ghRes.status === 404) return notFound(path);

    return new Response(`GitHub API error: ${ghRes.status}\n${errText}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
};

// ─── helpers ────────────────────────────────────────────────────

function normalizePath(raw: string | string[] | undefined): string | null {
    if (!raw) return null;
    const segments = Array.isArray(raw) ? raw : [raw];
    if (segments.length === 0) return null;
    for (const seg of segments) {
        if (!PATH_SEGMENT.test(seg)) return null;
    }
    return segments.join('/');
}

function encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
}

function isTextPath(p: string): boolean {
    const ext = p.split('.').pop()?.toLowerCase() || '';
    return TEXT_EXT.has(ext);
}

function githubHeaders(token: string): HeadersInit {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mujin-admin',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function badRequest(msg: string): Response {
    return new Response(msg, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
function notFound(path: string): Response {
    return new Response(`not found: ${path}`, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
function serverError(msg: string): Response {
    return new Response(msg, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
