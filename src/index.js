/**
 * WORKER CHÍNH — xử lý các URL động, còn lại (index.html, ảnh...) tự động được
 * phục vụ tĩnh qua "assets" khai báo trong wrangler.jsonc, không cần code gì thêm.
 *
 * Route xử lý trong file này:
 *   /san-pham          → xem toàn bộ sản phẩm
 *   /san-pham/:slug     → chi tiết 1 sản phẩm
 *   /danh-muc/:slug     → lọc sản phẩm theo danh mục
 *
 * ⚙️ CẦN KHAI BÁO Environment Variables trong Cloudflare Dashboard
 * (Project > Settings > Variables and Secrets):
 *   AIRTABLE_BASE_ID, AIRTABLE_TOKEN (Encrypt), AIRTABLE_TABLE = SanPham
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // bỏ dấu / thừa ở cuối

    if (path === '/san-pham') {
      return handleProductList(env);
    }
    if (path.startsWith('/san-pham/')) {
      const slug = decodeURIComponent(path.slice('/san-pham/'.length));
      return handleProductDetail(env, slug);
    }
    if (path.startsWith('/danh-muc/')) {
      const slug = decodeURIComponent(path.slice('/danh-muc/'.length));
      return handleCategory(env, slug);
    }

    // Mọi URL khác (trang chủ, ảnh, css...) giao lại cho phần static assets xử lý
    return env.ASSETS.fetch(request);
  }
};

// ============================================================
// HÀM DÙNG CHUNG
// ============================================================

function checkEnv(env) {
  return env.AIRTABLE_BASE_ID && env.AIRTABLE_TOKEN;
}

async function airtableFetch(env, formula, sort = true) {
  const table = env.AIRTABLE_TABLE || 'SanPham';
  let url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`;
  if (sort) url += '&sort[0][field]=ThuTu&sort[0][direction]=asc';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  if (!res.ok) throw new Error('Airtable trả về lỗi ' + res.status);
  return res.json();
}

function formatVND(n) {
  if (n === undefined || n === null || n === '') return '';
  return Number(n).toLocaleString('vi-VN') + '₫';
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ============================================================
// TRANG XEM TOÀN BỘ SẢN PHẨM — /san-pham
// ============================================================

async function handleProductList(env) {
  if (!checkEnv(env)) return new Response('Chưa cấu hình Environment Variables.', { status: 500 });
  try {
    const data = await airtableFetch(env, '{HienThi}=1');
    return html(renderListPage(data.records || [], 'Tất cả sản phẩm', 'Toàn bộ đặc sản Hương Quê đang có sẵn.'));
  } catch (err) {
    return new Response('Có lỗi khi tải dữ liệu: ' + err.message, { status: 500 });
  }
}

// ============================================================
// TRANG LỌC THEO DANH MỤC — /danh-muc/:slug
// ============================================================

async function handleCategory(env, slug) {
  if (!checkEnv(env)) return new Response('Chưa cấu hình Environment Variables.', { status: 500 });
  try {
    const formula = `AND({HienThi}=1, {DanhMucSlug}="${slug}")`;
    const data = await airtableFetch(env, formula);
    const records = data.records || [];
    const danhMucTen = records.length && records[0].fields.DanhMuc ? records[0].fields.DanhMuc : slug;
    return html(renderListPage(records, danhMucTen, `Toàn bộ sản phẩm thuộc danh mục "${danhMucTen}".`));
  } catch (err) {
    return new Response('Có lỗi khi tải dữ liệu: ' + err.message, { status: 500 });
  }
}

function cardHTML(rec) {
  const f = rec.fields;
  const img = (f.Anh && f.Anh[0] && f.Anh[0].url) ? f.Anh[0].url : '';
  const gia = f.Gia || 0;
  const giaCu = f.GiaCu || null;
  const off = giaCu && giaCu > gia ? Math.round((1 - gia / giaCu) * 100) : null;
  const link = f.Slug ? `/san-pham/${f.Slug}` : '#';

  return `
    <a class="card" href="${link}">
      <div class="thumb">
        ${off ? `<span class="badge">-${off}%</span>` : ''}
        ${img ? `<img src="${img}" alt="${f.Ten || ''}" loading="lazy">` : `<span class="ph">Chưa có ảnh</span>`}
      </div>
      <div class="body">
        <h3>${f.Ten || 'Sản phẩm chưa đặt tên'}</h3>
        <div class="price">
          <span class="now">${formatVND(gia)}</span>
          ${giaCu ? `<span class="old">${formatVND(giaCu)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

function renderListPage(records, title, subtitle) {
  const grid = records.length
    ? records.map(cardHTML).join('')
    : `<p style="grid-column:1/-1; text-align:center; color:#8a8477; padding:40px 0;">Chưa có sản phẩm nào.</p>`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Hương Quê</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#1C1A18; --lacquer:#A6321B; --gold-soft:#E4C766; --paper:#F3EAD9; --paper-2:#EAE0CB; --jade:#3F5B4A; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:1180px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(28,26,24,.12); }
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
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(28,26,24,.1); }
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

// ============================================================
// TRANG CHI TIẾT 1 SẢN PHẨM — /san-pham/:slug
// ============================================================

async function handleProductDetail(env, slug) {
  if (!checkEnv(env)) return new Response('Chưa cấu hình Environment Variables.', { status: 500 });
  try {
    const data = await airtableFetch(env, `{Slug}="${slug}"`, false);
    if (!data.records || data.records.length === 0) {
      return html(renderNotFoundPage(slug), 404);
    }
    return html(renderProductPage(data.records[0].fields));
  } catch (err) {
    return new Response('Có lỗi khi tải dữ liệu: ' + err.message, { status: 500 });
  }
}

function renderProductPage(f) {
  const ten = f.Ten || 'Sản phẩm';
  const img = (f.Anh && f.Anh[0] && f.Anh[0].url) ? f.Anh[0].url : '';
  const gia = f.Gia || 0;
  const giaCu = f.GiaCu || null;
  const moTa = f.MoTaDayDu || '';
  const vungMien = f.VungMien || '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ten} — Hương Quê</title>
<meta name="description" content="${moTa ? moTa.slice(0,150).replace(/"/g,'') : ten + ' — đặc sản chính gốc từ Hương Quê'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#1C1A18; --lacquer:#A6321B; --gold:#C9A227; --gold-soft:#E4C766; --paper:#F3EAD9; --paper-2:#EAE0CB; --jade:#3F5B4A; }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; line-height:1.55; }
  a{color:inherit; text-decoration:none;}
  .wrap{max-width:960px; margin:0 auto; padding:0 24px;}
  header{ padding:20px 0; border-bottom:1px solid rgba(28,26,24,.12); }
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
  .btn{ display:inline-flex; padding:14px 28px; border-radius:4px; font-weight:700; font-size:14.5px; cursor:pointer; border:none; }
  .btn-primary{ background:var(--lacquer); color:var(--paper); box-shadow:0 8px 20px rgba(166,50,27,.32); }
  .contact-box{ margin-top:20px; display:none; flex-direction:column; gap:10px; max-width:420px; }
  .contact-box.open{ display:flex; }
  .contact-option{
    display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:6px; border:1.5px solid rgba(28,26,24,.12);
    background:#fff; text-decoration:none; color:var(--ink); transition:border-color .15s ease, transform .15s ease;
  }
  .contact-option:hover{ border-color:#C9A227; transform:translateY(-1px); }
  .contact-option .ico{ width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:18px; }
  .contact-option .ico.zalo{ background:#e6f2fc; color:#0068ff; }
  .contact-option .ico.fb{ background:#e8eefc; color:#0866ff; }
  .contact-option .ico.phone{ background:rgba(63,91,74,.12); color:var(--jade); }
  .contact-option .txt strong{ display:block; font-size:14.5px; font-weight:700; }
  .contact-option .txt span{ font-size:12.5px; color:#8a8477; }
  footer{ text-align:center; padding:30px 0; font-size:12.5px; color:#8a8477; border-top:1px solid rgba(28,26,24,.1); }
  @media (max-width:720px){ .detail{ grid-template-columns:1fr; } }
</style>
</head>
<body>
  <header><div class="wrap"><a href="/" class="brand">Hương Quê</a></div></header>
  <div class="wrap">
    <a href="/" class="back-link">← Về trang chủ</a>
    <div class="detail">
      <div>${img ? `<img src="${img}" alt="${ten}">` : `<div style="aspect-ratio:4/3;background:var(--paper-2);border-radius:6px;"></div>`}</div>
      <div>
        ${vungMien ? `<span class="region">${vungMien}</span>` : ''}
        <h1>${ten}</h1>
        <div class="price-row">
          <span class="price-now">${formatVND(gia)}</span>
          ${giaCu ? `<span class="price-old">${formatVND(giaCu)}</span>` : ''}
        </div>
        <p class="desc">${moTa || 'Đặc sản chính gốc, đóng gói cẩn thận, giao tận nơi trong 24–48h.'}</p>
        <button class="btn btn-primary" id="openForm">Đặt hàng ngay</button>
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
    // ⚠️ CẤU HÌNH — thay bằng thông tin thật của bạn (giống với index.html)
    const ZALO_PHONE = "0909123456";
    const FACEBOOK_PAGE = "ten.fanpage.cua.ban";
    const HOTLINE_PHONE = "0909123456";
    const PRODUCT_NAME = ${JSON.stringify(ten)};

    document.getElementById('contactZalo').href = 'https://zalo.me/' + ZALO_PHONE;
    document.getElementById('contactMessenger').href = 'https://m.me/' + FACEBOOK_PAGE + '?text=' + encodeURIComponent('Chào shop, mình muốn đặt: ' + PRODUCT_NAME);
    document.getElementById('contactPhone').href = 'tel:' + HOTLINE_PHONE;

    document.getElementById('openForm').addEventListener('click', () => {
      document.getElementById('contactBox').classList.add('open');
    });
  </script>
</body>
</html>`;
}

function renderNotFoundPage(slug) {
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><title>Không tìm thấy sản phẩm — Hương Quê</title>
<style>body{font-family:sans-serif; text-align:center; padding:80px 20px; background:#F3EAD9; color:#1C1A18;}
a{color:#A6321B; font-weight:700;}</style></head>
<body>
  <h1>Không tìm thấy sản phẩm "${slug}"</h1>
  <p>Sản phẩm có thể đã ngừng bán hoặc đường dẫn không đúng.</p>
  <p><a href="/">← Quay về trang chủ</a></p>
</body></html>`;
}