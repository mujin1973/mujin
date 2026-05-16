// 무진 그룹사 콘텐츠 어드민 — 클라이언트 로직
// 동작 흐름: GET /api/file → DOMParser → 폼 자동 생성 → 미리보기 iframe → (저장은 다음 단계)

const SITE = 'mujinmoolsan';
const REPO = 'mujin1973/mujin';
const BRANCH = 'main';
const TARGET_PATH = `${SITE}-landing/index.html`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${SITE}-landing/`;

const SECTION_LABELS = {
    meta:       '메타 / SEO',
    about:      '기업소개',
    consulting: '컨설팅',
    onlineMall: '온라인몰',
    related:    '관계회사',
    footer:     '푸터',
    contact:    '연락처 (공통)',
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);

// 폼 컴포넌트 우선순위 — 같은 fieldName에 prefix가 여럿일 때 어느 것으로 폼을 그릴지
// (정보량이 큰 컴포넌트가 우선)
const PREFIX_PRIORITY = ['image', 'bgimage', 'tel', 'email', 'html', 'toggle', 'href', 'style', 'text'];

// style: prefix용 — fieldName의 마지막 segment에서 CSS property 추론
// 예: "onlineMall.ownMall.bgColor" → background-color, 폼은 컬러 피커
const STYLE_PROP_MAP = {
    bgColor:     { cssProp: 'background-color', input: 'color' },
    bgcolor:     { cssProp: 'background-color', input: 'color' },
    textColor:   { cssProp: 'color',            input: 'color' },
    color:       { cssProp: 'color',            input: 'color' },
    borderColor: { cssProp: 'border-color',     input: 'color' },
};

const FIELD_LABELS = {
    'meta.title':                '페이지 타이틀',
    'meta.description':          '메타 설명',
    'meta.keywords':             '키워드',
    'meta.ogImage':              'OG 이미지',
    'about.title':               '섹션 타이틀',
    'about.body1':               '본문 1단',
    'about.body2':               '본문 2단',
    'about.body3':               '본문 3단',
    'about.pull':                '인용구 (pull quote)',
    'about.badges':              '인증 및 협회 리스트',
    'consulting.bg':             '배경 이미지',
    'consulting.title':          '섹션 타이틀',
    'consulting.desc':           '설명',
    'onlineMall.title':          '섹션 타이틀',
    'onlineMall.ownMall':        '자체몰 버튼 표시',
    'onlineMall.ownMall.url':    '자체몰 URL',
    'onlineMall.ownMall.label':  '자체몰 라벨',
    'onlineMall.naver':          '네이버몰 버튼 표시',
    'onlineMall.naver.url':      '네이버몰 URL',
    'onlineMall.naver.label':    '네이버몰 라벨',
    'onlineMall.ownMall.bgColor':'자체몰 버튼 색상',
    'onlineMall.naver.bgColor':  '네이버몰 버튼 색상',
    'related.title':             '섹션 타이틀',
    'related.cards':             '관계회사 카드 리스트',
    'footer.company':            '회사명',
    'footer.ceo':                '대표자',
    'footer.bizNumber':          '사업자번호',
    'footer.address':            '주소',
    'contact.phone':             '전화번호',
    'contact.email':             '이메일',
    'contact.blogUrl':           '네이버 블로그 URL',
};

const FIELD_HINTS = {
    'meta.title':       '브라우저 탭과 구글·네이버 검색결과에 표시되는 페이지 제목입니다. 20~60자 권장.',
    'meta.description': '구글·네이버 검색결과에 나오는 설명 문구입니다. 70~160자 권장.',
    'meta.keywords':    '검색엔진에 전달할 키워드를 쉼표(,)로 구분해 입력하세요. 예: 무진물산, 수산물, 해양수산',
    'meta.ogImage':     '카카오톡·SNS 공유 시 자동으로 표시되는 대표 이미지입니다.',
};

// SEO 파일 정의
const SEO_FILES = [
    {
        path: `${SITE}-landing/robots.txt`,
        filename: 'robots.txt',
        hint: '검색엔진 크롤러에게 크롤링 허용 범위를 알려주는 파일입니다. 구글서치콘솔·네이버서치어드바이저 등록 시 필요합니다.',
        defaultContent: `User-agent: *\nAllow: /\nSitemap: https://mujin.im/sitemap.xml`,
    },
    {
        path: `${SITE}-landing/sitemap.xml`,
        filename: 'sitemap.xml',
        hint: '사이트 페이지 목록을 검색엔진에 알려주는 파일입니다. 구글서치콘솔에 제출하면 색인 속도가 빨라집니다.',
        defaultContent: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://mujin.im/</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>`,
    },
];

// HTML sanitize 화이트리스트 (html: prefix용)
const HTML_ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'BR']);

// ─────────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────────

const state = {
    doc: null,                  // 편집 중인 DOM (Document)
    rawHtml: '',                // 최초 로드된 HTML 문자열 (스크립트 블록 추출용)
    sha: null,                  // GitHub Contents API sha
    fields: new Map(),          // fieldName -> FieldEntry
    cardLists: new Map(),       // fieldName -> CardListEntry
    initialValues: new Map(),   // fieldName -> 최초 로드 시 raw 값 (dirty 비교 + 모달 before 표시용)
    appliedValues: new Map(),   // fieldName -> 미리보기에 반영된 raw 값 (pending 비교용)
    viewport: 'pc',
    saving: false,
    lastSavedAt: null,
    scripts: {
        head: { content: '', initial: '' },
        body: { content: '', initial: '' },
    },
    seoFiles: new Map(),        // path -> { content, sha, initial, saving, defaultContent }
};

function cloneValue(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ...v };
    return v;
}

// FieldEntry: { section, prefixes:Set, elements:[{el, prefix}], currentValue, formPrefix }

// ─────────────────────────────────────────────────────────────────
// 부트스트랩
// ─────────────────────────────────────────────────────────────────

async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
        window.location.replace('/login');
    }
}

async function bootstrap() {
    try {
        const res = await fetch(`/api/file/${TARGET_PATH}`, { credentials: 'same-origin' });
        if (res.status === 401) { window.location.replace('/login'); return; }
        if (!res.ok) throw new Error(`GET /api/file 실패: ${res.status}`);
        const { content, sha } = await res.json();

        state.sha = sha;
        state.rawHtml = content;
        state.doc = new DOMParser().parseFromString(content, 'text/html');

        // 스크립트 블록 초기값
        state.scripts.head.content = extractScriptBlock(content, 'head');
        state.scripts.head.initial = state.scripts.head.content;
        state.scripts.body.content = extractScriptBlock(content, 'body');
        state.scripts.body.initial = state.scripts.body.content;

        buildIndex();
        renderForm();
        renderPreview();
        updateStatus();

        bindGlobalControls();
        loadSeoFiles();
    } catch (err) {
        console.error(err);
        document.getElementById('form-panel-inner').innerHTML = `
            <div class="loading" style="color: var(--danger)">
                로드 실패: ${escapeHtml(err.message)}
            </div>`;
    }
}

// ─────────────────────────────────────────────────────────────────
// 카드 리스트 헬퍼
// ─────────────────────────────────────────────────────────────────

let _cardIdSeq = 0;
function newCardId() { return `card-${++_cardIdSeq}`; }

function extractCardFields(itemEl) {
    const fields = {};
    const els = itemEl.hasAttribute('data-edit-field')
        ? [itemEl, ...itemEl.querySelectorAll('[data-edit-field]')]
        : itemEl.querySelectorAll('[data-edit-field]');
    els.forEach(el => {
        const f = el.getAttribute('data-edit-field');
        if (f === 'img') {
            fields.img = { src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '' };
        }
    });
    return fields;
}

function cardsSignature(cards) {
    return JSON.stringify(cards.map(c => c.fields));
}

function applyCardListToDoc(field) {
    const entry = state.cardLists.get(field);
    if (!entry || !entry.template) return;
    const container = entry.container;
    // 기존 카드(data-edit-item)만 제거 — 비-카드 형제(badges-label 등)는 보존
    Array.from(container.querySelectorAll('[data-edit-item]')).forEach(el => el.remove());
    entry.currentCards.forEach(card => {
        const newEl = entry.template.cloneNode(true);
        const imgEl = newEl.getAttribute('data-edit-field') === 'img'
            ? newEl
            : newEl.querySelector('[data-edit-field="img"]');
        if (imgEl) {
            imgEl.setAttribute('src', card.fields.img?.src || '');
            imgEl.setAttribute('alt', card.fields.img?.alt || '');
        }
        container.appendChild(newEl);
    });
}

function cardListDirty(entry) {
    return cardsSignature(entry.currentCards) !== entry.initialSnapshot;
}
function cardListPending(entry) {
    return cardsSignature(entry.currentCards) !== entry.appliedSnapshot;
}

// ─────────────────────────────────────────────────────────────────
// 인덱스 빌드 — doc에서 data-edit* 속성 가진 요소들을 fieldName으로 그룹화
// ─────────────────────────────────────────────────────────────────

function buildIndex() {
    state.fields.clear();
    state.cardLists.clear();
    let order = 0;

    // 단일 쿼리로 doc order 순회 — 한 element가 data-edit + data-edit-href + data-edit-style 같이 가질 수 있음.
    // 폼이 랜딩페이지의 시각 순서와 매칭되도록 첫 등장 순서를 기록.
    state.doc.querySelectorAll('[data-edit], [data-edit-list], [data-edit-href], [data-edit-style]').forEach(el => {
        // data-edit-list="cards:fieldName"
        if (el.hasAttribute('data-edit-list')) {
            const raw = el.getAttribute('data-edit-list');
            const idx = raw.indexOf(':');
            if (idx !== -1) {
                const field = raw.slice(idx + 1);
                if (!state.cardLists.has(field)) {
                    const items = Array.from(el.querySelectorAll('[data-edit-item]'));
                    const template = items[0] ? items[0].cloneNode(true) : null;
                    const currentCards = items.map(it => ({
                        id: newCardId(),
                        fields: extractCardFields(it),
                    }));
                    const snapshot = cardsSignature(currentCards);
                    state.cardLists.set(field, {
                        order: order++,
                        container: el,
                        field,
                        section: sectionKeyOf(field),
                        template,
                        currentCards,
                        initialSnapshot: snapshot,
                        appliedSnapshot: snapshot,
                    });
                }
            }
        }
        // data-edit="prefix:fieldName"
        if (el.hasAttribute('data-edit')) {
            const raw = el.getAttribute('data-edit');
            const idx = raw.indexOf(':');
            if (idx !== -1) {
                const prefix = raw.slice(0, idx);
                const field = raw.slice(idx + 1);
                if (addFieldElement(field, el, prefix)) {
                    state.fields.get(field).order = order++;
                }
            }
        }
        // data-edit-href="fieldName" (toggle 동반)
        if (el.hasAttribute('data-edit-href')) {
            const field = el.getAttribute('data-edit-href');
            if (addFieldElement(field, el, 'href')) {
                state.fields.get(field).order = order++;
            }
        }
        // data-edit-style="fieldName" (inline style 일부 property 편집)
        if (el.hasAttribute('data-edit-style')) {
            const field = el.getAttribute('data-edit-style');
            if (addFieldElement(field, el, 'style')) {
                state.fields.get(field).order = order++;
            }
        }
    });

    // 각 fieldName의 formPrefix 결정 + 초기값 캐싱
    state.fields.forEach((entry, field) => {
        entry.formPrefix = chooseFormPrefix(entry);
        entry.currentValue = readValue(entry, field);
        state.initialValues.set(field, cloneValue(entry.currentValue));
        state.appliedValues.set(field, cloneValue(entry.currentValue));
    });
}

// 새 field entry 생성되면 true, 기존 entry에 prefix만 추가되면 false
function addFieldElement(field, el, prefix) {
    let entry = state.fields.get(field);
    const isNew = !entry;
    if (!entry) {
        entry = {
            order: 0,                       // 호출 측에서 새로 만들 때 채워줌
            section: sectionKeyOf(field),
            prefixes: new Set(),
            elements: [],
            currentValue: null,
            formPrefix: null,
        };
        state.fields.set(field, entry);
    }
    entry.prefixes.add(prefix);
    entry.elements.push({ el, prefix });
    return isNew;
}

function sectionKeyOf(field) {
    return field.split('.')[0];
}

function chooseFormPrefix(entry) {
    for (const p of PREFIX_PRIORITY) {
        if (entry.prefixes.has(p)) return p;
    }
    return 'text';
}

// ─────────────────────────────────────────────────────────────────
// 값 추출/적용 — prefix별 양방향 매핑
// ─────────────────────────────────────────────────────────────────

function readValue(entry, field) {
    const target = entry.elements.find(e => e.prefix === entry.formPrefix) || entry.elements[0];
    return extractFromElement(target.el, entry.formPrefix, field);
}

function extractFromElement(el, prefix, field) {
    switch (prefix) {
        case 'text':
            if (el.tagName === 'META') return el.getAttribute('content') || '';
            return (el.textContent || '').trim();
        case 'html':
            return htmlToTextarea(el.innerHTML);
        case 'image':
            if (el.tagName === 'META') return el.getAttribute('content') || '';
            return { src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '' };
        case 'bgimage':
            return extractBgUrl(el);
        case 'href':
            return el.getAttribute('href') || '';
        case 'tel':
            return (el.textContent || '').trim();
        case 'email':
            return (el.textContent || '').trim();
        case 'toggle':
            return !el.hasAttribute('hidden');
        case 'style': {
            const spec = styleSpecOf(field);
            return spec ? readInlineStyleProp(el, spec.cssProp) : '';
        }
        default:
            return '';
    }
}

// 동일 fieldName의 모든 element에 값을 prefix별 방식으로 일괄 적용
function applyValueToElements(field, value) {
    const entry = state.fields.get(field);
    entry.elements.forEach(({ el, prefix }) => {
        applyOneElement(el, prefix, value, field);
    });
}

function applyOneElement(el, prefix, value, field) {
    switch (prefix) {
        case 'text': {
            const v = typeof value === 'string' ? value : '';
            if (el.tagName === 'META') el.setAttribute('content', v);
            else el.textContent = v;
            break;
        }
        case 'html': {
            const v = typeof value === 'string' ? value : '';
            el.innerHTML = textareaToHtml(v);
            break;
        }
        case 'image': {
            if (el.tagName === 'META') {
                const v = typeof value === 'string' ? value : (value && value.src) || '';
                el.setAttribute('content', v);
            } else {
                const src = (value && value.src) || '';
                const alt = (value && typeof value.alt === 'string') ? value.alt : el.getAttribute('alt') || '';
                el.setAttribute('src', src);
                el.setAttribute('alt', alt);
            }
            break;
        }
        case 'bgimage': {
            const v = typeof value === 'string' ? value : '';
            const style = el.getAttribute('style') || '';
            const next = style.match(/background-image\s*:\s*url\([^)]+\)/i)
                ? style.replace(/background-image\s*:\s*url\([^)]+\)/i, `background-image: url('${v}')`)
                : (style ? `${style}; background-image: url('${v}')` : `background-image: url('${v}')`);
            el.setAttribute('style', next);
            break;
        }
        case 'href': {
            el.setAttribute('href', typeof value === 'string' ? value : '');
            break;
        }
        case 'tel': {
            const v = typeof value === 'string' ? value : '';
            el.textContent = v;
            el.setAttribute('href', 'tel:' + v.replace(/[^0-9+]/g, ''));
            break;
        }
        case 'email': {
            const v = typeof value === 'string' ? value : '';
            el.textContent = v;
            el.setAttribute('href', 'mailto:' + v);
            break;
        }
        case 'toggle': {
            if (value) el.removeAttribute('hidden');
            else el.setAttribute('hidden', '');
            break;
        }
        case 'style': {
            const spec = styleSpecOf(field);
            if (spec) writeInlineStyleProp(el, spec.cssProp, typeof value === 'string' ? value : '');
            break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// style: prefix 헬퍼 — inline style 의 특정 CSS property만 안전하게 읽고 쓰기
// (다른 inline style 선언은 보존)
// ─────────────────────────────────────────────────────────────────

function styleSpecOf(field) {
    const last = field.split('.').pop();
    return STYLE_PROP_MAP[last] || null;
}

function readInlineStyleProp(el, cssProp) {
    if (!cssProp) return '';
    const style = el.getAttribute('style') || '';
    const re = new RegExp(`(?:^|;)\\s*${escapeRegex(cssProp)}\\s*:\\s*([^;]+)`, 'i');
    const m = style.match(re);
    if (!m) {
        // background-color 를 다룰 때 background 단축형도 fallback 으로 인식
        if (cssProp === 'background-color') {
            const m2 = style.match(/(?:^|;)\s*background\s*:\s*([^;]+)/i);
            if (m2) return normalizeColor(m2[1].trim());
        }
        return '';
    }
    return normalizeColor(m[1].trim());
}

function writeInlineStyleProp(el, cssProp, value) {
    const style = el.getAttribute('style') || '';
    // 1) 기존 동일 property 제거 (전체 + 단축형 background까지)
    let stripped = style
        .replace(new RegExp(`(?:^|;)\\s*${escapeRegex(cssProp)}\\s*:\\s*[^;]+;?`, 'gi'), ';');
    if (cssProp === 'background-color') {
        stripped = stripped.replace(/(?:^|;)\s*background\s*:\s*[^;]+;?/gi, ';');
    }
    stripped = stripped.replace(/;+/g, ';').replace(/^;|;$/g, '').trim();

    // 2) 새 값 append
    const next = value
        ? (stripped ? `${stripped}; ${cssProp}: ${value}` : `${cssProp}: ${value}`)
        : stripped;
    if (next) el.setAttribute('style', next);
    else el.removeAttribute('style');
}

// "#FFF" → "#ffffff", "rgb(255,255,255)" → "#ffffff" 등으로 정규화 (input type=color 호환)
function normalizeColor(s) {
    s = String(s).trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return '#' + s.slice(1).split('').map(c => c + c).join('').toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    const m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toLowerCase();
    return s; // 색상 키워드 등은 그대로
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBgUrl(el) {
    const style = el.getAttribute('style') || '';
    const m = style.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    return m ? m[1] : '';
}

// html: prefix의 innerHTML ↔ textarea 문자열 변환
function htmlToTextarea(s) {
    return (s || '').replace(/<br\s*\/?>/gi, '\n').trim();
}
function textareaToHtml(s) {
    // 1) 입력값에서 화이트리스트 외 HTML 제거 (XSS 방지)
    // 2) \n → <br>
    const tmp = document.createElement('div');
    tmp.innerHTML = s.replace(/\n/g, '<br>');
    sanitizeInPlace(tmp);
    return tmp.innerHTML;
}
function sanitizeInPlace(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const toUnwrap = [];
    let node = walker.nextNode();
    while (node) {
        if (!HTML_ALLOWED_TAGS.has(node.tagName)) toUnwrap.push(node);
        // 허용 태그라도 속성은 모두 제거 (style, onclick 등 방어)
        else {
            Array.from(node.attributes).forEach(a => node.removeAttribute(a.name));
        }
        node = walker.nextNode();
    }
    toUnwrap.forEach(n => {
        const txt = document.createTextNode(n.textContent);
        n.replaceWith(txt);
    });
}

// dirty/pending 비교용 정규화 시그니처
function valueSignature(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

// ─────────────────────────────────────────────────────────────────
// 폼 렌더링
// ─────────────────────────────────────────────────────────────────

function renderForm() {
    const inner = document.getElementById('form-panel-inner');
    inner.innerHTML = '';

    // 섹션 → [fields] 매핑
    const sectionFields = new Map();
    const sectionCardLists = new Map();
    state.fields.forEach((entry, field) => {
        if (!sectionFields.has(entry.section)) sectionFields.set(entry.section, []);
        sectionFields.get(entry.section).push(field);
    });
    state.cardLists.forEach((entry, field) => {
        if (!sectionCardLists.has(entry.section)) sectionCardLists.set(entry.section, []);
        sectionCardLists.get(entry.section).push(field);
    });

    SECTION_ORDER.forEach(sectionKey => {
        if (!sectionFields.has(sectionKey) && !sectionCardLists.has(sectionKey)) return;
        const section = renderSection(
            sectionKey,
            sectionFields.get(sectionKey) || [],
            sectionCardLists.get(sectionKey) || [],
        );
        inner.appendChild(section);
    });

    inner.appendChild(renderScriptsSection());
    inner.appendChild(renderSeoFilesSection());
    inner.appendChild(renderAdminFooter());
}

function renderAdminFooter() {
    const el = document.createElement('div');
    el.className = 'admin-footer';
    el.innerHTML = `
        <a class="btn btn-ghost btn-sm admin-pw-btn"
           href="https://dash.cloudflare.com/0130cd9f8e16ebee893cbb47d8af7c0e/pages/view/mujin-admin/settings/production"
           target="_blank" rel="noopener noreferrer"
           title="Cloudflare Pages 설정에서 비밀번호를 변경합니다">
            🔐 어드민 비밀번호 변경 ↗
        </a>
        <a class="admin-manual-link" href="/manual" target="_blank" rel="noopener noreferrer">사용 매뉴얼 ↗</a>
    `;
    return el;
}

function renderSection(sectionKey, fields, cardListFields) {
    const isMeta = sectionKey === 'meta';

    const section = document.createElement('section');
    section.className = 'edit-section';
    section.dataset.section = sectionKey;
    if (isMeta) section.classList.add('is-collapsed');

    const header = document.createElement('header');
    header.className = 'edit-section-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    titleRow.innerHTML = `
        <span class="section-chevron">${isMeta ? '▸' : '▾'}</span>
        <h2>${SECTION_LABELS[sectionKey] || sectionKey}</h2>
    `;
    header.appendChild(titleRow);

    if (!isMeta) {
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-ghost btn-sm section-apply';
        applyBtn.textContent = '미리보기 적용';
        applyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            applySectionToPreview(sectionKey);
        });
        header.appendChild(applyBtn);
    }

    header.style.cursor = 'pointer';
    header.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return;
        section.classList.toggle('is-collapsed');
        const chevron = header.querySelector('.section-chevron');
        if (chevron) chevron.textContent = section.classList.contains('is-collapsed') ? '▸' : '▾';
    });

    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'edit-section-body';

    // doc order로 정렬 — 일반 필드와 카드 리스트를 한 배열에 섞어 정렬 (랜딩 시각 순서 매칭)
    const items = [
        ...fields.map(f => ({ kind: 'field', field: f, order: state.fields.get(f).order })),
        ...cardListFields.map(f => ({ kind: 'card',  field: f, order: state.cardLists.get(f).order })),
    ];
    items.sort((a, b) => a.order - b.order);
    items.forEach(it => {
        if (it.kind === 'field') body.appendChild(renderField(it.field));
        else                     body.appendChild(renderCardList(it.field));
    });

    section.appendChild(body);

    return section;
}

function renderField(field) {
    const entry = state.fields.get(field);
    const prefix = entry.formPrefix;

    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.field = field;

    const label = document.createElement('label');
    label.className = 'field-label';
    label.innerHTML = `
        <span>${escapeHtml(FIELD_LABELS[field] || field)}</span>
        <span class="prefix-tag">${prefix}</span>
        ${entry.elements.length > 1 ? `<span class="sync-badge">${entry.elements.length}곳 동기화</span>` : ''}
        <span class="field-flags"></span>
    `;
    wrap.appendChild(label);

    const hint = FIELD_HINTS[field];
    if (hint) {
        const hintEl = document.createElement('p');
        hintEl.className = 'field-hint';
        hintEl.textContent = hint;
        wrap.appendChild(hintEl);
    }

    const inputEl = createInputForPrefix(field, prefix, entry.currentValue);
    wrap.appendChild(inputEl);

    return wrap;
}

function createInputForPrefix(field, prefix, value) {
    switch (prefix) {
        case 'text': {
            const ta = document.createElement('textarea');
            ta.rows = 1;
            ta.value = typeof value === 'string' ? value : '';
            autoGrow(ta);
            ta.addEventListener('input', () => {
                onFieldInput(field, ta.value);
                autoGrow(ta);
            });
            return ta;
        }
        case 'html': {
            const ta = document.createElement('textarea');
            ta.className = 'html-input';
            ta.rows = 3;
            ta.value = typeof value === 'string' ? value : '';
            autoGrow(ta);
            ta.addEventListener('input', () => {
                onFieldInput(field, ta.value);
                autoGrow(ta);
            });
            return ta;
        }
        case 'tel':
        case 'email':
        case 'href': {
            const input = document.createElement('input');
            input.type = prefix === 'tel' ? 'tel' : prefix === 'email' ? 'email' : 'url';
            input.value = typeof value === 'string' ? value : '';
            input.addEventListener('input', () => onFieldInput(field, input.value));
            return input;
        }
        case 'toggle': {
            const row = document.createElement('div');
            row.className = 'toggle-row';
            const lbl = document.createElement('label');
            lbl.className = 'toggle';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!value;
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';
            lbl.appendChild(cb);
            lbl.appendChild(slider);
            const txt = document.createElement('span');
            txt.className = 'toggle-label';
            txt.textContent = cb.checked ? '표시' : '숨김';
            cb.addEventListener('change', () => {
                txt.textContent = cb.checked ? '표시' : '숨김';
                onFieldInput(field, cb.checked);
            });
            row.appendChild(lbl);
            row.appendChild(txt);
            return row;
        }
        case 'image': {
            const wrap = document.createElement('div');
            wrap.className = 'image-field';

            const v = (value && typeof value === 'object') ? value : { src: typeof value === 'string' ? value : '', alt: '' };
            const current = document.createElement('div');
            current.className = 'image-current';
            const thumb = document.createElement('div');
            thumb.className = 'image-thumb';
            thumb.style.backgroundImage = `url('${resolveAssetUrl(v.src)}')`;
            const meta = document.createElement('div');
            meta.className = 'image-meta';
            meta.textContent = v.src || '(이미지 없음)';
            current.appendChild(thumb);
            current.appendChild(meta);
            wrap.appendChild(current);

            // alt 입력 (image: prefix가 meta가 아닌 일반 img일 때만)
            const isMeta = state.fields.get(field).elements.every(({ el }) => el.tagName === 'META');
            if (!isMeta) {
                const altInput = document.createElement('input');
                altInput.type = 'text';
                altInput.placeholder = '대체 텍스트 (alt)';
                altInput.value = v.alt || '';
                altInput.addEventListener('input', () => {
                    const curr = state.fields.get(field).currentValue || { src: '', alt: '' };
                    // alt 는 일반 텍스트 입력 — "미리보기 적용" 버튼으로 반영 (PLAN §5.2 의 즉시 반영 예외는 업로드 자체에만 적용)
                    onFieldInput(field, { src: curr.src || '', alt: altInput.value });
                });
                wrap.appendChild(altInput);
            }

            wrap.appendChild(buildUploader(field, {
                onUploaded: ({ path }) => {
                    const curr = state.fields.get(field).currentValue || { src: '', alt: '' };
                    const next = { src: path, alt: (curr && curr.alt) || '' };
                    applyImageValue(field, next);
                    // 폼 thumbnail/meta 도 즉시 갱신
                    thumb.style.backgroundImage = `url('${resolveAssetUrl(path)}')`;
                    meta.textContent = path;
                },
            }));

            return wrap;
        }
        case 'style': {
            const spec = styleSpecOf(field);
            if (!spec || spec.input !== 'color') {
                const span = document.createElement('div');
                span.className = 'muted';
                span.textContent = `(style: ${field} — 지원되지 않는 형식)`;
                return span;
            }
            const wrap = document.createElement('div');
            wrap.className = 'color-field';
            const initial = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#000000';
            const swatch = document.createElement('input');
            swatch.type = 'color';
            swatch.value = initial;
            swatch.className = 'color-swatch';
            const hex = document.createElement('input');
            hex.type = 'text';
            hex.placeholder = '#RRGGBB';
            hex.value = initial;
            hex.className = 'color-hex';
            hex.maxLength = 7;
            wrap.appendChild(swatch);
            wrap.appendChild(hex);

            const commit = (v) => {
                if (!/^#[0-9a-f]{6}$/i.test(v)) return; // 미완 입력은 무시
                const lower = v.toLowerCase();
                if (swatch.value !== lower) swatch.value = lower;
                if (hex.value.toLowerCase() !== lower) hex.value = lower;
                onFieldInput(field, lower);
            };
            swatch.addEventListener('input', () => commit(swatch.value));
            hex.addEventListener('input', () => {
                let v = hex.value.trim();
                if (v && !v.startsWith('#')) v = '#' + v;
                if (/^#[0-9a-f]{6}$/i.test(v)) commit(v);
            });
            return wrap;
        }
        case 'bgimage': {
            const wrap = document.createElement('div');
            wrap.className = 'image-field';
            const current = document.createElement('div');
            current.className = 'image-current';
            const thumb = document.createElement('div');
            thumb.className = 'image-thumb';
            const src = typeof value === 'string' ? value : '';
            thumb.style.backgroundImage = `url('${resolveAssetUrl(src)}')`;
            const meta = document.createElement('div');
            meta.className = 'image-meta';
            meta.textContent = src || '(이미지 없음)';
            current.appendChild(thumb);
            current.appendChild(meta);
            wrap.appendChild(current);

            wrap.appendChild(buildUploader(field, {
                onUploaded: ({ path }) => {
                    applyImageValue(field, path);
                    thumb.style.backgroundImage = `url('${resolveAssetUrl(path)}')`;
                    meta.textContent = path;
                },
            }));

            return wrap;
        }
        default: {
            const span = document.createElement('div');
            span.className = 'muted';
            span.textContent = `(미지원 prefix: ${prefix})`;
            return span;
        }
    }
}

function renderCardList(field) {
    const entry = state.cardLists.get(field);

    const wrap = document.createElement('div');
    wrap.className = 'card-list';
    wrap.dataset.field = field;

    // 헤더
    const header = document.createElement('div');
    header.className = 'card-list-header';
    header.innerHTML = `
        <span class="card-list-label">${escapeHtml(FIELD_LABELS[field] || field)}</span>
        <span class="card-count">${entry.currentCards.length}개</span>
        <span class="card-list-flags"></span>
    `;
    wrap.appendChild(header);

    // 아이템 컨테이너 (SortableJS 대상)
    const list = document.createElement('div');
    list.className = 'card-list-items';
    entry.currentCards.forEach(card => list.appendChild(renderCardItem(field, card, list)));
    wrap.appendChild(list);

    // SortableJS 드래그앤드롭
    if (typeof Sortable !== 'undefined') {
        new Sortable(list, {
            animation: 150,
            handle: '.card-drag-handle',
            ghostClass: 'card-ghost',
            onEnd: () => {
                // DOM 순서 → currentCards 재정렬
                const ids = Array.from(list.querySelectorAll('[data-card-id]')).map(el => el.dataset.cardId);
                entry.currentCards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
                onCardListChanged(field);
            },
        });
    }

    // 카드 추가 버튼
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost btn-sm card-add-btn';
    addBtn.textContent = '+ 카드 추가';
    addBtn.addEventListener('click', () => addCard(field, list));
    wrap.appendChild(addBtn);

    return wrap;
}

function renderCardItem(field, card, listEl) {
    const entry = state.cardLists.get(field);
    const item = document.createElement('div');
    item.className = 'card-item';
    item.dataset.cardId = card.id;

    // 드래그 핸들
    const handle = document.createElement('div');
    handle.className = 'card-drag-handle';
    handle.setAttribute('title', '드래그해서 순서 변경');
    handle.innerHTML = '<span>⠿</span>';
    item.appendChild(handle);

    // 썸네일
    const thumb = document.createElement('div');
    thumb.className = 'image-thumb card-thumb';
    thumb.style.backgroundImage = `url('${resolveAssetUrl(card.fields.img?.src || '')}')`;
    item.appendChild(thumb);

    // 입력 영역
    const inputs = document.createElement('div');
    inputs.className = 'card-inputs';

    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.placeholder = '대체 텍스트 (alt)';
    altInput.value = card.fields.img?.alt || '';
    altInput.addEventListener('input', () => {
        if (!card.fields.img) card.fields.img = { src: '', alt: '' };
        card.fields.img.alt = altInput.value;
        onCardListChanged(field);
    });
    inputs.appendChild(altInput);

    inputs.appendChild(buildUploader(field + ':' + card.id, {
        onUploaded: ({ path }) => {
            if (!card.fields.img) card.fields.img = { src: '', alt: altInput.value };
            card.fields.img.src = path;
            thumb.style.backgroundImage = `url('${resolveAssetUrl(path)}')`;
            // 이미지 업로드는 즉시 미리보기 반영 (PLAN §5.2)
            onCardListChanged(field);
            applyCardListImmediate(field);
        },
    }));

    item.appendChild(inputs);

    // 삭제 버튼
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'card-delete-btn';
    deleteBtn.setAttribute('title', '카드 삭제');
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => deleteCard(field, card.id, item));
    item.appendChild(deleteBtn);

    return item;
}

function addCard(field, listEl) {
    const entry = state.cardLists.get(field);
    const newCard = { id: newCardId(), fields: { img: { src: '', alt: '' } } };
    entry.currentCards.push(newCard);
    listEl.appendChild(renderCardItem(field, newCard, listEl));
    updateCardListFlags(field);
    updateStatus();
}

function deleteCard(field, cardId, itemEl) {
    const entry = state.cardLists.get(field);
    if (entry.currentCards.length <= 1) {
        if (!confirm('마지막 카드입니다. 정말 삭제하시겠습니까?')) return;
    }
    entry.currentCards = entry.currentCards.filter(c => c.id !== cardId);
    itemEl.remove();
    updateCardListFlags(field);
    updateStatus();
}

function onCardListChanged(field) {
    updateCardListFlags(field);
    updateStatus();
}

function updateCardListFlags(field) {
    const entry = state.cardLists.get(field);
    if (!entry) return;
    const wrap = document.querySelector(`.card-list[data-field="${attrValEscape(field)}"]`);
    if (!wrap) return;

    const flagsEl = wrap.querySelector('.card-list-flags');
    if (flagsEl) {
        const dirty   = cardListDirty(entry);
        const pending = cardListPending(entry);
        flagsEl.innerHTML = '';
        if (pending) flagsEl.innerHTML += '<span class="flag flag-pending">미반영</span>';
        if (dirty)   flagsEl.innerHTML += '<span class="flag flag-dirty">변경됨</span>';
    }
    const countEl = wrap.querySelector('.card-count');
    if (countEl) countEl.textContent = `${entry.currentCards.length}개`;
}

function applyCardListImmediate(field) {
    const entry = state.cardLists.get(field);
    applyCardListToDoc(field);
    entry.appliedSnapshot = cardsSignature(entry.currentCards);
    renderPreview();
    updateCardListFlags(field);
    updateStatus();
}

function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px';
}

// ─────────────────────────────────────────────────────────────────
// 입력 핸들러
// ─────────────────────────────────────────────────────────────────

function onFieldInput(field, value) {
    const entry = state.fields.get(field);
    entry.currentValue = value;

    // dirty/pending 플래그 갱신
    const fieldEl = document.querySelector(`.field[data-field="${attrValEscape(field)}"]`);
    if (fieldEl) {
        updateFieldFlags(fieldEl, field);
    }
    updateStatus();
}

function updateFieldFlags(fieldEl, field) {
    const entry = state.fields.get(field);
    const flagsEl = fieldEl.querySelector('.field-flags');
    if (!flagsEl) return;
    const sig = valueSignature(entry.currentValue);
    const isDirty = sig !== valueSignature(state.initialValues.get(field));
    const isPending = sig !== valueSignature(state.appliedValues.get(field));
    flagsEl.innerHTML = '';
    if (isPending) flagsEl.innerHTML += '<span class="flag flag-pending">미반영</span>';
    if (isDirty)   flagsEl.innerHTML += '<span class="flag flag-dirty">변경됨</span>';
}

// ─────────────────────────────────────────────────────────────────
// 이미지 업로더 (image: / bgimage: prefix 공용)
// ─────────────────────────────────────────────────────────────────

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

// PLAN §5.2 — 이미지는 "미리보기 적용" 버튼 없이 즉시 반영. 한 곳에서 처리하기 위한 헬퍼.
// state.doc 의 img.src 에는 상대경로(path)가 들어가고, 미리보기는 rewriteAssetUrls 가
// 자동으로 RAW_BASE 를 prefix 로 붙여 raw URL 로 표시.
function applyImageValue(field, value) {
    onFieldInput(field, value);
    applyValueToElements(field, value);
    state.appliedValues.set(field, cloneValue(value));
    renderPreview();
    refreshAllFieldFlags();
    updateStatus();
}

function buildUploader(field, { onUploaded }) {
    const box = document.createElement('div');
    box.className = 'uploader';
    box.innerHTML = `
        <div class="uploader-drop" tabindex="0">
            <div class="uploader-drop-main">이미지 파일을 끌어다 놓거나 <span class="uploader-link">클릭해서 선택</span></div>
            <div class="uploader-drop-sub">JPG · PNG · GIF · WEBP · SVG · 최대 5MB</div>
        </div>
        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml" hidden>
        <div class="uploader-status" hidden></div>
    `;
    const drop = box.querySelector('.uploader-drop');
    const fileInput = box.querySelector('input[type="file"]');
    const status = box.querySelector('.uploader-status');

    const showStatus = (msg, kind = 'info') => {
        status.hidden = false;
        status.className = `uploader-status uploader-status-${kind}`;
        status.textContent = msg;
    };
    const clearStatus = () => {
        status.hidden = true;
        status.textContent = '';
    };

    const handleFile = async (file) => {
        const validation = validateImageFile(file);
        if (validation.error) {
            showStatus(validation.error, 'error');
            return;
        }

        drop.classList.add('is-loading');
        showStatus(`업로드 중… ${file.name} (${formatBytes(file.size)})`, 'info');

        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('site', SITE);
            const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(text || `업로드 실패 (${res.status})`);
            }
            const data = await res.json();
            if (!data || !data.path) throw new Error('응답에 path 가 없습니다');

            showStatus(`업로드 완료: ${data.path}`, 'ok');
            onUploaded(data);
            toast('이미지 업로드 완료 — 미리보기 반영됨');
        } catch (err) {
            console.error(err);
            showStatus(`업로드 실패: ${err.message || err}`, 'error');
        } finally {
            drop.classList.remove('is-loading');
            fileInput.value = ''; // 같은 파일 재선택 가능하도록 reset
        }
    };

    // 클릭 → 파일 선택
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    // 드래그앤드롭
    ['dragenter', 'dragover'].forEach(ev => {
        drop.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.add('is-dragover');
        });
    });
    ['dragleave', 'dragend', 'drop'].forEach(ev => {
        drop.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.remove('is-dragover');
        });
    });
    drop.addEventListener('drop', (e) => {
        clearStatus();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
    });

    return box;
}

function validateImageFile(file) {
    if (!file) return { error: '파일이 없습니다' };
    const name = file.name || '';
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
        return { error: `지원하지 않는 확장자: ${ext || '(없음)'}` };
    }
    if (file.size === 0) return { error: '빈 파일입니다' };
    if (file.size > UPLOAD_MAX_BYTES) {
        return { error: `파일이 너무 큽니다 (${formatBytes(file.size)} > 5MB)` };
    }
    return {};
}

function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

// ─────────────────────────────────────────────────────────────────
// 미리보기 (iframe srcdoc)
// ─────────────────────────────────────────────────────────────────

function applySectionToPreview(sectionKey) {
    let count = 0;
    state.fields.forEach((entry, field) => {
        if (entry.section !== sectionKey) return;
        if (valueSignature(entry.currentValue) === valueSignature(state.appliedValues.get(field))) return;
        applyValueToElements(field, entry.currentValue);
        state.appliedValues.set(field, cloneValue(entry.currentValue));
        count++;
    });
    state.cardLists.forEach((entry, field) => {
        if (entry.section !== sectionKey) return;
        if (!cardListPending(entry)) return;
        applyCardListToDoc(field);
        entry.appliedSnapshot = cardsSignature(entry.currentCards);
        count++;
    });
    renderPreview();
    refreshAllFieldFlags();
    updateStatus();
    if (count > 0) toast(`${SECTION_LABELS[sectionKey] || sectionKey}: ${count}개 항목 미리보기 반영`);
    else toast(`${SECTION_LABELS[sectionKey] || sectionKey}: 반영할 변경 없음`);

    // 미리보기에서 해당 섹션으로 스크롤 (best-effort — sectionKey가 anchor id와 매칭되면)
    requestAnimationFrame(() => scrollPreviewToSection(sectionKey));
}

function applyAllToPreview() {
    let count = 0;
    state.fields.forEach((entry, field) => {
        if (valueSignature(entry.currentValue) === valueSignature(state.appliedValues.get(field))) return;
        applyValueToElements(field, entry.currentValue);
        state.appliedValues.set(field, cloneValue(entry.currentValue));
        count++;
    });
    state.cardLists.forEach((entry, field) => {
        if (!cardListPending(entry)) return;
        applyCardListToDoc(field);
        entry.appliedSnapshot = cardsSignature(entry.currentCards);
        count++;
    });
    renderPreview();
    refreshAllFieldFlags();
    updateStatus();
    toast(count > 0 ? `${count}개 항목 미리보기 반영` : '반영할 변경 없음');
}

function refreshAllFieldFlags() {
    document.querySelectorAll('.field[data-field]').forEach(el => {
        updateFieldFlags(el, el.dataset.field);
    });
    state.cardLists.forEach((_, field) => updateCardListFlags(field));
}

function renderPreview() {
    const iframe = document.getElementById('preview-iframe');
    const clone = state.doc.cloneNode(true);
    rewriteAssetUrls(clone);

    // srcdoc 교체 시 스크롤이 (0,0)으로 리셋되는 문제 — 직전 위치 캡처 후 새 문서 load 시점에 복원.
    let savedScroll = null;
    try {
        const win = iframe.contentWindow;
        if (win) savedScroll = { x: win.scrollX || 0, y: win.scrollY || 0 };
    } catch (_) { /* same-origin 차단 시 무시 */ }

    if (savedScroll) {
        const restore = () => {
            try { iframe.contentWindow.scrollTo(savedScroll.x, savedScroll.y); } catch (_) {}
        };
        iframe.addEventListener('load', function once() {
            iframe.removeEventListener('load', once);
            restore();
            // 레이아웃이 비동기적으로 완성되는 케이스(폰트/이미지) 대비 한 프레임 더 보정
            requestAnimationFrame(restore);
        });
    }

    iframe.srcdoc = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
}

// 미리보기 iframe 안에서 상대 경로 (images/, vedio/) 가 깨지지 않도록 RAW_BASE로 치환.
// 원본 state.doc은 건드리지 않음 (저장은 상대경로 그대로).
function rewriteAssetUrls(doc) {
    const isAbsolute = (u) => /^(https?:|data:|blob:|\/\/|\/|mailto:|tel:|#)/i.test(u || '');

    doc.querySelectorAll('img[src], source[src], video[src], video[poster], audio[src]').forEach(el => {
        ['src', 'poster'].forEach(attr => {
            if (!el.hasAttribute(attr)) return;
            const v = el.getAttribute(attr);
            if (v && !isAbsolute(v)) el.setAttribute(attr, RAW_BASE + v);
        });
    });
    doc.querySelectorAll('[style*="url("]').forEach(el => {
        const style = el.getAttribute('style') || '';
        const replaced = style.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, q, url) => {
            if (isAbsolute(url)) return match;
            return `url(${q}${RAW_BASE + url}${q})`;
        });
        if (replaced !== style) el.setAttribute('style', replaced);
    });
}

function resolveAssetUrl(src) {
    if (!src) return '';
    if (/^(https?:|data:|\/\/|\/)/.test(src)) return src;
    return RAW_BASE + src;
}

function scrollPreviewToSection(sectionKey) {
    const iframe = document.getElementById('preview-iframe');
    try {
        const win = iframe.contentWindow;
        if (!win || !win.document) return;
        const anchor = win.document.getElementById(sectionKey) || win.document.querySelector(`[data-section="${sectionKey}"]`);
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) { /* same-origin sandbox blocks: ignore */ }
}

// ─────────────────────────────────────────────────────────────────
// 상단바 상태/컨트롤
// ─────────────────────────────────────────────────────────────────

function updateStatus() {
    let dirtyCount = 0, pendingCount = 0;
    state.fields.forEach((entry, field) => {
        const sig = valueSignature(entry.currentValue);
        if (sig !== valueSignature(state.initialValues.get(field))) dirtyCount++;
        if (sig !== valueSignature(state.appliedValues.get(field))) pendingCount++;
    });
    state.cardLists.forEach(entry => {
        if (cardListDirty(entry))   dirtyCount++;
        if (cardListPending(entry)) pendingCount++;
    });
    if (state.scripts.head.content !== state.scripts.head.initial) dirtyCount++;
    if (state.scripts.body.content !== state.scripts.body.initial) dirtyCount++;

    const dirtyEl = document.getElementById('status-dirty');
    const pendingEl = document.getElementById('status-pending');
    dirtyEl.textContent = `변경 ${dirtyCount}`;
    pendingEl.textContent = `미반영 ${pendingCount}`;
    dirtyEl.classList.toggle('has-changes', dirtyCount > 0);
    pendingEl.classList.toggle('has-pending', pendingCount > 0);

    const saveBtn = document.getElementById('save-all');
    saveBtn.disabled = state.saving || dirtyCount === 0;
    saveBtn.textContent = state.saving ? '저장 중…' : '저장';

    const savedEl = document.getElementById('status-saved');
    if (state.lastSavedAt && savedEl) {
        savedEl.hidden = false;
        savedEl.textContent = `마지막 저장: ${formatTime(state.lastSavedAt)}`;
    }
}

function formatTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────
// 변경 추적 — initialValues vs currentValue 비교 (저장 모달 표시용)
// ─────────────────────────────────────────────────────────────────

function getChangedFields() {
    const changes = [];
    state.fields.forEach((entry, field) => {
        const initial = state.initialValues.get(field);
        const current = entry.currentValue;
        if (valueSignature(initial) === valueSignature(current)) return;
        changes.push({
            field,
            label: FIELD_LABELS[field] || field,
            prefix: entry.formPrefix,
            before: initial,
            after: current,
            order: entry.order ?? 0,
        });
    });
    state.cardLists.forEach((entry, field) => {
        if (!cardListDirty(entry)) return;
        changes.push({
            field,
            label: FIELD_LABELS[field] || field,
            prefix: 'cards',
            cardListEntry: entry,
            order: entry.order ?? 0,
        });
    });
    if (state.scripts.head.content !== state.scripts.head.initial) {
        changes.push({ field: '_scripts.head', label: 'HEAD 스크립트', prefix: 'rawscript', order: 9000 });
    }
    if (state.scripts.body.content !== state.scripts.body.initial) {
        changes.push({ field: '_scripts.body', label: 'BODY 스크립트', prefix: 'rawscript', order: 9001 });
    }

    changes.sort((a, b) => a.order - b.order);
    return changes;
}

// prefix별 변경 표기 — 모달 "이번에 바뀐 항목" 리스트에서 사용
function describeChange({ label, prefix, before, after, cardListEntry }) {
    switch (prefix) {
        case 'cards': {
            const entry = cardListEntry;
            const initialFields = JSON.parse(entry.initialSnapshot);
            const currentFields = entry.currentCards.map(c => c.fields);
            const iCount = initialFields.length;
            const cCount = currentFields.length;
            if (iCount !== cCount) return `${label}: ${iCount}개 → ${cCount}개`;
            // 개수 같을 때 — 순서 변경 vs 내용 수정 판별
            const initSrcs = initialFields.map(f => f.img?.src || '').sort().join(',');
            const currSrcs = currentFields.map(f => f.img?.src || '').sort().join(',');
            if (initSrcs === currSrcs) return `${label}: 순서 변경`;
            return `${label}: 내용 수정`;
        }
        case 'toggle': {
            return `${label}: ${before ? '표시' : '숨김'} → ${after ? '표시' : '숨김'}`;
        }
        case 'style': {
            const b = String(before || '(없음)');
            const a = String(after || '(없음)');
            return `${label}: ${b} → ${a}`;
        }
        case 'image': {
            const b = (before && typeof before === 'object') ? before : { src: String(before || ''), alt: '' };
            const a = (after && typeof after === 'object')   ? after  : { src: String(after  || ''), alt: '' };
            const srcChanged = (b.src || '') !== (a.src || '');
            const altChanged = (b.alt || '') !== (a.alt || '');
            if (srcChanged && altChanged) return `${label}: 이미지 + 대체텍스트 수정`;
            if (srcChanged) return `${label}: 이미지 교체`;
            if (altChanged) return `${label}: 대체텍스트 수정`;
            return `${label}: 수정`;
        }
        case 'bgimage':
            return `${label}: 배경 이미지 교체`;
        case 'html':
            return `${label}: 본문 수정`;
        case 'text':
        case 'tel':
        case 'email':
        case 'href': {
            const b = String(before || '');
            const a = String(after  || '');
            const MAX = 40;
            if (b.length > MAX || a.length > MAX) return `${label}: 수정`;
            return `${label}: "${b}" → "${a}"`;
        }
        case 'rawscript':
            return `${label}: 수정됨`;
        default:
            return `${label}: 수정`;
    }
}

// ─────────────────────────────────────────────────────────────────
// 저장 모달 — 사용자가 Summary(필수) / Description(선택) 직접 입력
// ─────────────────────────────────────────────────────────────────

function openSaveModal(changes) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                <header class="modal-header">
                    <h2 id="modal-title">변경사항 저장</h2>
                    <button type="button" class="modal-close" aria-label="닫기" data-action="cancel">×</button>
                </header>
                <div class="modal-body">
                    <section class="modal-section">
                        <h3>이번에 바뀐 항목 (${changes.length}개)</h3>
                        <ul class="change-list">
                            ${changes.map(c => `<li>${escapeHtml(describeChange(c))}</li>`).join('')}
                        </ul>
                    </section>
                    <section class="modal-section">
                        <label for="commit-summary">Summary <span class="req">*</span></label>
                        <input id="commit-summary" type="text" maxlength="120" placeholder="예: about 본문 문구 수정" autocomplete="off">
                        <p class="modal-hint">한 줄, 72자 이내 권장. 무엇을 바꿨는지 짧게.</p>
                    </section>
                    <section class="modal-section">
                        <label for="commit-description">Description (선택)</label>
                        <textarea id="commit-description" rows="4" placeholder="무엇을 / 왜 바꿨는지 자유롭게 적어주세요"></textarea>
                    </section>
                </div>
                <footer class="modal-footer">
                    <button type="button" class="btn btn-ghost" data-action="cancel">취소</button>
                    <button type="button" class="btn btn-primary" data-action="save" disabled>저장</button>
                </footer>
            </div>
        `;
        document.body.appendChild(overlay);

        const summaryInput = overlay.querySelector('#commit-summary');
        const descInput    = overlay.querySelector('#commit-description');
        const saveBtn      = overlay.querySelector('[data-action="save"]');

        const close = (result) => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(null); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                if (!saveBtn.disabled) { e.preventDefault(); saveBtn.click(); }
            }
        };
        document.addEventListener('keydown', onKey);

        summaryInput.addEventListener('input', () => {
            saveBtn.disabled = !summaryInput.value.trim();
        });
        saveBtn.addEventListener('click', () => {
            close({
                summary: summaryInput.value.trim(),
                description: descInput.value.trim(),
            });
        });
        overlay.querySelectorAll('[data-action="cancel"]').forEach(btn => {
            btn.addEventListener('click', () => close(null));
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });

        requestAnimationFrame(() => summaryInput.focus());
    });
}

// ─────────────────────────────────────────────────────────────────
// 저장 — 모달 확인 후 PUT /api/file → 응답 매핑
// ─────────────────────────────────────────────────────────────────

async function handleSave() {
    if (state.saving) return;
    const changes = getChangedFields();
    if (changes.length === 0) {
        toast('변경된 항목이 없습니다');
        return;
    }

    // 저장 전에 변경사항을 미리보기 DOM에 한 번 더 일괄 반영 (사용자가 "미리보기 적용" 안 누른 채 저장 눌러도 안전)
    state.fields.forEach((entry, field) => {
        if (valueSignature(entry.currentValue) !== valueSignature(state.appliedValues.get(field))) {
            applyValueToElements(field, entry.currentValue);
            state.appliedValues.set(field, cloneValue(entry.currentValue));
        }
    });
    state.cardLists.forEach((entry, field) => {
        if (cardListPending(entry)) {
            applyCardListToDoc(field);
            entry.appliedSnapshot = cardsSignature(entry.currentCards);
        }
    });

    const modalResult = await openSaveModal(changes);
    if (!modalResult) return;

    const message = modalResult.description
        ? `${modalResult.summary}\n\n${modalResult.description}`
        : modalResult.summary;

    let newHtml = '<!DOCTYPE html>\n' + state.doc.documentElement.outerHTML;
    newHtml = setScriptBlock(newHtml, 'head', state.scripts.head.content);
    newHtml = setScriptBlock(newHtml, 'body', state.scripts.body.content);

    state.saving = true;
    updateStatus();
    try {
        const res = await fetch(`/api/file/${TARGET_PATH}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newHtml, sha: state.sha, message }),
        });

        if (res.status === 409) {
            const data = await res.json().catch(() => ({}));
            handleShaConflict(data.message || '다른 곳에서 먼저 저장되었습니다.');
            return;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`(${res.status}) ${text.slice(0, 240) || '저장 실패'}`);
        }

        const data = await res.json();
        if (data && typeof data.sha === 'string') state.sha = data.sha;

        // initialValues 갱신 → dirty 0
        state.fields.forEach((entry, field) => {
            state.initialValues.set(field, cloneValue(entry.currentValue));
        });
        state.cardLists.forEach(entry => {
            entry.initialSnapshot = cardsSignature(entry.currentCards);
        });
        state.scripts.head.initial = state.scripts.head.content;
        state.scripts.body.initial = state.scripts.body.content;
        state.lastSavedAt = new Date();
        refreshAllFieldFlags();
        renderPreview();
        toast('저장됨. mujin.im 반영까지 1~3분');
    } catch (err) {
        console.error(err);
        toast(`저장 오류: ${err.message}`);
    } finally {
        state.saving = false;
        updateStatus();
    }
}

function handleShaConflict(msg) {
    const ok = window.confirm(
        `${msg}\n\n` +
        '[확인] 누르면 최신 내용을 다시 불러옵니다.\n' +
        '주의: 지금 입력 중인 변경사항은 사라집니다.'
    );
    if (ok) bootstrap();
}

function bindGlobalControls() {
    document.getElementById('apply-all').addEventListener('click', applyAllToPreview);
    document.getElementById('save-all').addEventListener('click', handleSave);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.querySelector('.workspace').classList.toggle('sidebar-collapsed');
    });

    document.querySelectorAll('.vp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.vp-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const vp = btn.dataset.vp;
            const iframe = document.getElementById('preview-iframe');
            iframe.classList.toggle('vp-pc', vp === 'pc');
            iframe.classList.toggle('vp-mobile', vp === 'mobile');
        });
    });
}

// ─────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// attr selector "[name=\"value\"]" 안에서 value 부분을 안전하게 만들기 위해 \ 와 " 만 escape.
// (field name이 alphanumeric + dot으로 구성돼 있지만 방어 차원)
function attrValEscape(s) {
    return String(s).replace(/[\\"]/g, '\\$&');
}

let toastTimer = null;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ─────────────────────────────────────────────────────────────────
// 스크립트 블록 (HEAD/BODY) 추출/주입
// ─────────────────────────────────────────────────────────────────

const SCRIPT_MARKERS = {
    head: 'ADMIN_HEAD_SCRIPTS',
    body: 'ADMIN_BODY_SCRIPTS',
};

function extractScriptBlock(html, key) {
    const marker = SCRIPT_MARKERS[key];
    const start = `<!-- ${marker}_START -->`;
    const end   = `<!-- ${marker}_END -->`;
    const si = html.indexOf(start);
    const ei = html.indexOf(end);
    if (si !== -1 && ei > si) return html.slice(si + start.length, ei).trim();
    return '';
}

function setScriptBlock(html, key, content) {
    const marker = SCRIPT_MARKERS[key];
    const start = `<!-- ${marker}_START -->`;
    const end   = `<!-- ${marker}_END -->`;
    const block = content.trim() ? `\n${content.trim()}\n` : '';
    const si = html.indexOf(start);
    const ei = html.indexOf(end);
    if (si !== -1 && ei > si) {
        return html.slice(0, si + start.length) + block + html.slice(ei);
    }
    // 마커 없으면 삽입
    if (key === 'head') {
        return html.replace('</head>', `${start}${block}${end}\n</head>`);
    } else {
        return html.replace('</body>', `${start}${block}${end}\n</body>`);
    }
}

// ─────────────────────────────────────────────────────────────────
// 스크립트 관리 섹션 렌더링
// ─────────────────────────────────────────────────────────────────

function renderScriptsSection() {
    const section = buildCollapsibleSection('스크립트 관리', true);
    section.dataset.section = '_scripts';

    const body = section.querySelector('.edit-section-body');

    body.appendChild(buildScriptField(
        'HEAD 스크립트 — &lt;head&gt; 안에 삽입',
        'GTM, 구글 애널리틱스, 네이버 Analytics 등 &lt;head&gt;에 들어가는 추적 코드를 붙여넣으세요.',
        state.scripts.head.content,
        (v) => { state.scripts.head.content = v; updateStatus(); updateScriptSectionFlag(section); },
    ));

    body.appendChild(buildScriptField(
        'BODY 스크립트 — &lt;/body&gt; 바로 앞에 삽입',
        'GTM noscript 태그, 채널톡, 카카오 픽셀 등 body 하단에 들어가는 스크립트를 붙여넣으세요.',
        state.scripts.body.content,
        (v) => { state.scripts.body.content = v; updateStatus(); updateScriptSectionFlag(section); },
    ));

    return section;
}

function buildScriptField(labelHtml, hintHtml, initialValue, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('div');
    label.className = 'field-label';
    label.innerHTML = `<span>${labelHtml}</span>`;
    wrap.appendChild(label);

    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.innerHTML = hintHtml;
    wrap.appendChild(hint);

    const ta = document.createElement('textarea');
    ta.className = 'html-input script-input';
    ta.rows = 5;
    ta.placeholder = '<!-- 예시: GTM 스니펫 붙여넣기 -->';
    ta.value = initialValue;
    ta.addEventListener('input', () => { onChange(ta.value); autoGrow(ta); });
    autoGrow(ta);
    wrap.appendChild(ta);

    return wrap;
}

function updateScriptSectionFlag(section) {
    const header = section.querySelector('.edit-section-header');
    if (!header) return;
    let flag = header.querySelector('.section-flag-dirty');
    const isDirty = state.scripts.head.content !== state.scripts.head.initial
                 || state.scripts.body.content !== state.scripts.body.initial;
    if (isDirty && !flag) {
        flag = document.createElement('span');
        flag.className = 'flag flag-dirty section-flag-dirty';
        flag.textContent = '변경됨';
        header.querySelector('.section-title-row').appendChild(flag);
    } else if (!isDirty && flag) {
        flag.remove();
    }
}

// ─────────────────────────────────────────────────────────────────
// SEO 파일 섹션 렌더링 (robots.txt / sitemap.xml)
// ─────────────────────────────────────────────────────────────────

function renderSeoFilesSection() {
    const section = buildCollapsibleSection('SEO 파일', true);
    section.dataset.section = '_seofiles';

    const body = section.querySelector('.edit-section-body');

    const intro = document.createElement('p');
    intro.className = 'field-hint';
    intro.style.marginBottom = '4px';
    intro.textContent = '구글서치콘솔·네이버서치어드바이저 등 검색엔진 등록에 필요한 파일을 편집합니다.';
    body.appendChild(intro);

    SEO_FILES.forEach(({ path, filename, hint, defaultContent }) => {
        state.seoFiles.set(path, { content: defaultContent, sha: null, initial: null, saving: false, defaultContent });
        body.appendChild(buildSeoFileCard(path, filename, hint));
    });

    return section;
}

function buildSeoFileCard(path, filename, hint) {
    const card = document.createElement('div');
    card.className = 'seo-file-card';

    const title = document.createElement('div');
    title.className = 'seo-file-title';
    title.innerHTML = `<span class="seo-file-name">${escapeHtml(filename)}</span>`;
    card.appendChild(title);

    const hintEl = document.createElement('p');
    hintEl.className = 'field-hint';
    hintEl.textContent = hint;
    card.appendChild(hintEl);

    const ta = document.createElement('textarea');
    ta.className = 'html-input script-input seo-file-textarea';
    ta.dataset.path = path;
    ta.rows = 8;
    ta.value = '불러오는 중…';
    ta.disabled = true;
    card.appendChild(ta);

    const footer = document.createElement('div');
    footer.className = 'seo-file-footer';

    const statusEl = document.createElement('span');
    statusEl.className = 'seo-file-status';
    footer.appendChild(statusEl);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = `${filename} 저장`;
    saveBtn.addEventListener('click', () => saveSeoFile(path, ta, saveBtn, statusEl));
    footer.appendChild(saveBtn);

    card.appendChild(footer);
    return card;
}

async function loadSeoFiles() {
    for (const { path } of SEO_FILES) {
        await loadSeoFile(path);
    }
}

async function loadSeoFile(path) {
    const entry = state.seoFiles.get(path);
    if (!entry) return;

    const ta = document.querySelector(`.seo-file-textarea[data-path="${CSS.escape(path)}"]`);

    try {
        const res = await fetch(`/api/file/${path}`, { credentials: 'same-origin' });
        if (res.ok) {
            const { content, sha } = await res.json();
            entry.content = content;
            entry.sha = sha;
            entry.initial = content;
            if (ta) ta.value = content;
        } else if (res.status === 404) {
            // 신규 파일 — 기본 콘텐츠로 초기화
            entry.content = entry.defaultContent;
            entry.sha = '';
            entry.initial = '';
            if (ta) ta.value = entry.defaultContent;
        }
    } catch (_) {
        if (ta) ta.value = entry.defaultContent;
    } finally {
        if (ta) ta.disabled = false;
    }
}

async function saveSeoFile(path, ta, btn, statusEl) {
    const entry = state.seoFiles.get(path);
    if (!entry || entry.saving) return;

    entry.content = ta.value;
    entry.saving = true;
    btn.disabled = true;
    btn.textContent = '저장 중…';
    statusEl.textContent = '';

    try {
        const res = await fetch(`/api/file/${path}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: ta.value,
                sha: entry.sha || '',
                message: `Update ${path.split('/').pop()} via admin`,
            }),
        });

        if (!res.ok) {
            if (res.status === 409) {
                statusEl.textContent = '저장 충돌 — 페이지를 새로고침 후 다시 시도하세요.';
                return;
            }
            const text = await res.text().catch(() => '');
            throw new Error(text || `저장 실패 (${res.status})`);
        }

        const data = await res.json();
        if (data && data.sha) entry.sha = data.sha;
        entry.initial = ta.value;
        statusEl.textContent = '';
        toast(`${path.split('/').pop()} 저장됨`);
    } catch (err) {
        statusEl.textContent = `오류: ${err.message}`;
    } finally {
        entry.saving = false;
        btn.disabled = false;
        btn.textContent = `${path.split('/').pop()} 저장`;
    }
}

// ─────────────────────────────────────────────────────────────────
// 접을 수 있는 섹션 빌더 (공용)
// ─────────────────────────────────────────────────────────────────

function buildCollapsibleSection(title, startCollapsed = false) {
    const section = document.createElement('section');
    section.className = 'edit-section';
    if (startCollapsed) section.classList.add('is-collapsed');

    const header = document.createElement('header');
    header.className = 'edit-section-header';
    header.style.cursor = 'pointer';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    titleRow.innerHTML = `
        <span class="section-chevron">${startCollapsed ? '▸' : '▾'}</span>
        <h2>${escapeHtml(title)}</h2>
    `;
    header.appendChild(titleRow);

    header.addEventListener('click', () => {
        section.classList.toggle('is-collapsed');
        const chevron = header.querySelector('.section-chevron');
        if (chevron) chevron.textContent = section.classList.contains('is-collapsed') ? '▸' : '▾';
    });

    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'edit-section-body';
    section.appendChild(body);

    return section;
}

// ─────────────────────────────────────────────────────────────────
// 배포 이력 패널
// ─────────────────────────────────────────────────────────────────

function bindHistoryControls() {
    document.getElementById('history-toggle').addEventListener('click', openHistoryPanel);
    document.getElementById('history-close').addEventListener('click', closeHistoryPanel);
    document.getElementById('history-backdrop').addEventListener('click', closeHistoryPanel);
}

function openHistoryPanel() {
    const panel = document.getElementById('history-panel');
    const backdrop = document.getElementById('history-backdrop');
    panel.hidden = false;
    backdrop.hidden = false;
    loadHistory();
}

function closeHistoryPanel() {
    document.getElementById('history-panel').hidden = true;
    document.getElementById('history-backdrop').hidden = true;
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="history-loading">불러오는 중…</div>';

    try {
        const res = await fetch(`/api/history?site=${SITE}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`${res.status}`);
        const commits = await res.json();
        renderHistoryList(commits);
    } catch (err) {
        list.innerHTML = `<div class="history-error">불러오기 실패: ${escapeHtml(err.message)}</div>`;
    }
}

function renderHistoryList(commits) {
    const list = document.getElementById('history-list');
    if (!commits || commits.length === 0) {
        list.innerHTML = '<div class="history-empty">이력이 없습니다.</div>';
        return;
    }

    list.innerHTML = '';
    commits.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'history-card' + (i === 0 ? ' history-card-current' : '');

        const dateStr = formatKSTDate(c.date);
        const summaryLine = c.message.split('\n')[0];

        card.innerHTML = `
            <div class="history-card-meta">
                <span class="history-date">${escapeHtml(dateStr)}</span>
                ${i === 0 ? '<span class="history-current-badge">현재</span>' : ''}
            </div>
            <div class="history-message">${escapeHtml(summaryLine)}</div>
            <div class="history-card-footer">
                <span class="history-sha">${escapeHtml(c.shortSha)}</span>
                <a class="history-gh-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
                ${i !== 0 ? `<button type="button" class="btn btn-sm btn-danger-outline history-rollback-btn" data-sha="${escapeHtml(c.sha)}" data-date="${escapeHtml(dateStr)}">이 버전으로 되돌리기</button>` : ''}
            </div>
        `;

        if (i !== 0) {
            card.querySelector('.history-rollback-btn').addEventListener('click', () => {
                confirmRollback(c.sha, dateStr);
            });
        }

        list.appendChild(card);
    });
}

function confirmRollback(targetSha, targetDate) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-dialog">
            <h3 class="modal-title">버전 되돌리기</h3>
            <p class="modal-body-text">
                <strong>${escapeHtml(targetDate)}</strong> 버전으로 되돌립니다.<br>
                현재 변경사항이 사라지지 않고, 선택한 버전이 새 commit으로 위에 쌓입니다.
            </p>
            <div class="modal-actions">
                <button type="button" class="btn btn-danger" id="rollback-confirm-btn">되돌리기</button>
                <button type="button" class="btn btn-ghost" id="rollback-cancel-btn">취소</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#rollback-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#rollback-confirm-btn').addEventListener('click', async () => {
        const btn = overlay.querySelector('#rollback-confirm-btn');
        btn.disabled = true;
        btn.textContent = '되돌리는 중…';
        await executeRollback(targetSha, targetDate);
        overlay.remove();
    });
}

async function executeRollback(targetSha, targetDate) {
    try {
        const res = await fetch('/api/rollback', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                site: SITE,
                targetSha,
                currentSha: state.sha,
                targetDate,
            }),
        });

        if (res.status === 409) {
            const data = await res.json().catch(() => ({}));
            handleShaConflict(data.message || 'SHA 충돌');
            closeHistoryPanel();
            return;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `오류 ${res.status}`);
        }

        closeHistoryPanel();
        toast('되돌리기 완료. 페이지를 다시 불러옵니다…');
        setTimeout(() => bootstrap(), 1200);
    } catch (err) {
        toast(`되돌리기 실패: ${err.message}`);
    }
}

function formatKSTDate(isoDate) {
    try {
        const d = new Date(isoDate);
        return d.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return isoDate;
    }
}

// ─────────────────────────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────────────────────────

bindHistoryControls();
bootstrap();
