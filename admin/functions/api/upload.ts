// POST /api/upload — multipart 이미지를 GitHub Contents API로 commit
// 인증은 부모 _middleware.ts 에서 이미 처리됨.
//
// 요청 (multipart/form-data):
//   - file:  업로드할 이미지 (File)
//   - site:  사이트 키 (현재 "mujinmoolsan"만 허용)
//   - kind:  "image" | "bgimage" (선택, 분류용 — 저장 경로는 동일)
//
// 응답: { path, previewUrl, filename, size, sha }
//   - path: HTML 의 img.src 에 들어갈 상대경로 (예: "images/foo-1700000000.png")
//   - previewUrl: GitHub raw URL (admin 미리보기 iframe 용)

interface Env {
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;        // "mujin1973/mujin"
    GITHUB_BRANCH: string;      // "main"
}

// site 키 → repo 내 이미지 폴더. path traversal 방지를 위해 클라이언트가 직접 경로를
// 보내지 않고 site 키로만 지정하게 한다. 새 그룹사 추가 시 여기 한 줄만 더하면 됨.
const SITE_IMAGE_DIRS: Record<string, string> = {
    mujinmoolsan: 'mujinmoolsan-landing/images',
};

const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// 원본 파일명 sanitize용. ext 는 별도 검증.
const SAFE_BASE = /^[a-zA-Z0-9._-]+$/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return serverError('missing GitHub config');

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return badRequest('multipart/form-data 가 아닙니다');
    }

    const site = String(form.get('site') || '').trim();
    const dir = SITE_IMAGE_DIRS[site];
    if (!dir) return badRequest(`알 수 없는 site: ${site || '(미지정)'}`);

    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('file 필드 누락');
    if (file.size === 0) return badRequest('빈 파일');
    if (file.size > MAX_BYTES) {
        return badRequest(`파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB > 5MB)`);
    }

    const { base, ext, error } = parseFilename(file.name);
    if (error) return badRequest(error);

    const newName = `${base}-${Date.now()}.${ext}`;
    const relPath = `images/${newName}`;                 // HTML 안에 들어갈 상대경로
    const repoPath = `${dir}/${newName}`;                // GitHub 내 절대 경로
    const branch = env.GITHUB_BRANCH || 'main';

    // 바이너리 → base64 (GitHub Contents API 요구)
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentB64 = bytesToBase64(bytes);

    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodePath(repoPath)}`;
    const ghRes = await fetch(url, {
        method: 'PUT',
        headers: {
            ...githubHeaders(env.GITHUB_TOKEN),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: `chore(content): upload ${newName} via admin`,
            content: contentB64,
            branch,
        }),
    });

    if (!ghRes.ok) {
        const errText = await ghRes.text();
        return new Response(`GitHub API error: ${ghRes.status}\n${errText}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    const data = await ghRes.json() as { content?: { sha?: string } };
    const previewUrl = `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${branch}/${dir}/${newName}`;

    return Response.json({
        ok: true,
        path: relPath,
        previewUrl,
        filename: newName,
        size: file.size,
        sha: data.content?.sha,
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
};

// ─── helpers ────────────────────────────────────────────────────

function parseFilename(name: string): { base: string; ext: string; error?: string } {
    const trimmed = (name || '').trim();
    if (!trimmed) return { base: '', ext: '', error: '파일명 없음' };

    const lastDot = trimmed.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === trimmed.length - 1) {
        return { base: '', ext: '', error: '확장자가 없습니다' };
    }
    const rawBase = trimmed.slice(0, lastDot);
    const ext = trimmed.slice(lastDot + 1).toLowerCase();

    if (!ALLOWED_EXTS.has(ext)) {
        return { base: '', ext: '', error: `지원하지 않는 확장자: .${ext}` };
    }

    // 영문/숫자/._- 외 모든 문자 (한글, 공백 등) → '_'
    let base = rawBase.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
    if (!base) base = 'image';
    if (base.length > 64) base = base.slice(0, 64);
    if (!SAFE_BASE.test(base)) return { base: '', ext: '', error: '파일명 처리 실패' };

    return { base, ext };
}

function bytesToBase64(bytes: Uint8Array): string {
    // 큰 파일은 spread 가 stack overflow 위험 — chunk 단위 처리
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    return btoa(bin);
}

function encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
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
function serverError(msg: string): Response {
    return new Response(msg, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
