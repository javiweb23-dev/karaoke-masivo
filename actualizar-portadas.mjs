import fetch from 'node-fetch';
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
    process.env.SUPABASE_URL || 'https://vqirrwlznzbooiwlksly.supabase.co';
const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    '';
const FILTER_DJ = (process.env.DJ_ID || process.argv.find((a) => a.startsWith('--dj='))?.split('=')[1] || '')
    .trim()
    .toLowerCase();

const NOT_FOUND = 'not_found';
const PAGE_SIZE = 1000;
const DELAY_MS = 1000;
const COVERS_TABLE = 'covers';
const CANCIONES_TABLE = 'canciones';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function extractCoverUrl(row) {
    if (!row) return '';
    const url = row.url || row.cover_url || row.imagen_url || row.avatar_url || '';
    return String(url).trim();
}

function coverKey(idDj, numero) {
    return `${String(idDj).trim().toLowerCase()}::${String(numero).trim()}`;
}

function upsizeArtwork(url) {
    if (!url) return url;
    return String(url).replace(/100x100bb/g, '600x600bb').replace(/100x100/g, '600x600');
}

function buildSearchTerm(artista, titulo) {
    return `${String(artista || '').trim()} ${String(titulo || '').trim()}`.replace(/\s+/g, ' ').trim();
}

async function fetchPaginated(supabase, table, select, extraFilter) {
    const rows = [];
    let from = 0;
    while (true) {
        let q = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
        if (extraFilter) q = extraFilter(q);
        const { data, error } = await q;
        if (error) throw error;
        const chunk = data || [];
        rows.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return rows;
}

async function loadCanciones(supabase) {
    return fetchPaginated(supabase, CANCIONES_TABLE, 'id_dj, numero, artista, titulo', (q) => {
        if (FILTER_DJ) return q.eq('id_dj', FILTER_DJ);
        return q;
    });
}

async function loadCoversMap(supabase) {
    const map = new Map();
    const rows = await fetchPaginated(supabase, COVERS_TABLE, 'id_dj, numero, url, cover_url, imagen_url, avatar_url', (q) => {
        if (FILTER_DJ) return q.eq('id_dj', FILTER_DJ);
        return q;
    });
    for (const row of rows) {
        map.set(coverKey(row.id_dj, row.numero), extractCoverUrl(row));
    }
    return map;
}

function pendingSongs(canciones, coversMap) {
    return canciones.filter((song) => {
        const url = coversMap.get(coverKey(song.id_dj, song.numero));
        if (url === NOT_FOUND) return false;
        if (!url) return true;
        return false;
    });
}

async function searchItunes(artista, titulo) {
    const term = encodeURIComponent(buildSearchTerm(artista, titulo));
    const apiUrl = `https://itunes.apple.com/search?term=${term}&limit=1&entity=song`;
    const res = await fetch(apiUrl, {
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
        throw new Error(`iTunes HTTP ${res.status}`);
    }
    const json = await res.json();
    const hit = json?.results?.[0];
    if (!hit?.artworkUrl100) return null;
    return upsizeArtwork(hit.artworkUrl100);
}

async function saveCoverUrl(supabase, song, url) {
    const payload = {
        id_dj: String(song.id_dj).trim().toLowerCase(),
        numero: String(song.numero).trim(),
        url
    };
    const { error } = await supabase.from(COVERS_TABLE).upsert(payload, {
        onConflict: 'id_dj,numero'
    });
    if (error) throw error;
}

async function tryUpdateCancionesCoverUrl(supabase, song, url) {
    const { error } = await supabase
        .from(CANCIONES_TABLE)
        .update({ cover_url: url })
        .eq('id_dj', song.id_dj)
        .eq('numero', song.numero);
    if (error && !/cover_url|column/i.test(error.message)) {
        throw error;
    }
}

async function main() {
    if (!SUPABASE_KEY) {
        console.error(
            'Falta la clave de Supabase. Define SUPABASE_SERVICE_ROLE_KEY (recomendado) o SUPABASE_KEY.'
        );
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('Cargando canciones desde Supabase...');
    let canciones;
    try {
        canciones = await loadCanciones(supabase);
    } catch (err) {
        console.error('Error al leer canciones:', err.message);
        process.exit(1);
    }

    let coversMap = new Map();
    try {
        coversMap = await loadCoversMap(supabase);
    } catch (err) {
        console.warn(
            `No se pudo leer la tabla "${COVERS_TABLE}" (${err.message}). Se intentará solo cover_url en canciones si existe.`
        );
    }

    const pendientes = pendingSongs(canciones, coversMap);
    console.log(`Canciones sin portada: ${pendientes.length} de ${canciones.length}`);
    if (FILTER_DJ) console.log(`Filtro DJ: ${FILTER_DJ}`);
    if (!pendientes.length) return;

    let ok = 0;
    let fail = 0;

    for (const [index, song] of pendientes.entries()) {
        const artista = String(song.artista ?? '').trim();
        const titulo = String(song.titulo ?? '').trim();
        const label = `${titulo} - ${artista}`;

        try {
            const artwork = await searchItunes(artista, titulo);
            const urlToSave = artwork || NOT_FOUND;

            await saveCoverUrl(supabase, song, urlToSave);
            await tryUpdateCancionesCoverUrl(supabase, song, urlToSave);

            if (artwork) {
                ok += 1;
                console.log(`[${index + 1}/${pendientes.length}] Actualizada: ${label}`);
            } else {
                fail += 1;
                console.log(`[${index + 1}/${pendientes.length}] Sin resultado (not_found): ${label}`);
            }
        } catch (err) {
            fail += 1;
            console.error(`[${index + 1}/${pendientes.length}] Error en "${label}":`, err.message);
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nListo. Actualizadas: ${ok}. Sin imagen / error: ${fail}.`);
}

main().catch((err) => {
    console.error('Error fatal:', err);
    process.exit(1);
});
