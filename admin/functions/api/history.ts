// GET /api/history?site=mujinmoolsan
// {site}-landing/index.html 의 최근 commit 5개 반환

interface Env {
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
    GITHUB_BRANCH: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const url = new URL(request.url);
    const site = url.searchParams.get('site') || 'mujinmoolsan';

    if (!/^[A-Za-z0-9_-]+$/.test(site)) {
        return new Response('invalid site', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return new Response('missing GitHub config', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const branch = env.GITHUB_BRANCH || 'main';
    const filePath = `${site}-landing/index.html`;
    const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(branch)}&per_page=5`;

    const ghRes = await fetch(apiUrl, { headers: githubHeaders(env.GITHUB_TOKEN) });

    if (!ghRes.ok) {
        const body = await ghRes.text();
        return new Response(`GitHub API error: ${ghRes.status}\n${body}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    const commits = await ghRes.json() as Array<{
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
        html_url: string;
    }>;

    const result = commits.map(c => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date,
        url: c.html_url,
    }));

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
};

function githubHeaders(token: string): HeadersInit {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mujin-admin',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}
