export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const term = String(req.query.term || '').trim();
    if (!term) {
        return res.status(400).json({ error: 'term requerido' });
    }

    const url =
        'https://itunes.apple.com/search?term=' +
        encodeURIComponent(term) +
        '&limit=1&entity=song';

    try {
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'KaraokeLatino/1.0' }
        });
        const body = await upstream.text();
        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/json');
        return res.end(body);
    } catch (e) {
        return res.status(502).json({ error: 'Error al consultar iTunes' });
    }
}
