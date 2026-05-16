// POST /api/rollback
// body: { site, targetSha, currentSha, targetDate }
// targetSha 시점의 index.html 내용을 현재 HEAD에 새 commit으로 적용 (force push 없이 history 보존)

interface Env {
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
    GITHUB_BRANCH: string;
}

interface RollbackBody {
    site?: unknown;
    targetSha?: unknown;
    currentSha?: unknown;
    targetDate?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return new Response('missing GitHub config', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    let body: RollbackBody;
    try {
        body = await request.json();
    } catch {
        return new Response('invalid JSON body', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const site = typeof body.site === 'string' && /^[A-Za-z0-9_-]+$/.test(body.site) ? body.site : null;
    if (!site) return new Response('invalid site', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    const targetSha = typeof body.targetSha === 'string' && /^[0-9a-f]{7,40}$/i.test(body.targetSha) ? body.targetSha : null;
    if (!targetSha) return new Response('invalid targetSha', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    const currentSha = typeof body.currentSha === 'string' ? body.currentSha.trim() : '';
    if (!currentSha) return new Response('currentSha required', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    const targetDate = typeof body.targetDate === 'string' ? body.targetDate : targetSha.slice(0, 7);

    const branch = env.GITHUB_BRANCH || 'main';
    const filePath = `${site}-landing/index.html`;
    const ghHeaders = githubHeaders(env.GITHUB_TOKEN);

    // 1. targetSha 시점의 파일 내용 가져오기
    const getUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(targetSha)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders });

    if (!getRes.ok) {
        const errText = await getRes.text();
        return new Response(`GitHub GET error: ${getRes.status}\n${errText}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    const fileData = await getRes.json() as { content?: string };
    // GitHub Contents API가 반환하는 base64 content (줄바꿈 포함) — PUT 시 줄바꿈 제거
    const contentB64 = (fileData.content || '').replace(/\n/g, '');

    // 2. 현재 HEAD에 새 commit으로 적용
    const commitMessage = `revert(content): ${site} 랜딩을 ${targetDate} 버전으로 되돌림 via admin`;
    const putUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;

    const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage, content: contentB64, sha: currentSha, branch }),
    });

    if (putRes.ok) {
        const data = await putRes.json() as {
            content?: { sha?: string };
            commit?: { sha?: string };
        };
        return Response.json({
            ok: true,
            sha: data.content?.sha,
            commitSha: data.commit?.sha,
        }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const errText = await putRes.text();
    if (putRes.status === 409 || (putRes.status === 422 && /sha|does not match|expected/i.test(errText))) {
        return Response.json({
            error: 'sha_conflict',
            message: '다른 곳에서 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요.',
        }, { status: 409 });
    }

    return new Response(`GitHub PUT error: ${putRes.status}\n${errText}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
};

function githubHeaders(token: string): HeadersInit {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mujin-admin',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}
