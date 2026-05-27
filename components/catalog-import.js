(function (global) {
    const BATCH_SIZE = 400;

    function buildSongKey(artista, titulo) {
        return `${String(artista ?? '').trim()}\u0001${String(titulo ?? '').trim()}`;
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

    async function fetchExistingIndex(supabase, idDj) {
        const index = new Map();
        let offset = 0;
        const pageSize = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('canciones')
                .select('id, titulo, artista')
                .eq('id_dj', idDj)
                .range(offset, offset + pageSize - 1);
            if (error) throw error;
            const chunk = data || [];
            chunk.forEach((row) => {
                index.set(buildSongKey(row.artista, row.titulo), row.id);
            });
            if (chunk.length < pageSize) break;
            offset += pageSize;
        }
        return index;
    }

    function partitionSongs(songs, existingIndex) {
        const inserts = [];
        const updates = [];
        const pendingNewKeys = new Map();

        songs.forEach((song) => {
            const key = buildSongKey(song.artista, song.titulo);
            const existingId = existingIndex.get(key);
            if (existingId) {
                const payload = {
                    id: existingId,
                    id_dj: song.id_dj,
                    numero: song.numero,
                    artista: song.artista,
                    titulo: song.titulo,
                    genero: song.genero,
                    idioma: song.idioma
                };
                if (song.cover_url) payload.cover_url = song.cover_url;
                updates.push(payload);
                return;
            }
            if (pendingNewKeys.has(key)) {
                const idx = pendingNewKeys.get(key);
                inserts[idx] = song;
                return;
            }
            pendingNewKeys.set(key, inserts.length);
            inserts.push(song);
        });

        return { inserts, updates };
    }

    async function runBatched(supabase, table, rows, mode) {
        let processed = 0;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            let error = null;
            if (mode === 'insert') {
                const res = await supabase.from(table).insert(batch);
                error = res.error;
            } else {
                const res = await supabase.from(table).upsert(batch, { onConflict: 'id' });
                error = res.error;
            }
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

        const songs = rows.map((row) => mapRowToSong(row, idDj)).filter(Boolean);
        if (!songs.length) throw new Error('No se encontraron canciones validas.');

        if (typeof hooks?.onProgress === 'function') {
            hooks.onProgress('Verificando duplicados...');
        }

        const existingIndex = await fetchExistingIndex(supabase, idDj);
        const { inserts, updates } = partitionSongs(songs, existingIndex);

        if (typeof hooks?.onProgress === 'function') {
            hooks.onProgress('Guardando en Supabase...');
        }

        const inserted = inserts.length
            ? await runBatched(supabase, 'canciones', inserts, 'insert')
            : 0;
        const updated = updates.length
            ? await runBatched(supabase, 'canciones', updates, 'upsert')
            : 0;

        return {
            total: songs.length,
            inserted,
            updated
        };
    }

    global.CatalogImport = {
        buildSongKey,
        mapRowToSong,
        importCatalogFromFile
    };
})(window);
