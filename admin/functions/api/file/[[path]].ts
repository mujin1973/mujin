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

// PUT 은 4단계에서 활성화 — 일단 stub
export const onRequestPut: PagesFunction<Env> = async () => {
    return new Response('PUT is not yet implemented (단계 4에서 활성화 예정)', {
        status: 501,
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
