const SUPABASE_URL = 'https://vqirrwlznzbooiwlksly.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V9S8NC_f7Pn0dms86m3OFw_X5ficboj';
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let allSongs = [];
const DEFAULT_COVER_URL =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1a1a1a"/><circle cx="32" cy="28" r="10" fill="#444"/><path d="M16 52c4-10 12-14 16-14s12 4 16 14" fill="#444"/></svg>'
    );
const ALERT_SOUND_URL = 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg';
let notificationAudio = null;
let notificationAudioReady = false;
const DEFAULT_PRIMARY_COLOR = '#ff6600';
const DEFAULT_LOGO_URL = 'logo.png';
let currentDjId = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('click', unlockNotificationAudio, { once: true });
    document.addEventListener('touchstart', unlockNotificationAudio, { once: true });
    currentDjId = detectDjIdFromUrl();
    if (!currentDjId) {
        document.getElementById('loading').innerText = 'No se detecto el DJ en la URL.';
        return;
    }
    await loadBrandingByDj();
    setupShareQr();
    setupStickyOffsets();
    await loadSongsByDj();
    applyFilters();
    setupEventListeners();
    startLiveStatusTracking();
});

function setupStickyOffsets() {
    const syncOffsets = () => {
        const header = document.querySelector('.header');
        const headerHeight = header ? `${header.offsetHeight}px` : '0px';
        document.documentElement.style.setProperty('--header-height', headerHeight);
        document.documentElement.style.setProperty('--live-status-height', '0px');
    };
    syncOffsets();
    window.addEventListener('resize', syncOffsets);
}

function detectDjIdFromUrl() {
    const queryId = new URLSearchParams(window.location.search).get('dj');
    if (queryId) return queryId.trim().toLowerCase();
    return null;
}

function setBranding(logoUrl, primaryColor) {
    const color = /^#[0-9a-f]{6}$/i.test(String(primaryColor || '')) ? primaryColor : DEFAULT_PRIMARY_COLOR;
    document.documentElement.style.setProperty('--primary-color', color);
    if (currentDjId) localStorage.setItem('color_personalizado_' + currentDjId, color);
    else localStorage.setItem('color_personalizado', color);
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.src = logoUrl || DEFAULT_LOGO_URL;
    }
}

async function loadBrandingByDj() {
    const { data, error } = await _supabase
        .from('usuarios_dj')
        .select('logo_url, color_principal')
        .eq('id_dj', currentDjId)
        .limit(1)
        .maybeSingle();
    if (error || !data) {
        setBranding(DEFAULT_LOGO_URL, DEFAULT_PRIMARY_COLOR);
        return;
    }
    setBranding(data.logo_url, data.color_principal);
}

function normalizeCoverUrl(url) {
    const value = String(url ?? '').trim();
    if (!value || value === 'not_found') return '';
    return value;
}

async function loadSongsByDj() {
    const loading = document.getElementById('loading');
    let todasLasFilas = [];
    let rangoInicio = 0;
    const tamRango = 1000;
    let errorTotales = null;
    while (true) {
        const res = await _supabase
            .from('canciones')
            .select('numero, artista, titulo, genero, idioma, cover_url')
            .eq('id_dj', currentDjId)
            .order('artista', { ascending: true })
            .order('titulo', { ascending: true })
            .range(rangoInicio, rangoInicio + tamRango - 1);
        errorTotales = res.error;
        if (errorTotales) break;
        const trozo = res.data || [];
        todasLasFilas = todasLasFilas.concat(trozo);
        if (trozo.length < tamRango) break;
        rangoInicio += tamRango;
    }
    if (errorTotales) {
        if (loading) loading.innerText = errorTotales.message || 'Error al leer las canciones. Refresca la pagina.';
        allSongs = [];
        return;
    }
    allSongs = todasLasFilas.map((song) => ({
        number: song.numero,
        artist: String(song.artista ?? '').trim(),
        title: String(song.titulo ?? '').trim(),
        genre: song.genero,
        language: song.idioma,
        cover_url: normalizeCoverUrl(song.cover_url)
    }));
}

function formatSongLanguage(lang) {
    const n = normalizeFilterText(lang);
    if (n.includes('ingl')) return 'INGLÉS';
    if (n.includes('esp')) return 'ESPAÑOL';
    const raw = String(lang || '').trim();
    return raw ? raw.toUpperCase() : '—';
}

function formatSongMeta(song) {
    const artist =
        song.artist != null && song.artist !== '' ? String(song.artist) : 'Desconocido';
    const lang = formatSongLanguage(song.language);
    const parts = [artist];
    if (lang && lang !== '—') parts.push(lang);
    return parts.join(' · ');
}

async function updateLiveStatus() {
    const liveSingerText = document.getElementById('liveSingerText');
    if (!liveSingerText) return;
    const { data, error } = await _supabase
        .from('solicitudes')
        .select('nombre_usuario')
        .eq('id_dj', currentDjId)
        .eq('estado', 'preparate')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data) {
        liveSingerText.innerText = '🎤 ESPERANDO PRÓXIMO CANTANTE...';
        return;
    }
    const nombre = String(data.nombre_usuario || '').trim();
    if (!nombre) {
        liveSingerText.innerText = '🎤 ESPERANDO PRÓXIMO CANTANTE...';
        return;
    }
    liveSingerText.innerText = `🎤 CANTANDO AHORA: ${nombre}`;
}

function startLiveStatusTracking() {
    updateLiveStatus();
    _supabase
        .channel('live-status-aprobada')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'solicitudes' },
            (payload) => {
                if (payload.new && payload.new.id_dj !== currentDjId) return;
                if (payload.old && payload.old.id_dj !== currentDjId) return;
                updateLiveStatus();
            }
        )
        .subscribe();
}

function generateShareQrUrl(size) {
    const shareUrl = window.location.href;
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(shareUrl)}`;
}

function setupShareQr() {
    const openQrBtn = document.getElementById('openQrBtn');
    const closeQrBtn = document.getElementById('closeQrBtn');
    const qrModal = document.getElementById('qrModal');
    const qrModalContent = document.querySelector('.qr-modal-content');
    const qrImage = document.getElementById('qrImage');

    if (!openQrBtn || !closeQrBtn || !qrModal || !qrModalContent || !qrImage) return;

    openQrBtn.addEventListener('click', () => {
        const modalWidth = qrModalContent.clientWidth;
        const qrSize = Math.max(180, Math.min(320, modalWidth - 36));
        qrImage.src = generateShareQrUrl(qrSize);
        qrModal.style.display = 'flex';
    });

    closeQrBtn.addEventListener('click', () => {
        qrModal.style.display = 'none';
    });

    qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) {
            qrModal.style.display = 'none';
        }
    });
}

function normalizeFilterText(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

async function unlockNotificationAudio() {
    if (notificationAudioReady) return;
    notificationAudio = new Audio(ALERT_SOUND_URL);
    notificationAudio.preload = 'auto';
    notificationAudio.volume = 1;
    try {
        await notificationAudio.play();
        notificationAudio.pause();
        notificationAudio.currentTime = 0;
    } catch (e) {}
    notificationAudioReady = true;
}

function playNotificationTwice() {
    if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 300, 500, 200, 500]);
    }
    const playOnce = () => {
        if (notificationAudio) {
            notificationAudio.currentTime = 0;
            notificationAudio.play().catch(() => {});
            return;
        }
        const fallbackAudio = new Audio(ALERT_SOUND_URL);
        fallbackAudio.play().catch(() => {});
    };
    playOnce();
    setTimeout(playOnce, 900);
}

function mostrarAlertaElegante(mensaje, tipo) {
    const accent = tipo === 'error'
        ? '#dc3545'
        : getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || DEFAULT_PRIMARY_COLOR;
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0'; 
    modal.style.left = '0'; 
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
    modal.style.display = 'flex'; 
    modal.style.justifyContent = 'center'; 
    modal.style.alignItems = 'center';
    modal.style.zIndex = '9999';
    modal.style.margin = '0';
    modal.style.padding = '0';
    modal.style.boxSizing = 'border-box';

    const box = document.createElement('div');
    box.style.backgroundColor = '#1a1a1a';
    box.style.padding = '25px';
    box.style.borderRadius = '12px';
    box.style.border = '2px solid ' + accent;
    box.style.textAlign = 'center';
    box.style.width = 'calc(100% - 40px)';
    box.style.maxWidth = '400px'; 
    box.style.boxSizing = 'border-box'; 
    box.style.color = 'white';
    box.style.boxShadow = '0 10px 25px rgba(255, 102, 0, 0.2)';
    box.style.margin = '0';

    const title = document.createElement('h3');
    title.innerText = '🎤 Karaoke Latino Dice:';
    title.style.color = accent;
    title.style.margin = '0 0 15px 0';

    const text = document.createElement('p');
    text.innerText = mensaje;
    text.style.whiteSpace = 'pre-line'; 
    text.style.fontSize = '16px';
    text.style.lineHeight = '1.5';
    text.style.wordBreak = 'break-word';
    text.style.margin = '0';

    const btn = document.createElement('button');
    btn.innerText = 'ACEPTAR';
    btn.style.backgroundColor = accent;
    btn.style.border = 'none';
    btn.style.padding = '12px 25px';
    btn.style.borderRadius = '8px';
    btn.style.marginTop = '20px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '16px';
    btn.style.color = '#ffffff';
    btn.style.fontWeight = '800';
    btn.style.textTransform = 'uppercase';
    btn.style.letterSpacing = '1px';
    btn.onclick = async () => {
        await unlockNotificationAudio();
        document.body.removeChild(modal);
    };

    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(btn);
    modal.appendChild(box);
    document.body.appendChild(modal);
}

async function prepararPedido(number, artist, title) {
    let userName = localStorage.getItem('karaoke_user_name');
    const songId = number.toString();
    const userSongsKey = 'karaoke_requested_song_ids';
    const bloqueoMs = 18000000;

    if (!userName || userName.trim() === "") {
        userName = prompt("Tu nombre para la lista:");
        if (userName && userName.trim() !== "") {
            userName = userName.trim();
            localStorage.setItem('karaoke_user_name', userName);
        } else {
            return;
        }
    }

    let requestedSongs = [];
    try {
        const raw = JSON.parse(localStorage.getItem(userSongsKey) || '[]');
        if (Array.isArray(raw)) {
            requestedSongs = raw
                .map((item) => {
                    if (typeof item === 'string') return { id: item, timestamp: 0 };
                    if (item && typeof item === 'object' && item.id != null) {
                        return {
                            id: String(item.id),
                            timestamp: Number(item.timestamp) || 0
                        };
                    }
                    return null;
                })
                .filter(Boolean);
        }
    } catch (e) {
        requestedSongs = [];
    }

    const ahora = Date.now();
    const indiceBloqueo = requestedSongs.findIndex((x) => x.id === songId);
    if (indiceBloqueo !== -1 && ahora - requestedSongs[indiceBloqueo].timestamp < bloqueoMs) {
        mostrarAlertaElegante('Esta canción ya la pediste hoy, ¡intenta con otra para variar el repertorio!', 'error');
        return;
    }

    const { data: globalDuplicate, error: globalDuplicateError } = await _supabase
        .from('solicitudes')
        .select('id')
        .eq('id_dj', currentDjId)
        .eq('numero_cancion', songId)
        .in('estado', ['pendiente', 'preparate'])
        .limit(1);

    if (globalDuplicateError) {
        mostrarAlertaElegante("❌ Error: " + globalDuplicateError.message);
        return;
    }

    if (globalDuplicate && globalDuplicate.length > 0) {
        mostrarAlertaElegante('Esta canción ya la pidieron, espera a que la canten para que vuelva a estar disponible, intenta con otra canción', 'error');
        return;
    }

    const { count: activePendingCount, error: activePendingError } = await _supabase
        .from('solicitudes')
        .select('id', { count: 'exact', head: true })
        .eq('id_dj', currentDjId)
        .eq('nombre_usuario', userName)
        .in('estado', ['pendiente', 'preparate']);

    if (activePendingError) {
        mostrarAlertaElegante("❌ Error: " + activePendingError.message);
        return;
    }

    if ((activePendingCount || 0) >= 3) {
        mostrarAlertaElegante('Ya tienes 3 canciones en cola. ¡Canta las que tienes antes de pedir más!', 'error');
        return;
    }

    const { data, error } = await _supabase
        .from('solicitudes')
        .insert([
            { 
                nombre_usuario: userName, 
                cancion_info: `${artist} - ${title}`, 
                numero_cancion: songId,
                id_dj: currentDjId,
                estado: 'pendiente' 
            }
        ])
        .select();

    if (error) {
        mostrarAlertaElegante("❌ Error: " + error.message);
    } else {
        mostrarAlertaElegante("✅ ¡Recibido!\n\nTu canción ya está en la lista.\n\nMantén esta página abierta para avisarte cuando te toque cantar.");

        if (data && data.length > 0) {
            const ts = Date.now();
            const idx = requestedSongs.findIndex((x) => x.id === songId);
            if (idx !== -1) {
                requestedSongs[idx] = { id: songId, timestamp: ts };
            } else {
                requestedSongs.push({ id: songId, timestamp: ts });
            }
            localStorage.setItem(userSongsKey, JSON.stringify(requestedSongs));
            const idUnico = data[0].id;

            _supabase
                .channel('radar-cancion-' + idUnico)
                .on(
                    'postgres_changes',
                    { 
                        event: 'UPDATE', 
                        schema: 'public', 
                        table: 'solicitudes',
                        filter: `id=eq.${idUnico}`
                    },
                    (payload) => {
                        if (payload.new.estado === 'preparate') {
                            playNotificationTwice();
                            mostrarAlertaElegante(`¡PREPÁRATE ${userName.toUpperCase()}!\n\nTu canción "${title}" es la siguiente.\n\nPendiente, puedes levantar la mano para ubicarte y que te lleven el micrófono.`);
                        }
                    }
                )
                .subscribe();
        }
    }
}

function manejarClickPedido(button, number, artist, title) {
    if (!button || button.disabled) return;
    const originalText = button.innerText;
    button.disabled = true;
    button.innerText = 'ENVIANDO...';
    setTimeout(() => {
        button.disabled = false;
        button.innerText = originalText;
    }, 3000);
    prepararPedido(number, artist, title);
}

function renderSongs(songs) {
    const list = document.getElementById('songsList');
    const loading = document.getElementById('loading');
    const noResults = document.getElementById('noResults');

    if (loading) loading.style.display = 'none';
    if (!list) return;

    list.innerHTML = '';

    if (!songs || songs.length === 0) {
        if (noResults) noResults.style.display = 'block';
        return;
    }
    if (noResults) noResults.style.display = 'none';

    const fragment = document.createDocumentFragment();

    songs.forEach((song) => {
        const item = document.createElement('div');
        item.className = 'song-list-item';
        item.setAttribute('role', 'listitem');

        const img = document.createElement('img');
        img.className = 'song-item-avatar';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        const coverSrc = song.cover_url ? String(song.cover_url) : DEFAULT_COVER_URL;
        img.src = coverSrc;
        img.onerror = () => {
            img.onerror = null;
            img.src = DEFAULT_COVER_URL;
        };

        const info = document.createElement('div');
        info.className = 'song-item-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'song-item-title';
        titleEl.textContent =
            song.title != null && song.title !== '' ? String(song.title) : 'Desconocido';

        const metaEl = document.createElement('div');
        metaEl.className = 'song-item-meta';
        metaEl.textContent = formatSongMeta(song);

        info.appendChild(titleEl);
        info.appendChild(metaEl);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-pedir';
        btn.textContent = 'PEDIR';
        btn.addEventListener('click', () => {
            manejarClickPedido(
                btn,
                String(song.number),
                song.artist != null && song.artist !== '' ? String(song.artist) : 'Desconocido',
                song.title != null && song.title !== '' ? String(song.title) : 'Desconocido'
            );
        });

        item.appendChild(img);
        item.appendChild(info);
        item.appendChild(btn);
        fragment.appendChild(item);
    });

    list.appendChild(fragment);
}

function applyFilters() {
    const searchInput = document.getElementById('searchInput');

    const rawTerm = searchInput ? searchInput.value.trim() : '';
    const term = normalizeFilterText(rawTerm);

    const filtered = allSongs.filter((s) => {
        const cleanA = normalizeFilterText(s.artist);
        const cleanT = normalizeFilterText(s.title);
        const cleanG = normalizeFilterText(s.genre);
        const cleanNum = normalizeFilterText(String(s.number != null ? s.number : ''));

        return (
            term === '' ||
            cleanA.includes(term) ||
            cleanT.includes(term) ||
            cleanG.includes(term) ||
            cleanNum.includes(term)
        );
    });
    renderSongs(filtered);
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', applyFilters);
}