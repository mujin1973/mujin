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
    'about.badges':              '인증 뱃지 리스트',
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
    'onlineMall.gallery':        '갤러리 리스트',
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

// HTML sanitize 화이트리스트 (html: prefix용)
const HTML_ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'BR']);

// ─────────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────────

const state = {
    doc: null,                  // 편집 중인 DOM (Document)
    sha: null,                  // GitHub Contents API sha
    fields: new Map(),          // fieldName -> FieldEntry
    cardLists: new Map(),       // fieldName -> CardListEntry
    initialValues: new Map(),   // fieldName -> 최초 로드 시 표시값 (dirty 비교용)
    appliedValues: new Map(),   // fieldName -> 미리보기에 반영된 표시값 (pending 비교용)
    viewport: 'pc',
    lastSavedAt: null,
};

// FieldEntry: { section, prefixes:Set, elements:[{el, prefix}], currentValue, formPrefix }

// ─────────────────────────────────────────────────────────────────
// 부트스트랩
// ─────────────────────────────────────────────────────────────────

async function bootstrap() {
    try {
        const res = await fetch(`/api/file/${TARGET_PATH}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`GET /api/file 실패: ${res.status}`);
        const { content, sha } = await res.json();

        state.sha = sha;
        state.doc = new DOMParser().parseFromString(content, 'text/html');

        buildIndex();
        renderForm();
        renderPreview();
        updateStatus();

        bindGlobalControls();
    } catch (err) {
        console.error(err);
        document.getElementById('form-panel-inner').innerHTML = `
            <div class="loading" style="color: var(--danger)">
                로드 실패: ${escapeHtml(err.message)}
            </div>`;
    }
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
                    state.cardLists.set(field, {
                        order: order++,
                        container: el,
                        section: sectionKeyOf(field),
                        items: Array.from(el.querySelectorAll('[data-edit-item]')),
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
        state.initialValues.set(field, valueSignature(entry.currentValue));
        state.appliedValues.set(field, valueSignature(entry.currentValue));
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
}

function renderSection(sectionKey, fields, cardListFields) {
    const section = document.createElement('section');
    section.className = 'edit-section';
    section.dataset.section = sectionKey;

    const header = document.createElement('header');
    header.className = 'edit-section-header';
    header.innerHTML = `
        <h2>${SECTION_LABELS[sectionKey] || sectionKey}</h2>
        <button type="button" class="btn btn-ghost btn-sm section-apply">미리보기 적용</button>
    `;
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
        else                     body.appendChild(renderCardListPlaceholder(it.field));
    });

    section.appendChild(body);

    header.querySelector('.section-apply').addEventListener('click', () => {
        applySectionToPreview(sectionKey);
    });

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
                    onFieldInput(field, { src: curr.src || '', alt: altInput.value });
                });
                wrap.appendChild(altInput);
            }

            const note = document.createElement('div');
            note.className = 'image-upload-btn';
            note.textContent = '이미지 업로더는 다음 단계에서 활성화됩니다';
            wrap.appendChild(note);

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
            const note = document.createElement('div');
            note.className = 'image-upload-btn';
            note.textContent = '배경 이미지 업로더는 다음 단계에서 활성화됩니다';
            wrap.appendChild(note);
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

function renderCardListPlaceholder(field) {
    const entry = state.cardLists.get(field);
    const wrap = document.createElement('div');
    wrap.className = 'card-list-placeholder';
    wrap.innerHTML = `
        <strong>${escapeHtml(FIELD_LABELS[field] || field)}</strong>
        — 현재 ${entry.items.length}개 카드<br>
        추가/삭제/순서변경은 단계 6에서 활성화됩니다 (SortableJS).
    `;
    return wrap;
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
    const isDirty = sig !== state.initialValues.get(field);
    const isPending = sig !== state.appliedValues.get(field);
    flagsEl.innerHTML = '';
    if (isPending) flagsEl.innerHTML += '<span class="flag flag-pending">미반영</span>';
    if (isDirty)   flagsEl.innerHTML += '<span class="flag flag-dirty">변경됨</span>';
}

// ─────────────────────────────────────────────────────────────────
// 미리보기 (iframe srcdoc)
// ─────────────────────────────────────────────────────────────────

function applySectionToPreview(sectionKey) {
    let count = 0;
    state.fields.forEach((entry, field) => {
        if (entry.section !== sectionKey) return;
        if (valueSignature(entry.currentValue) === state.appliedValues.get(field)) return;
        applyValueToElements(field, entry.currentValue);
        state.appliedValues.set(field, valueSignature(entry.currentValue));
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
        if (valueSignature(entry.currentValue) === state.appliedValues.get(field)) return;
        applyValueToElements(field, entry.currentValue);
        state.appliedValues.set(field, valueSignature(entry.currentValue));
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
}

function renderPreview() {
    const iframe = document.getElementById('preview-iframe');
    const clone = state.doc.cloneNode(true);
    rewriteAssetUrls(clone);
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
        if (sig !== state.initialValues.get(field)) dirtyCount++;
        if (sig !== state.appliedValues.get(field)) pendingCount++;
    });

    const dirtyEl = document.getElementById('status-dirty');
    const pendingEl = document.getElementById('status-pending');
    dirtyEl.textContent = `변경 ${dirtyCount}`;
    pendingEl.textContent = `미반영 ${pendingCount}`;
    dirtyEl.classList.toggle('has-changes', dirtyCount > 0);
    pendingEl.classList.toggle('has-pending', pendingCount > 0);

    const saveBtn = document.getElementById('save-all');
    saveBtn.disabled = dirtyCount === 0;
}

function bindGlobalControls() {
    document.getElementById('apply-all').addEventListener('click', applyAllToPreview);
    document.getElementById('save-all').addEventListener('click', () => {
        toast('저장 후 mujin.im 반영까지 약 1~3분 — 저장 API는 단계 4에서 활성화됩니다');
    });

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
// Go
// ─────────────────────────────────────────────────────────────────

bootstrap();
