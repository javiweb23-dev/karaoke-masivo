(function (global) {
    let selectedKey = '';
    let onChange = null;
    let trackEl = null;
    let rootEl = null;

    function normalizeKey(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        return escapeHtml(str);
    }

    function extractGenres(songs) {
        const seen = new Map();
        (songs || []).forEach((song) => {
            const label = String(song?.genre ?? '').trim();
            if (!label) return;
            const key = normalizeKey(label);
            if (!seen.has(key)) seen.set(key, label);
        });
        return Array.from(seen.values()).sort((a, b) =>
            a.localeCompare(b, 'es', { sensitivity: 'base' })
        );
    }

    function getPrimaryColor() {
        return (
            getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() ||
            '#ff6600'
        );
    }

    function applyChipStyle(btn, active) {
        const primary = getPrimaryColor();
        if (active) {
            btn.style.borderColor = primary;
            btn.style.backgroundColor = primary;
            btn.style.color = '#000';
            btn.style.fontWeight = '700';
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.style.borderColor = '#444';
            btn.style.backgroundColor = '#252525';
            btn.style.color = '#ccc';
            btn.style.fontWeight = '600';
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    function setActive(key) {
        selectedKey = key;
        if (!trackEl) return;
        trackEl.querySelectorAll('[data-genre-key]').forEach((btn) => {
            const chipKey = btn.getAttribute('data-genre-key') || '';
            applyChipStyle(btn, chipKey === selectedKey);
        });
    }

    function scrollTrack(delta) {
        if (!trackEl) return;
        trackEl.scrollBy({ left: delta, behavior: 'smooth' });
    }

    function updateScrollButtons() {
        if (!trackEl || !rootEl) return;
        const prev = rootEl.querySelector('#genre-scroll-prev');
        const next = rootEl.querySelector('#genre-scroll-next');
        const maxScroll = trackEl.scrollWidth - trackEl.clientWidth;
        const atStart = trackEl.scrollLeft <= 2;
        const atEnd = maxScroll <= 2 || trackEl.scrollLeft >= maxScroll - 2;
        if (prev) {
            prev.disabled = atStart;
            prev.classList.toggle('opacity-30', atStart);
            prev.classList.toggle('pointer-events-none', atStart);
        }
        if (next) {
            next.disabled = atEnd;
            next.classList.toggle('opacity-30', atEnd);
            next.classList.toggle('pointer-events-none', atEnd);
        }
    }

    function setupDragScroll(el) {
        let pointerDown = false;
        let dragMoved = false;
        let startX = 0;
        let scrollLeft = 0;

        const endDrag = () => {
            pointerDown = false;
            el.classList.add('cursor-grab');
            el.classList.remove('cursor-grabbing');
            setTimeout(() => {
                dragMoved = false;
            }, 0);
        };

        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            pointerDown = true;
            dragMoved = false;
            el.classList.remove('cursor-grab');
            el.classList.add('cursor-grabbing');
            startX = e.pageX;
            scrollLeft = el.scrollLeft;
        });

        el.addEventListener('mousemove', (e) => {
            if (!pointerDown) return;
            e.preventDefault();
            const delta = e.pageX - startX;
            if (Math.abs(delta) > 4) dragMoved = true;
            el.scrollLeft = scrollLeft - delta;
        });

        el.addEventListener('mouseup', endDrag);
        el.addEventListener('mouseleave', endDrag);

        el.addEventListener(
            'touchstart',
            (e) => {
                if (!e.touches.length) return;
                pointerDown = true;
                dragMoved = false;
                startX = e.touches[0].pageX;
                scrollLeft = el.scrollLeft;
            },
            { passive: true }
        );

        el.addEventListener(
            'touchmove',
            (e) => {
                if (!pointerDown || !e.touches.length) return;
                const delta = e.touches[0].pageX - startX;
                if (Math.abs(delta) > 4) dragMoved = true;
                el.scrollLeft = scrollLeft - delta;
            },
            { passive: true }
        );

        el.addEventListener('touchend', endDrag);

        el.addEventListener(
            'click',
            (e) => {
                if (!dragMoved) return;
                e.preventDefault();
                e.stopPropagation();
            },
            true
        );
    }

    function buildChipHtml(label, key) {
        return `<button type="button" data-genre-key="${escapeAttr(key)}" aria-pressed="false" class="shrink-0 w-16 h-16 rounded-lg border border-[#444] bg-[#252525] text-[#ccc] text-[10px] leading-tight text-center flex items-center justify-center p-1 break-words hyphens-auto overflow-hidden font-semibold transition-colors">${escapeHtml(label)}</button>`;
    }

    function bindControls() {
        if (!rootEl || !trackEl) return;

        const prev = rootEl.querySelector('#genre-scroll-prev');
        const next = rootEl.querySelector('#genre-scroll-next');

        if (prev) prev.addEventListener('click', () => scrollTrack(-192));
        if (next) next.addEventListener('click', () => scrollTrack(192));

        setupDragScroll(trackEl);

        trackEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-genre-key]');
            if (!btn || !trackEl.contains(btn)) return;
            const key = btn.getAttribute('data-genre-key') || '';
            setActive(key);
            if (typeof onChange === 'function') onChange(key);
        });

        trackEl.addEventListener('scroll', updateScrollButtons, { passive: true });
        window.addEventListener('resize', updateScrollButtons);
        updateScrollButtons();
    }

    function render(root, songs) {
        if (!root) return;
        rootEl = root;
        const genres = extractGenres(songs);

        root.innerHTML = `<div class="relative w-full flex items-center gap-1 mt-3">
<button type="button" id="genre-scroll-prev" aria-label="Anterior" class="shrink-0 w-8 h-16 flex items-center justify-center rounded-lg bg-black/40 text-white hover:bg-white/10 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
<div id="genre-slider-track" class="flex-1 min-w-0 overflow-x-auto flex gap-2 py-1 px-0.5 cursor-grab select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
<button type="button" data-genre-key="" aria-pressed="false" class="shrink-0 w-16 h-16 rounded-lg border border-[#444] bg-[#252525] text-[#ccc] text-[10px] leading-tight text-center flex items-center justify-center p-1 font-semibold transition-colors">Todos</button>
${genres.map((genre) => buildChipHtml(genre, normalizeKey(genre))).join('')}
</div>
<button type="button" id="genre-scroll-next" aria-label="Siguiente" class="shrink-0 w-8 h-16 flex items-center justify-center rounded-lg bg-black/40 text-white hover:bg-white/10 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
</div>`;

        trackEl = root.querySelector('#genre-slider-track');
        setActive(selectedKey);
        bindControls();
    }

    function init(rootId, changeCallback) {
        onChange = changeCallback;
        rootEl = document.getElementById(rootId);
        return rootEl;
    }

    function update(songs) {
        if (!rootEl) rootEl = document.getElementById('genre-slider-root');
        render(rootEl, songs);
    }

    function getSelectedKey() {
        return selectedKey;
    }

    function reset() {
        setActive('');
        if (typeof onChange === 'function') onChange('');
    }

    global.GenreSlider = {
        init,
        update,
        getSelectedKey,
        reset,
        setActive
    };
})(window);
