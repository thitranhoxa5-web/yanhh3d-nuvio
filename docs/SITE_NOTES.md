# SITE_NOTES — yanhh3d (Sprint 0 recon)

> Recon ngày **2026-08-20** trên `https://yanhh3d.pw`. Mọi mẫu bên dưới là request/response **thật**
> chụp bằng `scripts/recon.js` (Node 24, global `fetch`). Reproduce:
>
> ```
> node scripts/recon.js search "pham nhan tu tien"
> node scripts/recon.js detail "the-gioi-hoan-my-thuyet-minh-tieng-viet"
> node scripts/recon.js watch  "the-gioi-hoan-my-thuyet-minh-tieng-viet" 283
> ```

Nền tảng: site custom kiểu **Laravel** (có `/storage/...`, CSRF meta token, `/ajax/*` routes,
`app-bundle.css?v=3.0`). Ngôn ngữ: tiếng Việt. Nội dung: donghua/HH3D thuyết minh + vietsub.

## 🎯 PHẠM VI (chốt với chủ dự án 2026-08-20)

**Chỉ lấy phim BỘ (series). BỎ phim LẺ (movie/OVA).**
- Series: mở tập tại `/<slug>/tap-<N>` (có player LINK). `mediaType` xử lý = **`tv`** duy nhất.
  `getStreams(..., "movie", ...)` → trả `[]` luôn.
- Movie/OVA: mở tại `/<slug>` (KHÔNG có `/tap-`); `/<slug>/tap-1` trả **404 nginx** → loại.
- **Cách nhận biết từ search** (không cần fetch detail): field `epQuality` của item —
  khớp `^\d+\s*/\s*\d+` (vd `"176/208 [4K]"`, `"207/219 [...]"`) ⇒ **phim bộ**; còn lại
  (`"Full Movie"`, `"OVA1 FullHD"`, `"FullHD"`, `"Tổng Kết 05"`, `"Trailer ..."`) ⇒ **phim lẻ → bỏ**.
  → Sprint 2 lọc candidate ngay ở tầng search.

---

## ⚠️ RỦI RO SỐ 1 — ẢNH HƯỞNG TÍNH KHẢ THI (đọc trước)

Server chính (fbcdn.cloud) trả HLS trỏ tới **segment PNG-polyglot**: mỗi segment là 1 file `.png`
(`Content-Type: image/png`, header PNG thật `89 50 4E 47`) nhưng **MPEG-TS thật bắt đầu sau prefix
PNG** — đo thực tế: **server1 (o2) prefix 271 byte, server2 (o1) prefix 68 byte**, sau đó `0x47`
lặp đúng chu kỳ 188 byte (xác nhận bằng recon). Kể cả URL trỏ tới `tiktokcdn.com/.../ad-site-i18n/...`
cũng là **nội dung thật nguỵ trang** (playlist dài ~22 phút, đúng 1 tập, có ENDLIST), không phải quảng cáo.

Hệ quả: **ExoPlayer (player của Nuvio) nhiều khả năng KHÔNG demux được** vì TS extractor kỳ vọng
sync byte ở đầu file, không phải sau 68–271 byte rác. Web player chơi được vì JS custom (`devtool.js`/
`player.js`) tự bóc prefix trước khi nạp jwplayer.

→ **Phải verify trên device thật TRƯỚC** khi đổ công vào Sprint 2–5. Nếu ExoPlayer không nuốt
PNG-polyglot, phương án theo thứ tự ưu tiên:
(a) **Thử các server embed khác trên sever2** — `LINK7 Dailymotion`, `LINK8 streamc.xyz`,
    `LINK9 abysscdn` (xem câu 4) có thể trả **HLS/MP4 sạch, không polyglot** → ưu tiên reverse thử.
(b) proxy strip-prefix — bất khả thi trong Hermes (cần server ngoài).
(c) dừng dự án.
Xem "Câu 4/5" & "Việc cần chốt".

---

## 1. URL pattern search? JSON API hay HTML?

**CÓ JSON API** (ưu tiên dùng — sạch, nhanh ~260–480ms):

```
GET /ajax/search/suggest?keysearch=<kw>
Headers: X-Requested-With: XMLHttpRequest
```

> ⚠️ **BUG ĐÃ SỬA (recon lần 1 sai)**: param phải là **`keysearch`**, KHÔNG phải `keyword`.
> Dùng `keyword=` thì site **bỏ qua** và luôn trả **danh sách phổ biến cố định 5 phim** — kể cả
> query rác → sẽ **match bừa** ở Sprint 2. Đã verify:
> - `keysearch=gia thien` → `Già Thiên`, `Già Thiên Movie` (đúng).
> - `keysearch=dau pha` → 5 biến thể Đấu Phá Thương Khung (đúng, có phần/OVA).
> - `keysearch=zzxqwer999` → `data` **rỗng** (đúng — không match thì không trả).
> - `keyword=zzxqwer999` → vẫn trả 5 phim phổ biến (SAI). Dạng `?ajaxSearch=1&keysearch=` cũng đúng.

Response `application/json`:
```json
{ "code": 1, "message": "", "data": "<ul class=\"limit-search\"> ...HTML fragment... </ul>" }
```
`data` là HTML fragment — parse bằng regex, không cần cheerio. **Rỗng** (`data:""`) khi không match.

> ⚠️ **Cap 5 item**: suggest trả **tối đa 5** kết quả. Nếu phim đúng nằm ngoài top-5 (query chung
> chung) sẽ miss → Sprint 2 phải query cụ thể (dùng cả `title` + `original_title`), và có thể
> fallback trang HTML đầy đủ `GET /search?keysearch=<kw>` (full page ~52–61KB, kết quả có lọc thật —
> đã xác nhận byte-size khác nhau theo query) khi suggest 0 kết quả.

## 2. Cấu trúc item kết quả

Trong fragment `data`, mỗi item là 1 `<a>`:
- **slug**: `href="https://yanhh3d.pw/<slug>"` (slug nằm ở root path, không prefix).
- **title (VI)**: text trong `<span class="title-search ...">`, đồng thời ở `title="..."` của `<a>`.
- **poster**: `srcset="https://yanhh3d.pw/storage/movies/<...>.png|jpg"`.
- **ep/quality**: `<span class="ep-search ...">` dạng `"283/286 [4K]"` = tập hiện tại / tổng tập [chất lượng].
- **title EN/romaji**: ❌ KHÔNG có ở suggest (cũng không có `alternateName` ở ld+json — xem câu 3).
- **năm**: ❌ KHÔNG có ở suggest, chỉ có ở trang detail.

Mẫu thật (query `keysearch=gia thien`):
```json
{"slug":"gia-thien","title":"Già Thiên","poster":"https://yanhh3d.pw/storage/movies/gia-thien-1782129259.jpg","epQuality":"176/208 [4K]"}   // BỘ
{"slug":"gia-thien-movie-vac-quan-chien-vuong-dang","title":"Già Thiên Movie - Vác Quan Chiến Vương Đằng","epQuality":"Full Movie [4K]"}   // LẺ -> bỏ
```
Mẫu có season hint trong title (query `keysearch=dau pha`): `"Đấu Phá Thương Khung Phần 5-6"`
(`epQuality:"207/219 [...]"`) — chuỗi "Phần 5-6" dùng cho season matching ở Sprint 2.

> Lưu ý matching (Sprint 2): cần scoring phía ta (Dice bigram + year + season hint), lọc phim lẻ
> bằng `epQuality`, không tin thứ tự của site.

## 3. Trang detail: danh sách tập render sẵn hay AJAX?

`GET /<slug>` → HTML render sẵn (SSR ~83KB). Chứa:
- **ld+json** `@type: "TVSeries"` (hoặc `Movie`): `name`, `datePublished` (năm, vd `"2021"`),
  `genre[]`. ⚠️ `alternateName` = `undefined`, `numberOfEpisodes` = `undefined` → **không có tên EN
  và không có tổng số tập trong ld+json**.
- Trang detail **chỉ hiển thị tập mới nhất** (vd chỉ thấy `tap-283`), **KHÔNG render full list**.
- Năm cũng có ở text `Năm: <...>` và trong ld+json `datePublished`.

→ **Full episode list + player nằm ở trang WATCH**, không phải detail (xem câu 4). Tổng số tập suy ra
từ chuỗi `"283/286"` ở suggest, hoặc từ danh sách tap- trên watch page (sever2).

## 4. Trang watch: iframe embed hay API trả link? Payload?

> ⚠️ **BUG ĐÃ SỬA (recon lần 1 sai)**: KHÔNG build `/<slug>/tap-<N>` tuần tự được.
> - **Server 1** (path mặc định `/<slug>/tap-...`): tập **gộp theo cụm bất quy tắc** — `tap-1-5`,
>   `tap-88-90`, `tap-100-110`... (134 entry cho 283 tập). `/<slug>/tap-100` đơn lẻ → **404 nginx**.
> - **Server 2** (`/sever2/<slug>/tap-<N>`): **1 tập = 1 URL, sạch, tap-1..tap-283, không cụm** →
>   **DÙNG SEVER2**. Đã verify `tap-100` mở bình thường.

`GET /sever2/<slug>/tap-<N>` → HTML ~573KB, SSR. **KHÔNG iframe** (player thật là `<a>` option). Có:

**(a) Full episode list**: 283 link `/sever2/<slug>/tap-<N>` (N = 1..283, 1:1). Có thể build trực
tiếp `/sever2/<slug>/tap-<episodeNum>`, nhưng Sprint 3 nên **parse danh sách href để chắc** (phòng gap).

**(b) Các nút server** (trên sever2) — mỗi option `<a name="LINK{n}" data-src="<playerUrl>">`. Có
cả server fbcdn lẫn **embed host bên thứ ba**:
```
LINK4  https://scontent-sin2-2-xx.fbcdn.cloud/o1/v/t2/f2/m366/<uuid>.m3u8   (fbcdn, scheme o1)
LINK7  https://www.dailymotion.com/embed/video/<id>?autoplay=1             (Dailymotion embed)
LINK8  https://embed1.streamc.xyz/embed.php?hash=<hash>                     (streamc embed)
LINK9  https://abysscdn.com/<id>                                           (Abyss embed)
```
> (Trên server 1 danh sách LINK khác: `LINK1/5/6` fbcdn scheme **o2**, `LINK2` `play-fb-v8`.)
> LINK7/8/9 là **embed host ngoài, CÓ THỂ trả HLS/MP4 sạch (không polyglot)** — Sprint 4 nên reverse
> thử trước, vì fbcdn dính PNG-polyglot (rủi ro số 1).

**(c) Bóc link fbcdn** — 2 scheme, đều 2 bước, không cần token/hash từ phía ta:

| Scheme | Player page chứa | Playlist URL | Token/TTL |
|---|---|---|---|
| **o1** (server2) | `data-stream-url="<m3u8>"` + `data-hash` (chỉ để resume, bỏ qua) | dùng **thẳng** `data-stream-url` = `.../stream/m3u8/<uuid>.m3u8` | URL playlist **không token**; segment ký `x-expires` ~**vài giờ** |
| **o2** (server1) | `data-obf="<base64 JSON>"` | decode base64 → JSON, lấy `pU` = `.../stream-plain?t=<token>` | `t=<token>` **per-request, TTL ~phút** |

o2 JSON: `{ sU: ".../stream?t=" (AES-GCM), pU: ".../stream-plain?t=" (cleartext ← dùng), eK: khoá
AES-256-GCM, hD: hash id }`. Recon đã giải mã `sU` thành công → **y hệt** `pU` (cùng segment) nên
bỏ qua giải mã. **→ Ưu tiên scheme o1 (sever2): đơn giản hơn, không token hết hạn nhanh.**

## 5. Link cuối: `.m3u8` master hay variant? Có `.mp4` không?

- Playlist fbcdn (cả o1 `data-stream-url` lẫn o2 `pU`) → **HLS media playlist chuẩn**
  (`application/x-mpegURL`), `#EXTINF`, có `#EXT-X-ENDLIST` (VOD). **KHÔNG phải master** (không có
  `#EXT-X-STREAM-INF`, 1 chất lượng) → theo §4.2 label **`Auto`**. Mẫu o1: 216 segment, ~22 phút/tập.
- **Chất lượng thật**: suggest ghi `[4K]` nhưng playlist không khai báo `RESOLUTION`. Không suy ra
  được → dùng `Auto` (KHÔNG bịa "1080p"/"4K").
- **`.mp4` fallback**: ❌ không có ở server fbcdn. (Embed LINK7/8/9 chưa kiểm tra — có thể có mp4.)
- **Segment = PNG-polyglot** (rủi ro số 1): file `.png` (`image/png`), TS thật ở **byte 68 (o1)** /
  **byte 271 (o2)**. Host: o1 = `*.tiktokcdn.com/.../ad-site-i18n/` (nguỵ trang tên "ad", không phải
  quảng cáo), o2 = `m.defifa.com`.

Mẫu `pU` body:
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.000000,
https://m.defifa.com/file/4943b17d-65b8-4556-9097-2315badbb33b/CXWAHKL8aiI5nXe7ce16R5-1.png
...
```

## 6. Header bắt buộc để CDN không trả 403?

Kết quả test thật (curl):

| Request | No header | UA only | UA + Referer | Ghi chú |
|---|---|---|---|---|
| o1 `data-stream-url` playlist | 200 | 200 | 200 | Header **không bắt buộc**, **không token** |
| o2 `pU` stream-plain (có token) | 200 | 200 | 200 | Header **không bắt buộc** |
| o2 `pU` **bỏ token** (`t=`) | — | **403** | **403** | **Token bắt buộc** (chỉ scheme o2) |
| segment `.png` (defifa/tiktokcdn) | 200 | 200 | 200 | Header **không bắt buộc** |
| player page (fbcdn) | 200 | 200 | 200 | — |

→ CDN **không** dùng hotlink-protection theo Referer. Scheme **o1 không có token** trên URL playlist
(chỉ segment ký `x-expires` ~vài giờ); scheme o2 chặn bằng **token hết hạn ~phút** trên URL playlist.
**Tuân R7 vẫn gắn đủ header** (`User-Agent`, `Referer: https://yanhh3d.pw/`, `Origin`) cho mọi
stream — vô hại và phòng khi CDN siết.

## 7. Cloudflare / rate-limit / cookie session?

- **Cloudflare**: CÓ trên `yanhh3d.pw/.ee/.work` (`Server: cloudflare`, `CF-RAY: ...-HKG`). Nhưng
  request thường (UA mobile) **qua được, không dính JS challenge** — mọi lần recon đều 200. Không
  cần cookie/clearance để search/detail/watch.
- **Session/cookie**: không cần cho luồng đọc (search→watch→link). Có `/login` nhưng nội dung xem
  không yêu cầu đăng nhập.
- **Rate-limit**: chưa gặp khi test tuần tự vài chục request. Chưa đo ngưỡng — Sprint 5 giữ số request
  tối thiểu (suggest 1 lần + watch 1 lần + player N option).
- **CSRF token**: có `<meta name="csrf-token">` nhưng chỉ dùng cho POST (bookmark/notification),
  luồng đọc là GET → không cần.
- **TTL link stream**: tuỳ scheme — o1 (sever2, ưu tiên) segment ký `x-expires` ~vài giờ; o2 token
  URL ~phút. `resolved link` **không cache quá TTL** (§5.4 → dùng o1 thì ~vài phút vẫn an toàn).

## 8. Domain dự phòng (mirror)?

Probe ngày 2026-08-20:

| Domain | Status | Ghi chú |
|---|---|---|
| `yanhh3d.pw` | **200** | Chính (Cloudflare) |
| `yanhh3d.ee` | **200** | Mirror sống (Cloudflare) |
| `yanhh3d.work` | **200** | Mirror sống (Cloudflare) |
| `yanhh3d.co` | 000 | Chết/timeout |
| `yanhh3d.site` | 000 | Chết/timeout |
| `yanhh3dz.net` | 000 | Chết/timeout |
| `hh3d.cx` | 000 | Chết/timeout |

→ `constants.DOMAINS = ["yanhh3d.pw", "yanhh3d.ee", "yanhh3d.work"]` (Sprint 6 fallback).
CDN video (`*.fbcdn.cloud`, `m.defifa.com`) độc lập với domain site.

---

## Bản đồ luồng (chốt cho Sprint 2–4)

```
tmdbId --(TMDB meta: title/year)--> GET /ajax/search/suggest?keysearch= --> [{slug,title,epQuality}]
   |                                   (Sprint 2: lọc phim BỘ theo epQuality ^\d+/\d+;
   v                                    fuzzy score Dice+year+season; ngưỡng 0.72)
slug --> GET /sever2/<slug>/tap-<N>   (Sprint 3: map season/ep -> N; parse href list, KHÔNG build mù)
   |         |-- full ep list 1..N (1:1, sever2)  |-- server 1 gộp cụm -> KHÔNG dùng
   v
watch HTML --> [LINK4 fbcdn-o1 | LINK7 dailymotion | LINK8 streamc | LINK9 abyss] data-src  (Sprint 4)
   |
   +--> fbcdn o1:  GET playerUrl --> data-stream-url (m3u8 trực tiếp, không token)
   |                 --> HLS media (Auto) --> segment PNG-polyglot (TS @ byte 68)  ⚠️ verify ExoPlayer
   |
   +--> embed 7/8/9: reverse thử — KỲ VỌNG HLS/MP4 sạch (không polyglot)  [Sprint 4, ưu tiên]
```

## Phim có tự cập nhật không? (CÓ — không hardcode gì)

Plugin đọc **live mỗi lần gọi**, không có bảng phim/tập cứng trong code:
- Danh sách phim: từ `GET /ajax/search/suggest?keysearch=` (live) → phim mới lên site là tìm thấy ngay
  (miễn TMDB có title để match — xem rủi ro matching).
- Danh sách tập: đọc từ HTML trang watch (`tap-1..N` live) → **có tập mới là tự nhận**. Đã xác nhận
  suggest hiển thị số live `176/208`, `283/286`; watch page liệt kê range `1..N` thật.
- Link stream: bóc live từ player page mỗi lần (token đổi từng request).

**Chỉ 3 thứ hardcode** (đều là hằng số cấu trúc, không phải dữ liệu phim): `DOMAINS[]`, các regex
anchor, và header CDN. Site đổi cấu trúc HTML/param → phải cập nhật regex (đó là bản chất scraper).

**Độ trễ update** do cache (Sprint 5): `slug` 6h, `episodes` 30m → tập mới có thể chậm hiện tối đa
~30 phút; tắt/không cache thì realtime. Không ảnh hưởng tính đúng, chỉ là độ tươi.

## Việc cần chốt trước khi đi tiếp

1. **[CHẶN] Verify ExoPlayer chơi được PNG-polyglot** — spike device thật (Nuvio Plugin Tester) với
   1 URL o1 `data-stream-url` hard-code + header đầy đủ. Nếu KHÔNG chơi được → chuyển hướng sang embed
   host (mục 2). Đây phải là việc **đầu Sprint 1**, trước khi đầu tư Sprint 2–3.
2. **[QUAN TRỌNG] Reverse embed host trên sever2** — `LINK7 dailymotion`, `LINK8 streamc.xyz`,
   `LINK9 abysscdn`. Kỳ vọng có HLS/MP4 **sạch, không polyglot** → nếu đúng thì đây là đường chính,
   né hẳn rủi ro số 1. Dailymotion có extractor công khai; Abyss/streamc cần kiểm tra.
3. Đo TTL chính xác của link o1 (segment `x-expires`) để set cache `resolved link`.
4. TMDB matching: cần TMDB API key hoặc xác nhận Nuvio inject meta (Section 8 mục 4) — cho Sprint 2.
   Lưu ý: donghua tên thuần Việt, không có tên EN ở site → matching TMDB↔site là rủi ro lớn nhất về
   chất lượng, cần bàn kỹ đầu Sprint 2.
