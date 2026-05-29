(function (global) {
    const BATCH_SIZE = 400;
    const UPSERT_CONFLICT = 'id_dj,artista,titulo';

    function songIdentityKey(idDj, artista, titulo) {
        return `${idDj}\u0001${String(artista ?? '').trim()}\u0001${String(titulo ?? '').trim()}`;
    }

    function mapRowToSong(row, idDj) {
        const numero = String(row.numero || row.number || row.id || '').trim();
        const artista = String(row.artista || row.artist || '').trim();
        const titulo = String(row.titulo || row.title || '').trim();
        const genero = String(row.genero || row.genre || '').trim();
        const idioma = String(row.idioma || row.language || '').trim().toLowerCase();
        const coverUrl = String(
            row.cover_url || row.url || row.portada || row.cover || ''
        ).trim();
        if (!numero || !artista || !titulo) return null;
        const song = {
            id_dj: idDj,
            numero,
            artista,
            titulo,
            genero,
            idioma: idioma || 'español'
        };
        if (coverUrl) song.cover_url = coverUrl;
        return song;
    }

    function dedupeSongsByIdentity(songs, idDj) {
        const byKey = new Map();
        songs.forEach((song) => {
            byKey.set(songIdentityKey(idDj, song.artista, song.titulo), song);
        });
        return Array.from(byKey.values());
    }

    async function parseCatalogFile(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        let rows = [];
        if (ext === 'csv') {
            const text = await file.text();
            const wb = XLSX.read(text, { type: 'string' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } else {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }
        return rows;
    }

    async function upsertBatches(supabase, songs) {
        let processed = 0;
        for (let i = 0; i < songs.length; i += BATCH_SIZE) {
            const batch = songs.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('canciones').upsert(batch, {
                onConflict: UPSERT_CONFLICT,
                ignoreDuplicates: false
            });
            if (error) throw error;
            processed += batch.length;
        }
        return processed;
    }

    async function importCatalogFromFile(supabase, file, idDj, hooks) {
        if (!idDj) throw new Error('No se detecto dj en la URL.');
        if (!file) throw new Error('Archivo no valido.');
        if (typeof hooks?.onProgress === 'function') {
            hooks.onProgress('Procesando archivo...');
        }

        const rows = await parseCatalogFile(file);
        if (!rows.length) throw new Error('El archivo esta vacio.');

        const parsed = rows.map((row) => mapRowToSong(row, idDj)).filter(Boolean);
        if (!parsed.length) throw new Error('No se encontraron canciones validas.');

        const songs = dedupeSongsByIdentity(parsed, idDj);

        if (typeof hooks?.onProgress === 'function') {
            hooks.onProgress('Guardando en Supabase...');
        }

        const processed = await upsertBatches(supabase, songs);

        return {
            total: parsed.length,
            processed,
            unique: songs.length
        };
    }

    global.CatalogImport = {
        mapRowToSong,
        importCatalogFromFile
    };
})(window);
