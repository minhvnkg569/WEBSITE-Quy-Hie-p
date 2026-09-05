/**
 * HƯƠNG QUÊ — Worker chính
 * Thay thế Airtable bằng Cloudflare D1 (database) + Cloudinary (lưu ảnh, miễn phí không cần thẻ).
 *
 * ROUTE CÔNG KHAI:
 *   /                    → trang chủ (static, tự gọi /api/products + /api/banners)
 *   /san-pham            → xem toàn bộ sản phẩm
 *   /san-pham/:slug       → chi tiết 1 sản phẩm
 *   /danh-muc/:slug       → lọc theo danh mục
 *   /api/products         → JSON toàn bộ sản phẩm đang hiển thị
 *   /api/banners          → JSON banner
 *
 * ROUTE QUẢN TRỊ (cần đăng nhập):
 *   /admin/login          → trang đăng nhập
 *   /admin                → dashboard quản lý sản phẩm + banner (upload ảnh thẳng lên Cloudinary)
 *   /api/admin/products    → GET/POST danh sách + tạo sản phẩm
 *   /api/admin/products/:id→ PUT/DELETE sửa/xoá 1 sản phẩm
 *   /api/admin/banners     → GET/POST banner
 *
 * ⚙️ CẦN THIẾT LẬP TRƯỚC (xem HUONG-DAN-SETUP-ADMIN.md):
 *   - D1 database (binding "DB") + chạy schema.sql
 *   - Tài khoản Cloudinary miễn phí + Upload preset (unsigned)
 *   - Secret ADMIN_PASSWORD, ADMIN_SESSION_SECRET (wrangler secret put)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // ===== API công khai =====
      if (path === '/api/products') return apiPublicProducts(env);
      if (path === '/api/banners') return apiPublicBanners(env);
      if (path === '/api/categories') return apiPublicCategories(env);
      if (path === '/api/posts') return apiPublicPosts(env);

      // ===== Trang công khai động =====
      if (path === '/san-pham') return handleProductList(env);
      if (path.startsWith('/san-pham/')) return handleProductDetail(env, decodeURIComponent(path.slice('/san-pham/'.length)));
      if (path.startsWith('/danh-muc/')) return handleCategory(env, decodeURIComponent(path.slice('/danh-muc/'.length)));
      if (path === '/tin-tuc') return handlePostList(env);
      if (path.startsWith('/tin-tuc/')) return handlePostDetail(env, decodeURIComponent(path.slice('/tin-tuc/'.length)));

      // ===== Khu vực quản trị =====
      if (path === '/admin/login' && request.method === 'GET') return html(renderLoginPage());
      if (path === '/admin/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/admin/logout') return handleLogout();
      if (path === '/admin') return handleAdminDashboard(request, env);

      if (path === '/api/admin/products' && request.method === 'GET') return withAuth(request, env, () => apiAdminListProducts(env));
      if (path === '/api/admin/products' && request.method === 'POST') return withAuth(request, env, () => apiAdminCreateProduct(request, env));
      if (path.startsWith('/api/admin/products/') && request.method === 'PUT') return withAuth(request, env, () => apiAdminUpdateProduct(request, env, path.split('/').pop()));
      if (path.startsWith('/api/admin/products/') && request.method === 'DELETE') return withAuth(request, env, () => apiAdminDeleteProduct(env, path.split('/').pop()));
      if (path === '/api/admin/banners' && request.method === 'GET') return withAuth(request, env, () => apiAdminGetBanners(env));
      if (path === '/api/admin/banners' && request.method === 'POST') return withAuth(request, env, () => apiAdminSaveBanner(request, env));

      if (path === '/api/admin/categories' && request.method === 'GET') return withAuth(request, env, () => apiAdminListCategories(env));
      if (path === '/api/admin/categories' && request.method === 'POST') return withAuth(request, env, () => apiAdminCreateCategory(request, env));
      if (path.startsWith('/api/admin/categories/') && request.method === 'PUT') return withAuth(request, env, () => apiAdminUpdateCategory(request, env, path.split('/').pop()));
      if (path.startsWith('/api/admin/categories/') && request.method === 'DELETE') return withAuth(request, env, () => apiAdminDeleteCategory(env, path.split('/').pop()));

      if (path === '/api/admin/posts' && request.method === 'GET') return withAuth(request, env, () => apiAdminListPosts(env));
      if (path === '/api/admin/posts' && request.method === 'POST') return withAuth(request, env, () => apiAdminCreatePost(request, env));
      if (path.startsWith('/api/admin/posts/') && request.method === 'PUT') return withAuth(request, env, () => apiAdminUpdatePost(request, env, path.split('/').pop()));
      if (path.startsWith('/api/admin/posts/') && request.method === 'DELETE') return withAuth(request, env, () => apiAdminDeletePost(env, path.split('/').pop()));

      // ===== Còn lại: file tĩnh (index.html, ảnh minh hoạ...) =====
      return env.ASSETS.fetch(request);

    } catch (err) {
      return new Response('Lỗi hệ thống: ' + err.message, { status: 500 });
    }
  }
};

// ============================================================
// TIỆN ÍCH DÙNG CHUNG
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
}
function html(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
function formatVND(n) {
  if (n === undefined || n === null || n === '') return '';
  return Number(n).toLocaleString('vi-VN') + '₫';
}

// ============================================================
// XÁC THỰC ADMIN (session token ký bằng HMAC, không cần thư viện ngoài)
// ============================================================

async function hmacSign(env, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function createSessionToken(env) {
  const payload = btoa(JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })); // hết hạn sau 7 ngày
  const sig = await hmacSign(env, payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(env, token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = await hmacSign(env, payload);
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(atob(payload));
    return data.exp > Date.now();
  } catch { return false; }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function isAuthed(request, env) {
  const token = getCookie(request, 'hq_session');
  return verifySessionToken(env, token);
}

// Bọc quanh route quản trị: nếu chưa đăng nhập → chặn lại
async function withAuth(request, env, handler) {
  if (!(await isAuthed(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }
  return handler();
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const password = form.get('password') || '';
  if (password !== env.ADMIN_PASSWORD) {
    return html(renderLoginPage('Sai mật khẩu, thử lại.'), 401);
  }
  const token = await createSessionToken(env);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `hq_session=${token}; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=Lax`
    }
  });
}

function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin/login',
      'Set-Cookie': 'hq_session=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax'
    }
  });
}

async function handleAdminDashboard(request, env) {
  if (!(await isAuthed(request, env))) {
    return new Response(null, { status: 302, headers: { 'Location': '/admin/login' } });
  }
  return html(renderAdminDashboard());
}

// ============================================================
// API CÔNG KHAI (trang chủ index.html gọi vào đây)
// ============================================================

async function apiPublicProducts(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM products WHERE hien_thi = 1 ORDER BY thu_tu ASC'
  ).all();
  return json(results || []);
}

async function apiPublicBanners(env) {
  const { results } = await env.DB.prepare('SELECT vi_tri, anh_url FROM banners').all();
  return json(results || []);
}

// ============================================================
// API QUẢN TRỊ — CRUD sản phẩm
// ============================================================

async function apiAdminListProducts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY thu_tu ASC').all();
  return json(results || []);
}

async function apiAdminCreateProduct(request, env) {
  const b = await request.json();
  const r = await env.DB.prepare(`
    INSERT INTO products (ten, slug, mo_ta_day_du, danh_muc, danh_muc_slug, anh_url, gia, gia_cu, vung_mien, danh_gia, da_ban, thu_tu, hien_thi)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    b.ten || '', b.slug || '', b.mo_ta_day_du || '', b.danh_muc || '', b.danh_muc_slug || '',
    b.anh_url || '', b.gia || 0, b.gia_cu || null, b.vung_mien || '', b.danh_gia || 5.0,
    b.da_ban || 0, b.thu_tu || 0, b.hien_thi ? 1 : 0
  ).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function apiAdminUpdateProduct(request, env, id) {
  const b = await request.json();
  await env.DB.prepare(`
    UPDATE products SET ten=?, slug=?, mo_ta_day_du=?, danh_muc=?, danh_muc_slug=?, anh_url=?, gia=?, gia_cu=?, vung_mien=?, danh_gia=?, da_ban=?, thu_tu=?, hien_thi=?
    WHERE id=?
  `).bind(
    b.ten || '', b.slug || '', b.mo_ta_day_du || '', b.danh_muc || '', b.danh_muc_slug || '',
    b.anh_url || '', b.gia || 0, b.gia_cu || null, b.vung_mien || '', b.danh_gia || 5.0,
    b.da_ban || 0, b.thu_tu || 0, b.hien_thi ? 1 : 0, id
  ).run();
  return json({ ok: true });
}

async function apiAdminDeleteProduct(env, id) {
  await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
  return json({ ok: true });
}

async function apiAdminGetBanners(env) {
  const { results } = await env.DB.prepare('SELECT * FROM banners').all();
  return json(results || []);
}

async function apiAdminSaveBanner(request, env) {
  const b = await request.json();
  await env.DB.prepare('INSERT INTO banners (vi_tri, anh_url) VALUES (?,?) ON CONFLICT(vi_tri) DO UPDATE SET anh_url=excluded.anh_url')
    .bind(b.vi_tri, b.anh_url || '').run();
  return json({ ok: true });
}

// ============================================================
// API CÔNG KHAI + QUẢN TRỊ — DANH MỤC (tuỳ biến thay cho danh mục cứng)
// ============================================================

async function apiPublicCategories(env) {
  const { results } = await env.DB.prepare('SELECT * FROM categories WHERE hien_thi=1 ORDER BY thu_tu ASC').all();
  return json(results || []);
}

async function apiAdminListCategories(env) {
  const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY thu_tu ASC').all();
  return json(results || []);
}

async function apiAdminCreateCategory(request, env) {
  const b = await request.json();
  const r = await env.DB.prepare('INSERT INTO categories (ten, slug, icon, mo_ta, thu_tu, hien_thi) VALUES (?,?,?,?,?,?)')
    .bind(b.ten || '', b.slug || '', b.icon || '🍃', b.mo_ta || '', b.thu_tu || 0, b.hien_thi ? 1 : 0).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function apiAdminUpdateCategory(request, env, id) {
  const b = await request.json();
  await env.DB.prepare('UPDATE categories SET ten=?, slug=?, icon=?, mo_ta=?, thu_tu=?, hien_thi=? WHERE id=?')
    .bind(b.ten || '', b.slug || '', b.icon || '🍃', b.mo_ta || '', b.thu_tu || 0, b.hien_thi ? 1 : 0, id).run();
  return json({ ok: true });
}

async function apiAdminDeleteCategory(env, id) {
  await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
  return json({ ok: true });
}

// ============================================================
// API CÔNG KHAI + QUẢN TRỊ — BÀI VIẾT (blog)
// ============================================================

async function apiPublicPosts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM posts WHERE hien_thi=1 ORDER BY thu_tu ASC').all();
  return json(results || []);
}

async function apiAdminListPosts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM posts ORDER BY thu_tu ASC').all();
  return json(results || []);
}

async function apiAdminCreatePost(request, env) {
  const b = await request.json();
  const r = await env.DB.prepare(`
    INSERT INTO posts (tieu_de, slug, tom_tat, noi_dung, anh_url, danh_muc, thu_tu, hien_thi)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    b.tieu_de || '', b.slug || '', b.tom_tat || '', b.noi_dung || '',
    b.anh_url || '', b.danh_muc || '', b.thu_tu || 0, b.hien_thi ? 1 : 0
  ).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function apiAdminUpdatePost(request, env, id) {
  const b = await request.json();
  await env.DB.prepare(`
    UPDATE posts SET tieu_de=?, slug=?, tom_tat=?, noi_dung=?, anh_url=?, danh_muc=?, thu_tu=?, hien_thi=?
    WHERE id=?
  `).bind(
    b.tieu_de || '', b.slug || '', b.tom_tat || '', b.noi_dung || '',
    b.anh_url || '', b.danh_muc || '', b.thu_tu || 0, b.hien_thi ? 1 : 0, id
  ).run();
  return json({ ok: true });
}

async function apiAdminDeletePost(env, id) {
  await env.DB.prepare('DELETE FROM posts WHERE id=?').bind(id).run();
  return json({ ok: true });
}

// ============================================================
// TRANG CÔNG KHAI ĐỘNG (dùng D1 thay Airtable)
// ============================================================

async function handleProductList(env) {
  const { results } = await env.DB.prepare('SELECT * FROM products WHERE hien_thi=1 ORDER BY thu_tu ASC').all();
  return html(renderListPage(results || [], 'Tất cả sản phẩm', 'Toàn bộ đặc sản Hương Quê đang có sẵn.'));
}

async function handleCategory(env, slug) {
  const { results } = await env.DB.prepare('SELECT * FROM products WHERE hien_thi=1 AND danh_muc_slug=? ORDER BY thu_tu ASC').bind(slug).all();
  const danhMucTen = results && results.length ? results[0].danh_muc : slug;
  return html(renderListPage(results || [], danhMucTen, `Toàn bộ sản phẩm thuộc danh mục "${danhMucTen}".`));
}

async function handleProductDetail(env, slug) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE slug=? LIMIT 1').bind(slug).first();
  if (!row) return html(renderNotFoundPage(slug), 404);
  return html(renderProductPage(row));
}

function cardHTML(p) {
  const off = p.gia_cu && p.gia_cu > p.gia ? Math.round((1 - p.gia / p.gia_cu) * 100) : null;
  const link = p.slug ? `/san-pham/${p.slug}` : '#';
  return `
    <a class="card" href="${link}">
      <div class="thumb">
        ${off ? `<span class="badge">-${off}%</span>` : ''}
        ${p.anh_url ? `<img src="${p.anh_url}" alt="${p.ten || ''}" loading="lazy">` : `<span class="ph">Chưa có ảnh</span>`}
      </div>
      <div class="body">
        <h3>${p.ten || 'Sản phẩm chưa đặt tên'}</h3>
        <div class="price">
          <span class="now">${formatVND(p.gia)}</span>
          ${p.gia_cu ? `<span class="old">${formatVND(p.gia_cu)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

function renderListPage(records, title, subtitle) {
  const grid = records.length ? records.map(cardHTML).join('') : `<p style="grid-column:1/-1; text-align:center; color:#8a8477; padding:40px 0;">Chưa có sản phẩm nào.</p>`;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Hương Quê</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16241C; --lacquer:#2E8B57; --gold-soft:#9CCC65; --paper:#FFFFFF; --paper-2:#EEF5F0; --jade:#1F6B41; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:1180px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(22,36,28,.12); }
  header .brand{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:20px; color:var(--lacquer); }
  .hero-title{ padding:36px 0 8px; }
  .back-link{ display:inline-block; margin-bottom:14px; font-size:13.5px; font-weight:600; color:var(--jade); }
  h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:clamp(22px,3vw,30px); }
  .sub{ color:#5a5548; margin:8px 0 30px; }
  .grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:20px; padding-bottom:60px; }
  .card{ background:#fff; border-radius:5px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,.07); transition:transform .15s; }
  .card:hover{ transform:translateY(-4px); }
  .thumb{ aspect-ratio:4/3; background:var(--paper-2); position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .thumb img{ width:100%; height:100%; object-fit:cover; }
  .thumb .ph{ font-size:12px; color:#a89f8c; font-weight:600; }
  .badge{ position:absolute; top:10px; left:10px; background:var(--lacquer); color:#fff; font-family:'Be Vietnam Pro'; font-size:11px; font-weight:800; padding:4px 8px; border-radius:3px; }
  .body{ padding:14px 16px 18px; }
  .body h3{ font-size:14.5px; font-weight:700; margin-bottom:8px; line-height:1.3; min-height:38px; }
  .price{ display:flex; align-items:baseline; gap:8px; }
  .now{ font-family:'Be Vietnam Pro'; font-weight:800; color:var(--lacquer); font-size:16px; }
  .old{ font-size:12.5px; color:#a29c8c; text-decoration:line-through; }
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(22,36,28,.1); }
  @media (max-width:980px){ .grid{ grid-template-columns:repeat(2,1fr); } }
  @media (max-width:560px){ .grid{ grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
  <header><div class="wrap"><a href="/" class="brand">Hương Quê</a></div></header>
  <div class="wrap">
    <div class="hero-title">
      <a href="/" class="back-link">← Về trang chủ</a>
      <h1>${title}</h1>
      <p class="sub">${subtitle}</p>
    </div>
    <div class="grid">${grid}</div>
  </div>
  <footer>© 2026 Hương Quê — Đặc sản quê nhà chính gốc.</footer>
</body>
</html>`;
}

function renderProductPage(p) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${p.ten} — Hương Quê</title>
<meta name="description" content="${(p.mo_ta_day_du || p.ten + ' — đặc sản chính gốc từ Hương Quê').slice(0,150).replace(/"/g,'')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16241C; --lacquer:#2E8B57; --gold:#7CB342; --gold-soft:#9CCC65; --paper:#FFFFFF; --paper-2:#EEF5F0; --jade:#1F6B41; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; line-height:1.55; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:960px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(22,36,28,.12); }
  header .brand{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:20px; color:var(--lacquer); }
  .back-link{ display:inline-block; margin:24px 0 8px; font-size:13.5px; font-weight:600; color:var(--jade); }
  .detail{ display:grid; grid-template-columns:1fr 1fr; gap:40px; padding:24px 0 60px; align-items:start; }
  .detail img{ width:100%; border-radius:6px; aspect-ratio:4/3; object-fit:cover; background:var(--paper-2); }
  .region{ font-size:12.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--lacquer); }
  h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:clamp(24px,3.4vw,34px); margin:10px 0 16px; line-height:1.15; }
  .price-row{ display:flex; align-items:baseline; gap:12px; margin-bottom:22px; }
  .price-now{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:26px; color:var(--lacquer); }
  .price-old{ font-size:15px; color:#a29c8c; text-decoration:line-through; }
  .desc{ color:#4a453b; margin-bottom:26px; white-space:pre-line; }
  .btn{ display:inline-flex; padding:14px 28px; border-radius:4px; font-weight:700; font-size:14.5px; cursor:pointer; border:1.5px solid transparent; }
  .btn-primary{ background:var(--lacquer); color:var(--paper); box-shadow:0 8px 20px rgba(46,139,87,.32); }
  .btn-ghost{ background:transparent; color:var(--lacquer); border-color:var(--lacquer); }
  .btn-row{ display:flex; gap:12px; flex-wrap:wrap; }
  .contact-box{ margin-top:20px; display:none; flex-direction:column; gap:10px; max-width:420px; }
  .contact-box.open{ display:flex; }
  .contact-option{
    display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:6px; border:1.5px solid rgba(22,36,28,.12);
    background:#fff; text-decoration:none; color:var(--ink); transition:border-color .15s ease, transform .15s ease;
  }
  .contact-option:hover{ border-color:#7CB342; transform:translateY(-1px); }
  .contact-option .ico{ width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:18px; }
  .contact-option .ico.zalo{ background:#e6f2fc; color:#0068ff; }
  .contact-option .ico.fb{ background:#e8eefc; color:#0866ff; }
  .contact-option .ico.phone{ background:rgba(31,107,65,.12); color:var(--jade); }
  .contact-option .txt strong{ display:block; font-size:14.5px; font-weight:700; }
  .contact-option .txt span{ font-size:12.5px; color:#8a8477; }
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(22,36,28,.1); }
  @media (max-width:720px){ .detail{ grid-template-columns:1fr; } }
</style>
</head>
<body>
  <header><div class="wrap"><a href="/" class="brand">Hương Quê</a></div></header>
  <div class="wrap">
    <a href="/" class="back-link">← Về trang chủ</a>
    <div class="detail">
      <div>${p.anh_url ? `<img src="${p.anh_url}" alt="${p.ten}">` : `<div style="aspect-ratio:4/3;background:var(--paper-2);border-radius:6px;"></div>`}</div>
      <div>
        ${p.vung_mien ? `<span class="region">${p.vung_mien}</span>` : ''}
        <h1>${p.ten}</h1>
        <div class="price-row">
          <span class="price-now">${formatVND(p.gia)}</span>
          ${p.gia_cu ? `<span class="price-old">${formatVND(p.gia_cu)}</span>` : ''}
        </div>
        <p class="desc">${p.mo_ta_day_du || 'Đặc sản chính gốc, đóng gói cẩn thận, giao tận nơi trong 24–48h.'}</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="buyNow">Mua ngay</button>
          <button class="btn btn-ghost" id="addCart">Thêm vào giỏ</button>
        </div>
        <div class="contact-box" id="contactBox">
          <a href="#" id="contactZalo" class="contact-option" target="_blank" rel="noopener">
            <span class="ico zalo">💬</span>
            <span class="txt"><strong>Nhắn Zalo</strong><span>Chat trực tiếp với shop qua Zalo</span></span>
          </a>
          <a href="#" id="contactMessenger" class="contact-option" target="_blank" rel="noopener">
            <span class="ico fb">📩</span>
            <span class="txt"><strong>Nhắn Messenger</strong><span>Chat qua Fanpage Facebook</span></span>
          </a>
          <a href="#" id="contactPhone" class="contact-option">
            <span class="ico phone">📞</span>
            <span class="txt"><strong>Gọi điện đặt hàng</strong><span>Gọi trực tiếp hotline</span></span>
          </a>
        </div>
      </div>
    </div>
  </div>
  <footer>© 2026 Hương Quê — Đặc sản quê nhà chính gốc.</footer>

  <script>
    const ZALO_PHONE = "0909123456";
    const FACEBOOK_PAGE = "ten.fanpage.cua.ban";
    const HOTLINE_PHONE = "0909123456";
    const PRODUCT_NAME = ${JSON.stringify(p.ten)};

    function openContactBox(intentText){
      document.getElementById('contactZalo').href = 'https://zalo.me/' + ZALO_PHONE;
      document.getElementById('contactMessenger').href = 'https://m.me/' + FACEBOOK_PAGE + '?text=' + encodeURIComponent(intentText);
      document.getElementById('contactPhone').href = 'tel:' + HOTLINE_PHONE;
      document.getElementById('contactBox').classList.add('open');
    }
    document.getElementById('buyNow').addEventListener('click', () => openContactBox('Chào shop, mình muốn MUA NGAY: ' + PRODUCT_NAME));
    document.getElementById('addCart').addEventListener('click', () => openContactBox('Chào shop, mình muốn thêm vào giỏ hàng: ' + PRODUCT_NAME));
  </script>
</body>
</html>`;
}

function renderNotFoundPage(slug) {
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><title>Không tìm thấy sản phẩm — Hương Quê</title>
<style>body{font-family:sans-serif; text-align:center; padding:80px 20px; background:#FFFFFF; color:#16241C;}
a{color:#2E8B57; font-weight:700;}</style></head>
<body>
  <h1>Không tìm thấy sản phẩm "${slug}"</h1>
  <p>Sản phẩm có thể đã ngừng bán hoặc đường dẫn không đúng.</p>
  <p><a href="/">← Quay về trang chủ</a></p>
</body></html>`;
}

// ============================================================
// TRANG BLOG CÔNG KHAI — /tin-tuc, /tin-tuc/:slug
// ============================================================

async function handlePostList(env) {
  const { results } = await env.DB.prepare('SELECT * FROM posts WHERE hien_thi=1 ORDER BY thu_tu ASC').all();
  const posts = results || [];
  const cards = posts.length ? posts.map(p => `
    <a class="pcard" href="/tin-tuc/${p.slug}">
      <div class="pthumb">${p.anh_url ? `<img src="${p.anh_url}" alt="${p.tieu_de}" loading="lazy">` : `<span class="ph">Chưa có ảnh</span>`}</div>
      <div class="pbody">
        ${p.danh_muc ? `<span class="ptag">${p.danh_muc}</span>` : ''}
        <h3>${p.tieu_de}</h3>
        <p>${(p.tom_tat || '').slice(0,120)}</p>
      </div>
    </a>`).join('') : `<p style="grid-column:1/-1; text-align:center; color:#8a8477; padding:40px 0;">Chưa có bài viết nào.</p>`;

  return html(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Góc ẩm thực — Hương Quê</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16241C; --lacquer:#2E8B57; --paper:#FFFFFF; --paper-2:#EEF5F0; --jade:#1F6B41; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:1180px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(22,36,28,.12); }
  header .brand{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:20px; color:var(--lacquer); }
  .hero-title{ padding:36px 0 8px; }
  .back-link{ display:inline-block; margin-bottom:14px; font-size:13.5px; font-weight:600; color:var(--jade); }
  h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:clamp(22px,3vw,30px); margin-bottom:30px; }
  .grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:22px; padding-bottom:60px; }
  .pcard{ background:#fff; border-radius:6px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,.06); transition:transform .15s; }
  .pcard:hover{ transform:translateY(-4px); }
  .pthumb{ aspect-ratio:16/10; background:var(--paper-2); display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .pthumb img{ width:100%; height:100%; object-fit:cover; }
  .pthumb .ph{ font-size:12px; color:#a89f8c; }
  .pbody{ padding:18px 20px 20px; }
  .ptag{ font-size:11px; font-weight:700; color:var(--jade); text-transform:uppercase; letter-spacing:.06em; }
  .pbody h3{ font-size:16px; margin:8px 0 10px; line-height:1.35; }
  .pbody p{ font-size:13.5px; color:#78725f; }
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(22,36,28,.1); }
  @media (max-width:900px){ .grid{ grid-template-columns:1fr 1fr; } }
  @media (max-width:560px){ .grid{ grid-template-columns:1fr; } }
</style>
</head>
<body>
  <header><div class="wrap"><a href="/" class="brand">Hương Quê</a></div></header>
  <div class="wrap">
    <div class="hero-title">
      <a href="/" class="back-link">← Về trang chủ</a>
      <h1>Góc ẩm thực — Chuyện quê, vị nhà</h1>
    </div>
    <div class="grid">${cards}</div>
  </div>
  <footer>© 2026 Hương Quê — Đặc sản quê nhà chính gốc.</footer>
</body>
</html>`);
}

async function handlePostDetail(env, slug) {
  const p = await env.DB.prepare('SELECT * FROM posts WHERE slug=? LIMIT 1').bind(slug).first();
  if (!p) {
    return html(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Không tìm thấy bài viết — Hương Quê</title>
    <style>body{font-family:sans-serif; text-align:center; padding:80px 20px; background:#FFFFFF; color:#16241C;} a{color:#2E8B57; font-weight:700;}</style></head>
    <body><h1>Không tìm thấy bài viết "${slug}"</h1><p><a href="/tin-tuc">← Về trang Góc ẩm thực</a></p></body></html>`, 404);
  }

  return html(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${p.tieu_de} — Hương Quê</title>
<meta name="description" content="${(p.tom_tat || '').slice(0,150).replace(/"/g,'')}">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16241C; --lacquer:#2E8B57; --paper:#FFFFFF; --paper-2:#EEF5F0; --jade:#1F6B41; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; line-height:1.7; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:760px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(22,36,28,.12); }
  header .brand{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:20px; color:var(--lacquer); }
  .back-link{ display:inline-block; margin:24px 0 18px; font-size:13.5px; font-weight:600; color:var(--jade); }
  .ptag{ font-size:11.5px; font-weight:700; color:var(--jade); text-transform:uppercase; letter-spacing:.06em; }
  h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:clamp(24px,3.6vw,36px); margin:10px 0 20px; line-height:1.2; }
  .cover{ width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:8px; background:var(--paper-2); margin-bottom:26px; }
  .content{ color:#332f28; font-size:16px; white-space:pre-line; padding-bottom:60px; }
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(22,36,28,.1); }
</style>
</head>
<body>
  <header><div class="wrap"><a href="/" class="brand">Hương Quê</a></div></header>
  <div class="wrap">
    <a href="/tin-tuc" class="back-link">← Về Góc ẩm thực</a>
    ${p.danh_muc ? `<div class="ptag">${p.danh_muc}</div>` : ''}
    <h1>${p.tieu_de}</h1>
    ${p.anh_url ? `<img class="cover" src="${p.anh_url}" alt="${p.tieu_de}">` : ''}
    <div class="content">${p.noi_dung || p.tom_tat || ''}</div>
  </div>
  <footer>© 2026 Hương Quê — Đặc sản quê nhà chính gốc.</footer>
</body>
</html>`);
}

// ============================================================
// TRANG ĐĂNG NHẬP ADMIN
// ============================================================

function renderLoginPage(errorMsg) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Đăng nhập quản trị — Hương Quê</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ min-height:100vh; display:flex; align-items:center; justify-content:center; background:#EEF5F0; font-family:'Inter',sans-serif; }
  .card{ background:#fff; padding:40px 36px; border-radius:8px; box-shadow:0 12px 30px rgba(22,36,28,.12); width:100%; max-width:360px; }
  h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:22px; color:#2E8B57; margin-bottom:6px; }
  p{ color:#5a5548; font-size:13.5px; margin-bottom:22px; }
  input{ width:100%; padding:12px 14px; border:1.5px solid rgba(22,36,28,.15); border-radius:5px; font-size:14px; margin-bottom:14px; }
  button{ width:100%; padding:13px; border:none; border-radius:5px; background:#2E8B57; color:#fff; font-weight:700; font-size:14.5px; cursor:pointer; }
  .err{ color:#c0392b; font-size:13px; margin-bottom:12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Hương Quê</h1>
    <p>Đăng nhập trang quản trị sản phẩm</p>
    ${errorMsg ? `<div class="err">${errorMsg}</div>` : ''}
    <form method="POST" action="/admin/login">
      <input type="password" name="password" placeholder="Mật khẩu quản trị" required autofocus>
      <button type="submit">Đăng nhập</button>
    </form>
  </div>
</body>
</html>`;
}

// ============================================================
// DASHBOARD QUẢN TRỊ — quản lý sản phẩm + banner
// ============================================================

function renderAdminDashboard() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quản trị — Hương Quê</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16241C; --green:#2E8B57; --green-dark:#1F6B41; --bg:#EEF5F0; --line:rgba(22,36,28,.12); }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--bg); color:var(--ink); font-family:'Inter',sans-serif; }
  header{ background:#fff; padding:16px 28px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); }
  header h1{ font-family:'Be Vietnam Pro'; font-weight:800; font-size:19px; color:var(--green); }
  header a{ color:#8a8477; font-size:13.5px; text-decoration:none; font-weight:600; }
  .wrap{ max-width:1100px; margin:0 auto; padding:28px; }
  .section{ background:#fff; border-radius:8px; padding:24px; margin-bottom:24px; box-shadow:0 2px 10px rgba(22,36,28,.05); }
  .section-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
  .section-head h2{ font-family:'Be Vietnam Pro'; font-weight:700; font-size:16px; }
  .btn{ padding:10px 18px; border-radius:5px; border:none; font-weight:700; font-size:13.5px; cursor:pointer; }
  .btn-primary{ background:var(--green); color:#fff; }
  .btn-ghost{ background:transparent; border:1.5px solid var(--line); color:var(--ink); }
  .btn-danger{ background:#fdecea; color:#c0392b; }
  .btn-sm{ padding:6px 12px; font-size:12.5px; }
  table{ width:100%; border-collapse:collapse; font-size:13.5px; }
  th{ text-align:left; padding:10px 8px; color:#8a8477; font-weight:600; border-bottom:1px solid var(--line); }
  td{ padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:middle; }
  td img{ width:48px; height:48px; object-fit:cover; border-radius:4px; background:var(--bg); }
  .badge-off{ display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }
  .badge-on{ background:#e6f4ea; color:#1F6B41; }
  .badge-hidden{ background:#f4f4f4; color:#999; }
  .actions{ display:flex; gap:8px; }

  /* modal */
  .overlay{ position:fixed; inset:0; background:rgba(22,36,28,.5); display:none; align-items:center; justify-content:center; padding:20px; z-index:50; }
  .overlay.open{ display:flex; }
  .modal{ background:#fff; border-radius:8px; width:100%; max-width:520px; max-height:90vh; overflow-y:auto; padding:26px; }
  .modal h3{ font-family:'Be Vietnam Pro'; font-weight:700; font-size:17px; margin-bottom:18px; }
  .field{ margin-bottom:14px; }
  .field label{ display:block; font-size:12.5px; font-weight:700; color:#5a5548; margin-bottom:5px; }
  .field input, .field textarea, .field select{ width:100%; padding:10px 12px; border:1.5px solid var(--line); border-radius:5px; font-size:13.5px; font-family:'Inter'; }
  .field textarea{ min-height:70px; resize:vertical; }
  .row2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .img-preview{ width:100%; aspect-ratio:4/3; background:var(--bg); border-radius:6px; overflow:hidden; margin-bottom:10px; display:flex; align-items:center; justify-content:center; }
  .img-preview img{ width:100%; height:100%; object-fit:cover; }
  .modal-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
  .checkbox-row{ display:flex; align-items:center; gap:8px; }
  .checkbox-row input{ width:auto; }
  .banner-row{ display:flex; gap:20px; flex-wrap:wrap; }
  .banner-item{ flex:1; min-width:220px; }
  .banner-item .img-preview{ aspect-ratio:16/9; }
  .empty{ color:#8a8477; text-align:center; padding:30px 0; }
</style>
</head>
<body>
  <header>
    <h1>Hương Quê — Quản trị</h1>
    <a href="/admin/logout">Đăng xuất</a>
  </header>

  <div class="wrap">
    <div class="section">
      <div class="section-head">
        <h2>Banner trang chủ</h2>
      </div>
      <div class="banner-row" id="bannerRow"></div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Danh mục sản phẩm</h2>
        <button class="btn btn-primary" id="btnAddCategory">+ Thêm danh mục</button>
      </div>
      <table>
        <thead><tr><th>Icon</th><th>Tên</th><th>Slug (URL)</th><th>Mô tả ngắn</th><th>Thứ tự</th><th>Hiển thị</th><th></th></tr></thead>
        <tbody id="categoryTableBody"></tbody>
      </table>
      <div id="categoryEmptyState" class="empty" style="display:none;">Chưa có danh mục nào.</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Bài viết (Góc ẩm thực)</h2>
        <button class="btn btn-primary" id="btnAddPost">+ Thêm bài viết</button>
      </div>
      <table>
        <thead><tr><th>Ảnh</th><th>Tiêu đề</th><th>Danh mục</th><th>Hiển thị</th><th></th></tr></thead>
        <tbody id="postTableBody"></tbody>
      </table>
      <div id="postEmptyState" class="empty" style="display:none;">Chưa có bài viết nào.</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Sản phẩm</h2>
        <button class="btn btn-primary" id="btnAddProduct">+ Thêm sản phẩm</button>
      </div>
      <table>
        <thead><tr><th>Ảnh</th><th>Tên</th><th>Danh mục</th><th>Giá</th><th>Hiển thị</th><th></th></tr></thead>
        <tbody id="productTableBody"></tbody>
      </table>
      <div id="emptyState" class="empty" style="display:none;">Chưa có sản phẩm nào. Bấm "+ Thêm sản phẩm" để bắt đầu.</div>
    </div>
  </div>

  <!-- Modal thêm/sửa danh mục -->
  <div class="overlay" id="categoryModal">
    <div class="modal">
      <h3 id="categoryModalTitle">Thêm danh mục</h3>
      <div class="field"><label>Icon (emoji)</label><input id="c-icon" placeholder="🍖" maxlength="4"></div>
      <div class="row2">
        <div class="field"><label>Tên danh mục</label><input id="c-ten" placeholder="Chả & Nem"></div>
        <div class="field"><label>Slug (URL)</label><input id="c-slug" placeholder="cha-nem"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Mô tả ngắn</label><input id="c-mota" placeholder="Bình Định, Huế"></div>
        <div class="field"><label>Thứ tự hiển thị</label><input id="c-thutu" type="number" placeholder="1"></div>
      </div>
      <div class="field checkbox-row"><input type="checkbox" id="c-hienthi" checked><label style="margin:0;">Hiển thị trên website</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="btnCategoryCancel">Huỷ</button>
        <button class="btn btn-primary" id="btnCategorySave">Lưu danh mục</button>
      </div>
    </div>
  </div>

  <!-- Modal thêm/sửa bài viết -->
  <div class="overlay" id="postModal">
    <div class="modal">
      <h3 id="postModalTitle">Thêm bài viết</h3>
      <div class="img-preview" id="postImgPreview"><span style="color:#a89f8c; font-size:12.5px;">Chưa có ảnh</span></div>
      <div class="field"><input type="file" id="p-image" accept="image/*"></div>
      <div class="field"><label>Tiêu đề bài viết</label><input id="p-tieude" placeholder="Cách chọn chả lụa ngon"></div>
      <div class="row2">
        <div class="field"><label>Slug (URL)</label><input id="p-slug" placeholder="cach-chon-cha-lua-ngon"></div>
        <div class="field"><label>Danh mục / Nhãn</label><input id="p-danhmuc" placeholder="Mẹo vào bếp"></div>
      </div>
      <div class="field"><label>Tóm tắt (hiện ở trang danh sách)</label><textarea id="p-tomtat" placeholder="Tóm tắt ngắn gọn..."></textarea></div>
      <div class="field"><label>Nội dung đầy đủ</label><textarea id="p-noidung" style="min-height:140px;" placeholder="Nội dung bài viết..."></textarea></div>
      <div class="field"><label>Thứ tự hiển thị</label><input id="p-thutu" type="number" placeholder="1"></div>
      <div class="field checkbox-row"><input type="checkbox" id="p-hienthi" checked><label style="margin:0;">Hiển thị trên website</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="btnPostCancel">Huỷ</button>
        <button class="btn btn-primary" id="btnPostSave">Lưu bài viết</button>
      </div>
    </div>
  </div>

  <!-- Modal thêm/sửa sản phẩm -->
  <div class="overlay" id="productModal">
    <div class="modal">
      <h3 id="modalTitle">Thêm sản phẩm</h3>
      <div class="img-preview" id="imgPreview"><span style="color:#a89f8c; font-size:12.5px;">Chưa có ảnh</span></div>
      <div class="field"><input type="file" id="f-image" accept="image/*"></div>
      <div class="field"><label>Tên sản phẩm</label><input id="f-ten" placeholder="Chả Lụa Truyền Thống"></div>
      <div class="row2">
        <div class="field"><label>Slug (URL)</label><input id="f-slug" placeholder="cha-lua-truyen-thong"></div>
        <div class="field"><label>Vùng miền</label><input id="f-vungmien" placeholder="Bình Định"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Danh mục (tên hiện)</label><input id="f-danhmuc" placeholder="Chả & Nem"></div>
        <div class="field"><label>Danh mục (slug URL)</label><input id="f-danhmucslug" placeholder="cha-nem"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Giá bán</label><input id="f-gia" type="number" placeholder="98000"></div>
        <div class="field"><label>Giá gốc (nếu giảm giá)</label><input id="f-giacu" type="number" placeholder="120000"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Thứ tự hiển thị</label><input id="f-thutu" type="number" placeholder="1"></div>
        <div class="field"><label>Đã bán</label><input id="f-daban" type="number" placeholder="0"></div>
      </div>
      <div class="field"><label>Mô tả chi tiết</label><textarea id="f-mota" placeholder="Mô tả sản phẩm..."></textarea></div>
      <div class="field checkbox-row"><input type="checkbox" id="f-hienthi" checked><label style="margin:0;">Hiển thị trên website</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="btnCancel">Huỷ</button>
        <button class="btn btn-primary" id="btnSave">Lưu sản phẩm</button>
      </div>
    </div>
  </div>

<script>
  // ⚠️ CẤU HÌNH CLOUDINARY — điền 2 giá trị này sau khi tạo tài khoản (xem HUONG-DAN-SETUP-ADMIN.md)
  const CLOUDINARY_CLOUD_NAME = "DÁN_CLOUD_NAME_VÀO_ĐÂY";
  const CLOUDINARY_UPLOAD_PRESET = "DÁN_UPLOAD_PRESET_VÀO_ĐÂY";

  let editingId = null;
  let currentImageUrl = '';

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/admin/login'; return; }
    return res.json();
  }

  async function uploadToCloudinary(file) {
    if (CLOUDINARY_CLOUD_NAME.includes('DÁN_')) {
      alert('Chưa cấu hình Cloudinary — xem hướng dẫn trong HUONG-DAN-SETUP-ADMIN.md');
      return null;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      const res = await fetch(\`https://api.cloudinary.com/v1_1/\${CLOUDINARY_CLOUD_NAME}/image/upload\`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.secure_url) {
        alert('Upload ảnh thất bại: ' + (data.error?.message || 'Kiểm tra lại Cloud name / Upload preset trong src/index.js.'));
        return null;
      }
      return data.secure_url;
    } catch (err) {
      alert('Lỗi kết nối tới Cloudinary: ' + err.message);
      return null;
    }
  }

  // ===== Banner =====
  async function loadBanners() {
    const banners = await api('/api/admin/banners') || [];
    const map = {};
    banners.forEach(b => map[b.vi_tri] = b.anh_url);
    const slots = [
      { key: 'hero', label: 'Banner lớn đầu trang' },
      { key: 'story', label: 'Ảnh phần "Câu chuyện Hương Quê"' }
    ];
    document.getElementById('bannerRow').innerHTML = slots.map(s => \`
      <div class="banner-item">
        <div class="img-preview" id="bp-\${s.key}">\${map[s.key] ? \`<img src="\${map[s.key]}">\` : '<span style="color:#a89f8c;font-size:12.5px;">Chưa có ảnh</span>'}</div>
        <label style="font-size:12.5px;font-weight:700;color:#5a5548;display:block;margin-bottom:6px;">\${s.label}</label>
        <input type="file" accept="image/*" onchange="uploadBanner('\${s.key}', this)">
      </div>\`).join('');
  }

  async function uploadBanner(slot, input) {
    const file = input.files[0];
    if (!file) return;
    const url = await uploadToCloudinary(file);
    if (!url) return;
    await api('/api/admin/banners', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ vi_tri: slot, anh_url: url }) });
    loadBanners();
  }

  // ===== Sản phẩm =====
  async function loadProducts() {
    const products = await api('/api/admin/products') || [];
    const tbody = document.getElementById('productTableBody');
    document.getElementById('emptyState').style.display = products.length ? 'none' : 'block';
    tbody.innerHTML = products.map(p => \`
      <tr>
        <td>\${p.anh_url ? \`<img src="\${p.anh_url}">\` : ''}</td>
        <td>\${p.ten}</td>
        <td>\${p.danh_muc || ''}</td>
        <td>\${Number(p.gia).toLocaleString('vi-VN')}₫</td>
        <td><span class="badge-off \${p.hien_thi ? 'badge-on' : 'badge-hidden'}">\${p.hien_thi ? 'Đang hiện' : 'Đang ẩn'}</span></td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="editProduct(\${p.id})">Sửa</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct(\${p.id})">Xoá</button>
        </td>
      </tr>\`).join('');
    window._products = products;
  }

  function openModal(product) {
    editingId = product ? product.id : null;
    currentImageUrl = product ? (product.anh_url || '') : '';
    document.getElementById('modalTitle').textContent = product ? 'Sửa sản phẩm' : 'Thêm sản phẩm';
    document.getElementById('imgPreview').innerHTML = currentImageUrl ? \`<img src="\${currentImageUrl}">\` : '<span style="color:#a89f8c;font-size:12.5px;">Chưa có ảnh</span>';
    document.getElementById('f-image').value = '';
    document.getElementById('f-ten').value = product?.ten || '';
    document.getElementById('f-slug').value = product?.slug || '';
    document.getElementById('f-vungmien').value = product?.vung_mien || '';
    document.getElementById('f-danhmuc').value = product?.danh_muc || '';
    document.getElementById('f-danhmucslug').value = product?.danh_muc_slug || '';
    document.getElementById('f-gia').value = product?.gia || '';
    document.getElementById('f-giacu').value = product?.gia_cu || '';
    document.getElementById('f-thutu').value = product?.thu_tu || '';
    document.getElementById('f-daban').value = product?.da_ban || '';
    document.getElementById('f-mota').value = product?.mo_ta_day_du || '';
    document.getElementById('f-hienthi').checked = product ? !!product.hien_thi : true;
    document.getElementById('productModal').classList.add('open');
  }

  document.getElementById('btnAddProduct').addEventListener('click', () => openModal(null));
  document.getElementById('btnCancel').addEventListener('click', () => document.getElementById('productModal').classList.remove('open'));

  document.getElementById('f-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('imgPreview').innerHTML = 'Đang tải ảnh lên...';
    const url = await uploadToCloudinary(file);
    if (!url) { document.getElementById('imgPreview').innerHTML = currentImageUrl ? \`<img src="\${currentImageUrl}">\` : 'Chưa có ảnh'; return; }
    currentImageUrl = url;
    document.getElementById('imgPreview').innerHTML = \`<img src="\${currentImageUrl}">\`;
  });

  document.getElementById('btnSave').addEventListener('click', async () => {
    const payload = {
      ten: document.getElementById('f-ten').value,
      slug: document.getElementById('f-slug').value,
      vung_mien: document.getElementById('f-vungmien').value,
      danh_muc: document.getElementById('f-danhmuc').value,
      danh_muc_slug: document.getElementById('f-danhmucslug').value,
      gia: Number(document.getElementById('f-gia').value) || 0,
      gia_cu: Number(document.getElementById('f-giacu').value) || null,
      thu_tu: Number(document.getElementById('f-thutu').value) || 0,
      da_ban: Number(document.getElementById('f-daban').value) || 0,
      mo_ta_day_du: document.getElementById('f-mota').value,
      hien_thi: document.getElementById('f-hienthi').checked,
      anh_url: currentImageUrl
    };
    if (!payload.ten || !payload.slug) { alert('Vui lòng nhập Tên và Slug.'); return; }

    if (editingId) {
      await api('/api/admin/products/' + editingId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    } else {
      await api('/api/admin/products', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    }
    document.getElementById('productModal').classList.remove('open');
    loadProducts();
  });

  function editProduct(id) {
    const p = window._products.find(x => x.id === id);
    if (p) openModal(p);
  }
  async function deleteProduct(id) {
    if (!confirm('Xoá sản phẩm này? Không thể hoàn tác.')) return;
    await api('/api/admin/products/' + id, { method: 'DELETE' });
    loadProducts();
  }

  // ===== Danh mục =====
  let editingCategoryId = null;

  async function loadCategories() {
    const cats = await api('/api/admin/categories') || [];
    const tbody = document.getElementById('categoryTableBody');
    document.getElementById('categoryEmptyState').style.display = cats.length ? 'none' : 'block';
    tbody.innerHTML = cats.map(c => \`
      <tr>
        <td style="font-size:20px;">\${c.icon || ''}</td>
        <td>\${c.ten}</td>
        <td>\${c.slug}</td>
        <td>\${c.mo_ta || ''}</td>
        <td>\${c.thu_tu}</td>
        <td><span class="badge-off \${c.hien_thi ? 'badge-on' : 'badge-hidden'}">\${c.hien_thi ? 'Đang hiện' : 'Đang ẩn'}</span></td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="editCategory(\${c.id})">Sửa</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCategory(\${c.id})">Xoá</button>
        </td>
      </tr>\`).join('');
    window._categories = cats;
  }

  function openCategoryModal(cat) {
    editingCategoryId = cat ? cat.id : null;
    document.getElementById('categoryModalTitle').textContent = cat ? 'Sửa danh mục' : 'Thêm danh mục';
    document.getElementById('c-icon').value = cat?.icon || '🍃';
    document.getElementById('c-ten').value = cat?.ten || '';
    document.getElementById('c-slug').value = cat?.slug || '';
    document.getElementById('c-mota').value = cat?.mo_ta || '';
    document.getElementById('c-thutu').value = cat?.thu_tu || '';
    document.getElementById('c-hienthi').checked = cat ? !!cat.hien_thi : true;
    document.getElementById('categoryModal').classList.add('open');
  }

  document.getElementById('btnAddCategory').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('btnCategoryCancel').addEventListener('click', () => document.getElementById('categoryModal').classList.remove('open'));
  document.getElementById('btnCategorySave').addEventListener('click', async () => {
    const payload = {
      icon: document.getElementById('c-icon').value || '🍃',
      ten: document.getElementById('c-ten').value,
      slug: document.getElementById('c-slug').value,
      mo_ta: document.getElementById('c-mota').value,
      thu_tu: Number(document.getElementById('c-thutu').value) || 0,
      hien_thi: document.getElementById('c-hienthi').checked
    };
    if (!payload.ten || !payload.slug) { alert('Vui lòng nhập Tên và Slug.'); return; }
    if (editingCategoryId) {
      await api('/api/admin/categories/' + editingCategoryId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    } else {
      await api('/api/admin/categories', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    }
    document.getElementById('categoryModal').classList.remove('open');
    loadCategories();
  });
  function editCategory(id) {
    const c = window._categories.find(x => x.id === id);
    if (c) openCategoryModal(c);
  }
  async function deleteCategory(id) {
    if (!confirm('Xoá danh mục này? Sản phẩm đã gán danh mục này sẽ không bị xoá, chỉ mất liên kết hiển thị.')) return;
    await api('/api/admin/categories/' + id, { method: 'DELETE' });
    loadCategories();
  }

  // ===== Bài viết =====
  let editingPostId = null;
  let currentPostImageUrl = '';

  async function loadPosts() {
    const posts = await api('/api/admin/posts') || [];
    const tbody = document.getElementById('postTableBody');
    document.getElementById('postEmptyState').style.display = posts.length ? 'none' : 'block';
    tbody.innerHTML = posts.map(p => \`
      <tr>
        <td>\${p.anh_url ? \`<img src="\${p.anh_url}">\` : ''}</td>
        <td>\${p.tieu_de}</td>
        <td>\${p.danh_muc || ''}</td>
        <td><span class="badge-off \${p.hien_thi ? 'badge-on' : 'badge-hidden'}">\${p.hien_thi ? 'Đang hiện' : 'Đang ẩn'}</span></td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="editPost(\${p.id})">Sửa</button>
          <button class="btn btn-danger btn-sm" onclick="deletePost(\${p.id})">Xoá</button>
        </td>
      </tr>\`).join('');
    window._posts = posts;
  }

  function openPostModal(post) {
    editingPostId = post ? post.id : null;
    currentPostImageUrl = post ? (post.anh_url || '') : '';
    document.getElementById('postModalTitle').textContent = post ? 'Sửa bài viết' : 'Thêm bài viết';
    document.getElementById('postImgPreview').innerHTML = currentPostImageUrl ? \`<img src="\${currentPostImageUrl}">\` : '<span style="color:#a89f8c;font-size:12.5px;">Chưa có ảnh</span>';
    document.getElementById('p-image').value = '';
    document.getElementById('p-tieude').value = post?.tieu_de || '';
    document.getElementById('p-slug').value = post?.slug || '';
    document.getElementById('p-danhmuc').value = post?.danh_muc || '';
    document.getElementById('p-tomtat').value = post?.tom_tat || '';
    document.getElementById('p-noidung').value = post?.noi_dung || '';
    document.getElementById('p-thutu').value = post?.thu_tu || '';
    document.getElementById('p-hienthi').checked = post ? !!post.hien_thi : true;
    document.getElementById('postModal').classList.add('open');
  }

  document.getElementById('btnAddPost').addEventListener('click', () => openPostModal(null));
  document.getElementById('btnPostCancel').addEventListener('click', () => document.getElementById('postModal').classList.remove('open'));

  document.getElementById('p-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('postImgPreview').innerHTML = 'Đang tải ảnh lên...';
    const url = await uploadToCloudinary(file);
    if (!url) { document.getElementById('postImgPreview').innerHTML = currentPostImageUrl ? \`<img src="\${currentPostImageUrl}">\` : '<span style="color:#a89f8c;font-size:12.5px;">Chưa có ảnh</span>'; return; }
    currentPostImageUrl = url;
    document.getElementById('postImgPreview').innerHTML = \`<img src="\${currentPostImageUrl}">\`;
  });

  document.getElementById('btnPostSave').addEventListener('click', async () => {
    const payload = {
      tieu_de: document.getElementById('p-tieude').value,
      slug: document.getElementById('p-slug').value,
      danh_muc: document.getElementById('p-danhmuc').value,
      tom_tat: document.getElementById('p-tomtat').value,
      noi_dung: document.getElementById('p-noidung').value,
      thu_tu: Number(document.getElementById('p-thutu').value) || 0,
      hien_thi: document.getElementById('p-hienthi').checked,
      anh_url: currentPostImageUrl
    };
    if (!payload.tieu_de || !payload.slug) { alert('Vui lòng nhập Tiêu đề và Slug.'); return; }
    if (editingPostId) {
      await api('/api/admin/posts/' + editingPostId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    } else {
      await api('/api/admin/posts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    }
    document.getElementById('postModal').classList.remove('open');
    loadPosts();
  });
  function editPost(id) {
    const p = window._posts.find(x => x.id === id);
    if (p) openPostModal(p);
  }
  async function deletePost(id) {
    if (!confirm('Xoá bài viết này? Không thể hoàn tác.')) return;
    await api('/api/admin/posts/' + id, { method: 'DELETE' });
    loadPosts();
  }

  loadBanners();
  loadCategories();
  loadPosts();
  loadProducts();
</script>
</body>
</html>`;
}
