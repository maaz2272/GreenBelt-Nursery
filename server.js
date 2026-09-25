// Green Belt Nursery - Node.js server (Node 18+, for built-in fetch). Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || __dirname; // used only when Supabase is not configured
const PUB = path.join(__dirname, 'public');
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@greenbelt.in', pass: process.env.ADMIN_PASS || 'admin123' };

// --- Storage: Supabase (survives redeploys, needed on Render's free plan) if configured, else a local file (for local testing) ---
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY, SB_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';
const USE_SUPABASE = !!(SB_URL && SB_KEY);
const DB = path.join(DATA, 'data.json'), UP = path.join(DATA, 'uploads');
if (!USE_SUPABASE) { fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(UP, { recursive: true }); }

const uid = () => crypto.randomBytes(5).toString('hex');
const hash = p => crypto.createHash('sha256').update(String(p)).digest('hex');
const P = (en, sci, hi, plantSize, bagSize, price, cat, desc) => ({ id: uid(), en, sci, hi, plantSize, bagSize, price, cat, img: '', desc });
const seed = {
  site: {
    name: 'Green Belt Nursery', tagline: 'Grown slow, sold local, rooted in your street.',
    phone: '+91 98765 43210', email: 'hello@greenbelt.in', address: 'Green Belt Road, Farrukhabad, Uttar Pradesh 209625',
    hours: 'Every day, 8 am to 7 pm',
    about: 'Green Belt Nursery raises saplings for homes, farms, roadsides and temples. Every plant is grown in our own beds, hardened in the open air, and bagged in the size that suits its roots.',
    manifesto: 'We grow plants that outlive us.\nWe sell only what we would plant at home.\nEvery sapling is a promise of shade.\nGreen is not a colour, it is a habit.',
    aboutImage: '', heroImage: ''
  },
  plants: [
    P('Tulsi', 'Ocimum tenuiflorum', 'तुलसी', '20-30 cm', '6x8 in poly bag', 40, 'Medicinal', 'Sacred basil for courtyards and kitchen windows.'),
    P('Neem', 'Azadirachta indica', 'नीम', '60-90 cm', '10x12 in poly bag', 120, 'Trees', 'Fast, bitter, and generous with shade.'),
    P('Peepal', 'Ficus religiosa', 'पीपल', '70-100 cm', '12x14 in poly bag', 180, 'Trees', 'Long-lived shade tree with heart-shaped leaves.'),
    P('Mango (Dashehari)', 'Mangifera indica', 'आम', '80-120 cm', '12x16 in poly bag', 350, 'Fruit', 'Grafted sapling of the classic Dashehari.'),
    P('Aloe Vera', 'Aloe barbadensis miller', 'घृतकुमारी', '15-25 cm', '6x6 in poly bag', 60, 'Medicinal', 'Thick, juicy leaves for burns and skin.'),
    P('Money Plant', 'Epipremnum aureum', 'मनी प्लांट', '25-40 cm', '5x6 in poly bag', 50, 'Indoor', 'Trailing vine that forgives forgetful waterers.'),
    P('Hibiscus', 'Hibiscus rosa-sinensis', 'गुड़हल', '40-60 cm', '8x10 in poly bag', 90, 'Flowering', 'Big red flowers almost all year.'),
    P('Jasmine (Mogra)', 'Jasminum sambac', 'मोगरा', '30-50 cm', '8x10 in poly bag', 80, 'Flowering', 'Evening fragrance, garland-ready flowers.'),
    P('Bougainvillea', 'Bougainvillea glabra', 'बोगनवेलिया', '50-80 cm', '10x12 in poly bag', 110, 'Flowering', 'Paper-bright colour for walls and gates.')
  ],
  posts: [
    { id: uid(), title: 'Why we bag saplings in black poly', date: '2026-08-12', body: 'Black bags keep roots dark and warm, which is what young roots expect. We punch drainage holes in every bag.', img: '' },
    { id: uid(), title: 'Monsoon planting, a short guide', date: '2026-07-03', body: 'Plant in the evening, water once deeply, and then leave the rain to do its work.', img: '' }
  ],
  work: [
    { id: uid(), title: 'Highway shoulder, 4 km', desc: '1,200 neem and peepal saplings planted with the local panchayat.', img: '' },
    { id: uid(), title: 'School orchard', desc: 'A 60-tree mango and guava orchard tended by students.', img: '' },
    { id: uid(), title: 'Temple courtyard', desc: 'Tulsi, bel and peepal beds around a 200-year-old shrine.', img: '' }
  ],
  lab: [
    { id: uid(), title: 'Cocopeat vs. red soil in 8 in bags', desc: 'Tracking root spread over 12 weeks across four species.' },
    { id: uid(), title: 'Shade-net hardening', desc: 'How many days of 50% shade before a sapling can take full sun.' }
  ],
  users: [], messages: []
};
async function loadDB() {
  if (!USE_SUPABASE) return fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : seed;
  const r = await fetch(`${SB_URL}/rest/v1/kv_store?key=eq.main&select=value`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error('Supabase read failed: ' + await r.text());
  const rows = await r.json();
  if (rows.length) return rows[0].value;
  await saveDB(seed); // first run: seed the table
  return seed;
}
async function saveDB(d) {
  if (!USE_SUPABASE) return fs.writeFileSync(DB, JSON.stringify(d, null, 2));
  const r = await fetch(`${SB_URL}/rest/v1/kv_store?on_conflict=key`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'main', value: d })
  });
  if (!r.ok) throw new Error('Supabase write failed: ' + await r.text());
}
let db; // populated at startup, see bottom of file
const save = () => saveDB(db);
const sessions = {};
const COLS = ['plants', 'posts', 'work', 'lab'];

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, no) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 9e6) { req.destroy(); no(new Error('too large')); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
});
const login = (u, role) => { const t = crypto.randomBytes(24).toString('hex'); sessions[t] = { role, email: u.email, name: u.name }; return { token: t, role, name: u.name }; };

async function api(req, res, p, m) {
  const b = m === 'GET' || m === 'DELETE' ? {} : await body(req);
  const s = sessions[(req.headers.authorization || '').slice(7)];
  const S = (c, o) => send(res, c, o);

  if (p === '/api/data') return S(200, { site: db.site, plants: db.plants, posts: db.posts, work: db.work, lab: db.lab });
  if (p === '/api/login' && m === 'POST') {
    if (b.email === ADMIN.email && b.pass === ADMIN.pass) return S(200, login({ email: b.email, name: 'Admin' }, 'admin'));
    const u = db.users.find(x => x.email === b.email && x.pass === hash(b.pass));
    return u ? S(200, login(u, 'user')) : S(401, { error: 'Wrong email or password.' });
  }
  if (p === '/api/register' && m === 'POST') {
    if (!b.name || !b.email || !b.pass || b.pass.length < 6) return S(400, { error: 'Enter a name, email and a password of 6+ characters.' });
    if (db.users.some(x => x.email === b.email)) return S(400, { error: 'That email already has an account.' });
    const u = { name: b.name, email: b.email, pass: hash(b.pass), favs: [] };
    db.users.push(u); await save(); return S(200, login(u, 'user'));
  }
  if (p === '/api/contact' && m === 'POST') {
    if (!b.name || !b.msg) return S(400, { error: 'Add your name and a message.' });
    db.messages.unshift({ id: uid(), name: b.name, email: b.email || '', msg: b.msg, date: new Date().toISOString() });
    await save(); return S(200, { ok: 1 });
  }
  if (p === '/api/me') {
    const u = s && s.role === 'user' && db.users.find(x => x.email === s.email);
    if (!u) return S(401, { error: 'Log in first.' });
    if (m === 'POST') { const i = u.favs.indexOf(b.id); i < 0 ? u.favs.push(b.id) : u.favs.splice(i, 1); await save(); }
    return S(200, { name: u.name, email: u.email, favs: u.favs });
  }
  if (p.startsWith('/api/admin/')) {
    if (!s || s.role !== 'admin') return S(401, { error: 'Admin only.' });
    const [, , , col, id] = p.split('/');
    if (col === 'site' && m === 'PUT') { Object.assign(db.site, b); await save(); return S(200, db.site); }
    if (col === 'messages') {
      if (m === 'DELETE') { db.messages = db.messages.filter(x => x.id !== id); await save(); }
      return S(200, db.messages);
    }
    if (col === 'upload' && m === 'POST') {
      const r = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(b.data || '');
      if (!r) return S(400, { error: 'Unsupported image. Use PNG, JPG, WEBP or GIF.' });
      const ext = r[1].replace('jpeg', 'jpg'), buf = Buffer.from(r[2], 'base64'), f = uid() + '.' + ext;
      if (USE_SUPABASE) {
        const up = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${f}`, {
          method: 'POST',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': `image/${ext === 'jpg' ? 'jpeg' : ext}` },
          body: buf
        });
        if (!up.ok) return S(500, { error: 'Image upload failed: ' + await up.text() });
        return S(200, { url: `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${f}` });
      }
      fs.writeFileSync(path.join(UP, f), buf);
      return S(200, { url: '/uploads/' + f });
    }
    if (COLS.includes(col)) {
      if (m === 'POST') { const o = { ...b, id: uid() }; db[col].unshift(o); await save(); return S(200, o); }
      const i = db[col].findIndex(x => x.id === id);
      if (i < 0) return S(404, { error: 'Not found.' });
      if (m === 'PUT') { db[col][i] = { ...db[col][i], ...b, id }; await save(); return S(200, db[col][i]); }
      if (m === 'DELETE') { db[col].splice(i, 1); await save(); return S(200, { ok: 1 }); }
    }
  }
  S(404, { error: 'Not found.' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
(async () => {
  try { db = await loadDB(); } catch (e) { console.error('Could not load the database:', e.message); process.exit(1); }
  http.createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.startsWith('/api/')) return await api(req, res, p, req.method);
      const fp = (!USE_SUPABASE && p.startsWith('/uploads/')) ? path.join(UP, path.basename(p)) : path.join(PUB, path.normalize(p === '/' ? '/index.html' : p));
      if (!fp.startsWith(PUB) && !fp.startsWith(UP)) { res.writeHead(403); return res.end(); }
      fs.readFile(fp, (e, d) => {
        if (e) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d);
      });
    } catch (e) { send(res, 500, { error: 'Server error' }); }
  }).listen(PORT, () => console.log(`\n  Green Belt Nursery running at http://localhost:${PORT}\n  Admin login: ${ADMIN.email} / ${ADMIN.pass}\n  Storage: ${USE_SUPABASE ? 'Supabase (' + SB_URL + ')' : 'local file (' + DATA + ')'}\n`));
})();
