# YanHH3D — Stremio-style add-on (Cloudflare Worker)

Trái với plugin local scraper (`providers/yanhh3d.js`, chỉ trả stream), add-on này **có
catalog riêng**: YanHH3D hiện thành mục browse được trong Nuvio/Stremio, dùng thẳng phim +
tên tiếng Việt của yanhh3d (không cần TMDB).

## ✅ Đã deploy — link add vào Nuvio

```
https://yanhh3d.yanhh3d-addon.workers.dev/manifest.json
```

## Nó làm gì

- **catalog** `series/yanhh3d-series` — list "Mới cập nhật" + tìm kiếm (`search`), phân trang (`skip`).
- **meta** — chi tiết phim + danh sách tập (từ trang sever2).
- **stream** — bóc link fbcdn, trả qua **proxy tự strip PNG-polyglot** → player nhận MPEG-TS sạch.
  (Kèm Dailymotion làm nguồn phụ khi có.)

Các endpoint proxy (`/proxy-playlist.m3u8`, `/proxy-segment`) nằm ngay trong Worker.

## Deploy (miễn phí, ~2 phút)

Cần tài khoản Cloudflare (free). Từ thư mục này:

```bash
cd addon
npx wrangler login        # mở trình duyệt, đăng nhập Cloudflare
npx wrangler deploy       # deploy, in ra URL .workers.dev
```

Sau khi deploy, URL add vào Nuvio (Settings → Add-ons / dán manifest URL):

```
https://yanhh3d.<subdomain-cua-ban>.workers.dev/manifest.json
```

## Giới hạn free tier (đủ dùng cá nhân)

- 100.000 request/ngày. 1 tập ~22 phút ≈ 220 segment → ~450 tập/ngày.
- Segment stream qua Worker (proxy) — dùng cá nhân thoải mái.

## Lưu ý

- Nếu 1 tập chỉ có server streamc/abyss (chưa reverse) → tập đó có thể không ra link;
  đa số tập có fbcdn nên vẫn chạy.
- Kiểm tra ToS của yanhh3d + bản quyền tại nơi bạn ở trước khi dùng công khai.
