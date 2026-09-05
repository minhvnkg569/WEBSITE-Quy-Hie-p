-- Schema cho database Hương Quê (Cloudflare D1)
-- Chạy file này 1 lần duy nhất để tạo bảng, xem hướng dẫn trong HUONG-DAN-SETUP-ADMIN.md

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ten TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  mo_ta_day_du TEXT DEFAULT '',
  danh_muc TEXT DEFAULT '',
  danh_muc_slug TEXT DEFAULT '',
  anh_url TEXT DEFAULT '',
  gia INTEGER DEFAULT 0,
  gia_cu INTEGER,
  vung_mien TEXT DEFAULT '',
  danh_gia REAL DEFAULT 5.0,
  da_ban INTEGER DEFAULT 0,
  thu_tu INTEGER DEFAULT 0,
  hien_thi INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vi_tri TEXT UNIQUE NOT NULL,
  anh_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ten TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '🍃',
  mo_ta TEXT DEFAULT '',
  thu_tu INTEGER DEFAULT 0,
  hien_thi INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tieu_de TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tom_tat TEXT DEFAULT '',
  noi_dung TEXT DEFAULT '',
  anh_url TEXT DEFAULT '',
  danh_muc TEXT DEFAULT '',
  thu_tu INTEGER DEFAULT 0,
  hien_thi INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Dữ liệu mẫu (xoá/sửa thoải mái sau khi đăng nhập /admin)
INSERT OR IGNORE INTO categories (ten, slug, icon, mo_ta, thu_tu, hien_thi) VALUES
('Chả & Nem', 'cha-nem', '🍖', 'Bình Định, Huế', 1, 1),
('Nước Mắm', 'nuoc-mam', '🐟', 'Phan Thiết', 2, 1),
('Bánh Tráng', 'banh-trang', '🌾', 'Phú Yên', 3, 1),
('Rượu Quê', 'ruou-que', '🍶', 'Bàu Đá', 4, 1),
('Mứt & Kẹo', 'mut-keo', '🍬', 'Quảng Ngãi', 5, 1),
('Trà & Mật Ong', 'tra-mat-ong', '🍯', 'Tây Nguyên', 6, 1);

INSERT OR IGNORE INTO products (ten, slug, mo_ta_day_du, danh_muc, danh_muc_slug, gia, gia_cu, vung_mien, thu_tu, hien_thi)
VALUES
('Chả Lụa Truyền Thống Gói Lá Chuối', 'cha-lua-truyen-thong', 'Chả lụa làm thủ công theo công thức gia truyền, gói lá chuối, giữ trọn hương vị quê nhà.', 'Chả & Nem', 'cha-nem', 98000, 120000, 'Bình Định', 1, 1),
('Nước Mắm Nhĩ Cá Cơm 40 Độ Đạm', 'nuoc-mam-nhi-ca-com', 'Nước mắm nhĩ nguyên chất, ủ chượp truyền thống hơn 12 tháng.', 'Nước Mắm', 'nuoc-mam', 89000, 101000, 'Phan Thiết', 2, 1);