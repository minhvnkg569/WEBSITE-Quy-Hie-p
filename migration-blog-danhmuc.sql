-- Migration: thêm bảng Danh mục + Bài viết (Blog) vào database đã có sẵn
-- Chạy: npx wrangler d1 execute huong-que-db --remote --file=./migration-blog-danhmuc.sql

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

-- Dữ liệu mẫu cho danh mục (giữ đúng 6 danh mục đang hiển thị trên web hiện tại)
-- An toàn khi chạy lại nhiều lần: bỏ qua nếu slug đã tồn tại
INSERT OR IGNORE INTO categories (ten, slug, icon, mo_ta, thu_tu, hien_thi) VALUES
('Chả & Nem', 'cha-nem', '🍖', 'Bình Định, Huế', 1, 1),
('Nước Mắm', 'nuoc-mam', '🐟', 'Phan Thiết', 2, 1),
('Bánh Tráng', 'banh-trang', '🌾', 'Phú Yên', 3, 1),
('Rượu Quê', 'ruou-que', '🍶', 'Bàu Đá', 4, 1),
('Mứt & Kẹo', 'mut-keo', '🍬', 'Quảng Ngãi', 5, 1),
('Trà & Mật Ong', 'tra-mat-ong', '🍯', 'Tây Nguyên', 6, 1);
