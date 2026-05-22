const SUPABASE_URL = 'https://vqirrwlznzbooiwlksly.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V9S8NC_f7Pn0dms86m3OFw_X5ficboj';
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let allSongs = [];
let coverSearchChain = Promise.resolve();
const coverFetchInFlight = new Set();
let coverLazyObserver = null;
let itunesCooldownUntil = 0;
const COVER_FETCH_DELAY_MS = 2000;
const ITUNES_COOLDOWN_MS = 60000;
const AVATAR_PLACEHOLDER =
    'https://placehold.co/50x50/333333/FFFFFF/png?text=%F0%9F%8E%B5';
const COVER_MIC_PLACEHOLDER =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect width="50" height="50" fill="#252525"/><text x="25" y="31" text-anchor="middle" font-size="18" fill="#777">🎤</text></svg>'
    );
const MAX_INTENTOS_PORTADA = 10;
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
    setupListaCancionesDelegation();
    startLiveStatusTracking();
});

function setupListaCancionesDelegation() {
    const list = document.getElementById('lista-canciones');
    if (!list || list.dataset.pedirBound === '1') return;
    list.dataset.pedirBound = '1';
    list.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-pedir');
        if (!btn || !list.contains(btn)) return;
        manejarClickPedido(
            btn,
            btn.getAttribute('data-numero') || '',
            btn.getAttribute('data-artista') || 'Desconocido',
            btn.getAttribute('data-titulo') || 'Desconocido'
        );
    });
}

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
    if (url == null || url === undefined) return null;
    const value = String(url).trim();
    if (!value || value === 'not_found' || value.toLowerCase() === 'null') return null;
    return value;
}

function getStoredCoverUrl(url) {
    if (url == null || url === undefined) return null;
    const value = String(url).trim();
    if (!value || value.toLowerCase() === 'null') return null;
    if (value === 'not_found') return 'not_found';
    return value;
}

function songDomId(cancion) {
    const raw = cancion?.id != null ? String(cancion.id) : `${currentDjId}_${cancion?.number ?? ''}`;
    return 'img-' + raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getIntentosBusqueda(cancion) {
    const n = Number(cancion?.intentos_busqueda);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

function needsCoverFetch(cancion) {
    if (!cancion) return false;
    if (cancion.cover_url === 'not_found') return false;
    if (normalizeCoverUrl(cancion.cover_url)) return false;
    if (getIntentosBusqueda(cancion) >= MAX_INTENTOS_PORTADA) return false;
    const cover = cancion.cover_url;
    return cover == null || cover === '';
}

function normalizeMatchText(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function textoCoincide(esperado, recibido) {
    const a = normalizeMatchText(esperado);
    const b = normalizeMatchText(recibido);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const tokensA = a.split(' ').filter((t) => t.length > 2);
    const tokensB = b.split(' ').filter((t) => t.length > 2);
    if (!tokensA.length || !tokensB.length) return false;
    return tokensA.every((t) => b.includes(t)) && tokensB.every((t) => a.includes(t));
}

function itunesResultCoincide(cancion, result) {
    if (!result) return false;
    const artistaOk = textoCoincide(cancion.artist, result.artistName);
    const tituloOk = textoCoincide(cancion.title, result.trackName);
    return artistaOk && tituloOk;
}

function upsizeItunesArtwork(url) {
    return String(url).replace(/100x100bb/g, '300x300bb').replace(/100x100/g, '300x300');
}

async function fetchItunesResultado(artista, titulo) {
    if (Date.now() < itunesCooldownUntil) {
        return { ok: false, rateLimited: true, result: null };
    }
    const term = encodeURIComponent(`${artista} ${titulo}`.trim());
    const res = await fetch(`/api/itunes-search?term=${term}`);
    if (res.status === 429) {
        itunesCooldownUntil = Date.now() + ITUNES_COOLDOWN_MS;
        return { ok: false, rateLimited: true, result: null };
    }
    if (!res.ok) {
        return { ok: false, rateLimited: false, result: null };
    }
    const json = await res.json();
    const result =
        json.results && json.results.length > 0 ? json.results[0] : null;
    return { ok: true, rateLimited: false, result };
}

async function guardarEstadoPortadaRpc(cancionId, nuevaUrl) {
    const { error: rpcError } = await _supabase.schema('public').rpc('actualizar_portada', {
        cancion_id: parseInt(cancionId, 10),
        nueva_url: nuevaUrl
    });
    if (rpcError) throw rpcError;
    const { data: verificacion } = await _supabase
        .from('canciones')
        .select('id, cover_url, intentos_busqueda')
        .eq('id', cancionId)
        .maybeSingle();
    return verificacion;
}

function aplicarEstadoPortadaEnMemoria(cancion, domId, verificacion) {
    const enMemoria = allSongs.find((s) => songDomId(s) === domId);
    const target = enMemoria || cancion;
    if (verificacion) {
        target.cover_url = getStoredCoverUrl(verificacion.cover_url);
        target.intentos_busqueda = getIntentosBusqueda({
            intentos_busqueda: verificacion.intentos_busqueda
        });
    }
    if (enMemoria) {
        enMemoria.cover_url = target.cover_url;
        enMemoria.intentos_busqueda = target.intentos_busqueda;
    }
}

function actualizarCoverEnDom(domId, cancion) {
    const slot = document.getElementById(domId);
    if (!slot) return;
    const url = normalizeCoverUrl(cancion.cover_url);
    if (url) {
        if (slot.tagName === 'IMG') {
            slot.src = url;
            slot.onerror = () => {
                slot.onerror = null;
                slot.src = COVER_MIC_PLACEHOLDER;
            };
        } else {
            const img = document.createElement('img');
            img.id = domId;
            img.className = 'song-cover-slot';
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = url;
            img.style.cssText =
                'width:50px;height:50px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#2a2a2a;display:block;';
            img.onerror = () => {
                img.onerror = null;
                img.src = COVER_MIC_PLACEHOLDER;
            };
            slot.replaceWith(img);
        }
        return;
    }
    if (slot.tagName === 'IMG') {
        slot.src = COVER_MIC_PLACEHOLDER;
        slot.onerror = null;
    }
}

function scheduleCoverSearch(cancion) {
    const key = songDomId(cancion);
    if (coverFetchInFlight.has(key) || !needsCoverFetch(cancion)) return;
    if (Date.now() < itunesCooldownUntil) return;
    coverSearchChain = coverSearchChain
        .then(() => buscarYGuardarPortada(cancion))
        .then(() => new Promise((r) => setTimeout(r, COVER_FETCH_DELAY_MS)))
        .catch(() => {});
}

function setupCoverLazyObserver(list, lista) {
    if (!list || typeof IntersectionObserver === 'undefined') {
        for (const cancion of lista) {
            if (needsCoverFetch(cancion)) scheduleCoverSearch(cancion);
        }
        return;
    }
    if (coverLazyObserver) {
        coverLazyObserver.disconnect();
    }
    const pendientes = lista.filter((c) => needsCoverFetch(c));
    if (!pendientes.length) return;

    const porDomId = new Map();
    pendientes.forEach((c) => porDomId.set(songDomId(c), c));

    coverLazyObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const img = entry.target;
                const cancion = porDomId.get(img.id);
                if (cancion) scheduleCoverSearch(cancion);
                coverLazyObserver.unobserve(img);
            });
        },
        { root: null, rootMargin: '120px 0px', threshold: 0.01 }
    );

    pendientes.forEach((c) => {
        const img = document.getElementById(songDomId(c));
        if (img) coverLazyObserver.observe(img);
    });
}

async function buscarYGuardarPortada(cancion) {
    const domId = songDomId(cancion);
    if (coverFetchInFlight.has(domId) || !needsCoverFetch(cancion)) return;
    coverFetchInFlight.add(domId);

    const cancionId = parseInt(cancion.id, 10);
    if (!Number.isFinite(cancionId)) {
        console.error('actualizar_portada: ID de cancion invalido', cancion);
        coverFetchInFlight.delete(domId);
        return;
    }

    try {
        const intentosAntes = getIntentosBusqueda(cancion);
        const artista = String(cancion.artist ?? '').trim();
        const titulo = String(cancion.title ?? '').trim();
        const itunes = await fetchItunesResultado(artista, titulo);

        if (!itunes.ok) {
            console.warn(
                'iTunes no disponible (CORS o limite). Se reintentara mas tarde:',
                titulo
            );
            return;
        }

        let nuevaUrl = '';
        const result = itunes.result;
        const coincide =
            result &&
            itunesResultCoincide(cancion, result) &&
            result.artworkUrl100;

        if (coincide) {
            nuevaUrl = upsizeItunesArtwork(result.artworkUrl100);
        } else {
            const intentosDespues = intentosAntes + 1;
            nuevaUrl = intentosDespues >= MAX_INTENTOS_PORTADA ? 'not_found' : '';
        }

        console.log('actualizar_portada RPC:', {
            cancion_id: cancionId,
            nueva_url: nuevaUrl || '(vacio, +1 intento)',
            coincide: !!coincide
        });

        const verificacion = await guardarEstadoPortadaRpc(cancionId, nuevaUrl);
        aplicarEstadoPortadaEnMemoria(cancion, domId, verificacion);
        actualizarCoverEnDom(domId, cancion);

        console.log('cover_url en BD (id=' + cancionId + '):', verificacion?.cover_url ?? null);
    } catch (err) {
        console.warn('buscarYGuardarPortada:', cancion?.title, err?.message || err);
    } finally {
        coverFetchInFlight.delete(domId);
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
}

async function fetchCancionesPaginated(selectFields) {
    let todasLasFilas = [];
    let rangoInicio = 0;
    const tamRango = 1000;
    let errorTotales = null;
    while (true) {
        const res = await _supabase
            .from('canciones')
            .select(selectFields)
            .eq('id_dj', currentDjId)
            .order('artista', { ascending: true })
            .order('titulo', { ascending: true })
            .range(rangoInicio, rangoInicio + tamRango - 1);
        errorTotales = res.error;
        if (errorTotales) return { data: null, error: errorTotales };
        const trozo = res.data || [];
        todasLasFilas = todasLasFilas.concat(trozo);
        if (trozo.length < tamRango) break;
        rangoInicio += tamRango;
    }
    return { data: todasLasFilas, error: null };
}

async function loadSongsByDj() {
    const loading = document.getElementById('loading');
    let result = await fetchCancionesPaginated(
        'id, numero, artista, titulo, genero, idioma, cover_url, intentos_busqueda'
    );
    if (result.error && /cover_url|intentos_busqueda/i.test(result.error.message || '')) {
        result = await fetchCancionesPaginated('id, numero, artista, titulo, genero, idioma');
    }
    if (result.error) {
        if (loading) loading.innerText = result.error.message || 'Error al leer las canciones. Refresca la pagina.';
        allSongs = [];
        return;
    }
    allSongs = (result.data || []).map((song) => ({
        id: song.id,
        number: song.numero,
        artist: String(song.artista ?? '').trim(),
        title: String(song.titulo ?? '').trim(),
        genre: song.genero ?? '',
        language: song.idioma ?? '',
        cover_url: getStoredCoverUrl(song.cover_url),
        intentos_busqueda: getIntentosBusqueda({ intentos_busqueda: song.intentos_busqueda })
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

function buildSongItemHtml(cancion, accent) {
    const titulo =
        cancion?.title != null && cancion.title !== ''
            ? String(cancion.title)
            : 'Desconocido';
    const artista =
        cancion?.artist != null && cancion.artist !== ''
            ? String(cancion.artist)
            : 'Desconocido';
    const meta = formatSongMeta(cancion);
    const coverValido = normalizeCoverUrl(cancion.cover_url);
    const slotId = escapeAttr(songDomId(cancion));
    const numero = String(cancion?.number ?? '');
    const placeholder = escapeAttr(AVATAR_PLACEHOLDER);
    const coverHtml = coverValido
        ? `<img id="${slotId}" class="song-cover-slot" src="${escapeAttr(coverValido)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escapeAttr(COVER_MIC_PLACEHOLDER)}';" style="width:50px;height:50px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#2a2a2a;display:block;" />`
        : `<img id="${slotId}" class="song-cover-slot" src="${escapeAttr(COVER_MIC_PLACEHOLDER)}" alt="" style="width:50px;height:50px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#252525;display:block;" />`;

    return `
<div class="song-list-item" role="listitem" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #333;width:100%;box-sizing:border-box;">
    ${coverHtml}
    <div style="flex-grow:1;min-width:0;overflow:hidden;text-align:left;">
        <div style="font-weight:700;font-size:16px;line-height:1.25;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(titulo)}</div>
        <div style="margin-top:4px;font-size:13px;line-height:1.3;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(meta)}</div>
    </div>
    <button
        type="button"
        class="btn-pedir"
        data-numero="${escapeAttr(numero)}"
        data-artista="${escapeAttr(artista)}"
        data-titulo="${escapeAttr(titulo)}"
        style="flex-shrink:0;min-width:68px;padding:10px 14px;border:none;border-radius:20px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;background-color:${escapeAttr(accent)};color:#000;"
    >PEDIR</button>
</div>`;
}

function renderSongs(songs) {
    const list = document.getElementById('lista-canciones');
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

    const lista = Array.isArray(songs) ? songs : [];
    const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() ||
        DEFAULT_PRIMARY_COLOR;
    const htmlParts = [];

    for (const cancion of lista) {
        try {
            htmlParts.push(buildSongItemHtml(cancion, accent));
        } catch (err) {
            console.error('Error al renderizar cancion:', err);
        }
    }

    list.innerHTML = htmlParts.join('');
    setupCoverLazyObserver(list, lista);
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