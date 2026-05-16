// POST /api/logout — 세션 쿠키 삭제

const COOKIE_NAME = 'mujin_session';

export const onRequestPost: PagesFunction = async () => {
    const clearCookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
    return Response.json({ ok: true }, {
        headers: {
            'Set-Cookie': clearCookie,
            'Cache-Control': 'no-store',
        },
    });
};
