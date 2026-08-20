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

---

## ⚠️ RỦI RO SỐ 1 — ẢNH HƯỞNG TÍNH KHẢ THI (đọc trước)

Link cuối là HLS media playlist trỏ tới **segment PNG-polyglot**: mỗi segment là 1 file `.png`
(`Content-Type: image/png`, header PNG thật `89 50 4E 47`) nhưng **MPEG-TS thật bắt đầu ở byte 271**
(271-byte PNG prefix, sau đó `0x47` lặp đúng chu kỳ 188 byte — xác nhận bằng recon).

Hệ quả: **ExoPlayer (player của Nuvio) nhiều khả năng KHÔNG demux được** vì TS extractor kỳ vọng
sync byte ở đầu file, không phải sau 271 byte rác. Web player của site chơi được vì `devtool.js`
tự bóc prefix trước khi nạp vào jwplayer.

→ Đây là **giả định phải verify trên device thật TRƯỚC** khi đổ công vào Sprint 2–5. Nếu ExoPlayer
không nuốt được PNG-polyglot, plugin cần một trong: (a) proxy strip-prefix (không khả thi trong
Hermes, cần server), (b) tìm server LINK khác trả TS sạch, (c) dừng dự án. Xem "Câu 5" & "Việc cần chốt".

---

## 1. URL pattern search? JSON API hay HTML?

**CÓ JSON API** (ưu tiên dùng cái này — sạch, nhanh ~480ms):

```
GET /ajax/search/suggest?keyword=<kw>
Headers: X-Requested-With: XMLHttpRequest
```

Response `application/json`:
```json
{ "code": 1, "message": "", "data": "<ul class=\"limit-search\"> ...HTML fragment... </ul>" }
```
`data` là HTML fragment (khoảng 5 item) — parse bằng regex, không cần cheerio.

Ngoài ra có trang HTML đầy đủ: `GET /search?keysearch=<kw>` (trả full page ~54KB). Dùng làm
fallback nếu suggest đổi format, nhưng suggest tốt hơn cho matching.

## 2. Cấu trúc item kết quả

Trong fragment `data`, mỗi item là 1 `<a>`:
- **slug**: `href="https://yanhh3d.pw/<slug>"` (slug nằm ở root path, không prefix).
- **title (VI)**: text trong `<span class="title-search ...">`, đồng thời ở `title="..."` của `<a>`.
- **poster**: `srcset="https://yanhh3d.pw/storage/movies/<...>.png|jpg"`.
- **ep/quality**: `<span class="ep-search ...">` dạng `"283/286 [4K]"` = tập hiện tại / tổng tập [chất lượng].
- **title EN/romaji**: ❌ KHÔNG có ở suggest (cũng không có `alternateName` ở ld+json — xem câu 3).
- **năm**: ❌ KHÔNG có ở suggest, chỉ có ở trang detail.

Mẫu thật (query `"pham nhan tu tien"`):
```json
{"slug":"the-gioi-hoan-my-thuyet-minh-tieng-viet","title":"Thế Giới Hoàn Mỹ","poster":"https://yanhh3d.pw/storage/movies/the-gioi-hoan-my-1782129775.png","epQuality":"283/286 [4K]"}
{"slug":"nghich-thien-ta-than-3d","title":"Nghịch Thiên Tà Thần 3D","epQuality":"51/52 [4K]"}
{"slug":"tuong-da","title":"Tương Dạ","epQuality":"19/19 [4K]"}
```
> Lưu ý matching (Sprint 2): query "pham nhan tu tien" KHÔNG trả về đúng phim đó ở top —
> search của site là fuzzy/loose. Cần scoring phía ta, không tin thứ tự của site.

## 3. Trang detail: danh sách tập render sẵn hay AJAX?

`GET /<slug>` → HTML render sẵn (SSR ~83KB). Chứa:
- **ld+json** `@type: "TVSeries"` (hoặc `Movie`): `name`, `datePublished` (năm, vd `"2021"`),
  `genre[]`. ⚠️ `alternateName` = `undefined`, `numberOfEpisodes` = `undefined` → **không có tên EN
  và không có tổng số tập trong ld+json**.
- Trang detail **chỉ hiển thị tập mới nhất** (vd chỉ thấy `tap-283`), **KHÔNG render full list**.
- Năm cũng có ở text `Năm: <...>` và trong ld+json `datePublished`.

→ **Full episode list nằm ở trang WATCH**, không phải detail (xem câu 4). Tổng số tập cũng suy ra từ
chuỗi `"283/286"` ở suggest, hoặc từ danh sách tap- trên watch page.

## 4. Trang watch: iframe embed hay API trả link? Payload?

`GET /<slug>/tap-<ep>` → HTML ~575KB, SSR. **KHÔNG iframe**. Trong HTML có:

**(a) Full episode list**: 284 link `/<slug>/tap-<N>` (N = 1..284) + biến thể server 2
`/sever2/<slug>/tap-<N>`. Đánh số tập tuần tự đơn giản → **build URL trực tiếp được**, không cần AJAX.

**(b) Các nút server** — 5 option, mỗi option là `<a name="LINK{n}" data-src="<playerUrl>">`:
```
LINK1  https://scontent-sin2-9-xx.fbcdn.cloud/o2/v/t2/f2/m366/<uuid>.m3u8      (player HTML)
LINK4  https://scontent-sin2-7-xx.fbcdn.cloud/o2/v/t2/f2/m366/<uuid>.m3u8      (player HTML)
LINK5  https://scontent-sin2-9-xx.fbcdn.cloud/o2/v/t2/f2/m366/<uuid>.m3u8      (player HTML)
LINK6  https://scontent-sin2-7-xx.fbcdn.cloud/o2/v/t2/f2/m366/<uuid>.m3u8      (player HTML)
LINK2  https://scontent-sin2-10-xx.fbcdn.cloud/play-fb-v8/play/<id>            (KHÁC loại — FB video)
```
> `data-src` kết thúc bằng `.m3u8` nhưng **KHÔNG phải playlist** — nó là **trang HTML player**
> (jwplayer). LINK2 là loại khác (`play-fb-v8`), chưa reverse — bỏ qua ở v1.

**(c) Bóc link thật** — 2 bước, không cần token/hash từ phía ta:
1. `GET <playerUrl>` → HTML player ~1.7KB, chứa `<div id="player" data-obf="<base64>">`.
2. `data-obf` = **base64 của JSON** (không phải mã hoá, chỉ base64):
   ```json
   {
     "sU": ".../<uuid>.m3u8/stream?t=<token>",        // playlist mã hoá AES-GCM
     "pU": ".../<uuid>.m3u8/stream-plain?t=<token>",  // playlist CLEARTEXT  ← dùng cái này
     "eK": "<hex 32 byte>",   // khoá AES-256-GCM để giải sU (không cần nếu dùng pU)
     "hD": "<hex 16 byte>"    // hash id (ổn định theo phim)
   }
   ```
   `t=<token>` dạng `d1c038822e0b4308.1787235300` — **per-request, hết hạn nhanh** (phần sau là unix
   ts, vd `1787235300` = 2026-08-20T14:15Z). Không tự chế được token → phải fetch player page mỗi lần.

## 5. Link cuối: `.m3u8` master hay variant? Có `.mp4` không?

- `pU` (`/stream-plain?t=`) → **HLS media playlist chuẩn** (`application/vnd.apple.mpegurl`),
  `#EXT-X-PLAYLIST-TYPE:VOD`, `#EXTINF:6.0`, ~165 segment. **KHÔNG phải master** (1 chất lượng duy
  nhất, không có `#EXT-X-STREAM-INF`) → theo §4.2 label sẽ là **`Auto`**.
- `sU` (`/stream?t=`) → cùng playlist nhưng thân bị **`#ENC-AESGCM`** (AES-256-GCM, iv ở header,
  key = `eK`). Recon đã **giải mã thành công** → nội dung **y hệt** `stream-plain` (cùng segment).
  Nên `pU` là đường tắt, bỏ qua giải mã.
- **Chất lượng thật**: suggest ghi `[4K]`, nhưng playlist không khai báo resolution. Không suy ra
  được → dùng `Auto` (KHÔNG bịa "1080p").
- **`.mp4` fallback**: ❌ không có ở loại LINK1/4/5/6.
- **Segment = PNG-polyglot** (xem "Rủi ro số 1"): `.png` trên `m.defifa.com`, TS thật ở byte 271.

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
| `pU` stream-plain (có token) | 200 | 200 | 200 | Header **không bắt buộc** |
| `pU` **bỏ token** (`t=`) | — | **403** | **403** | **Token bắt buộc** |
| segment `.png` (m.defifa.com) | 200 | 200 | 200 | Header **không bắt buộc** |
| player page (fbcdn) | 200 | 200 | 200 | — |

→ CDN **không** dùng hotlink-protection theo Referer; chặn bằng **token hết hạn** trên URL playlist.
Segment (`m.defifa.com`) mở, không token.
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
- **TTL token stream**: ngắn (phút). `resolved link` **không cache quá TTL token** (§5.4 → 5 phút là
  trần, nên để ~2–3 phút cho an toàn).

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
tmdbId --(TMDB meta: title/year)--> GET /ajax/search/suggest?keyword= --> [{slug,title,epQuality}]
   |                                        (Sprint 2: fuzzy score, ngưỡng 0.72)
   v
slug --(episode tuần tự)--> GET /<slug>/tap-<ep>  (Sprint 3: map season/ep -> tap-N)
   |                          |-- full ep list 1..N trong HTML
   v
watch HTML --> [LINK1,4,5,6] data-src (player URL)      (Sprint 4)
   |
   v (mỗi option)
GET <playerUrl> --> data-obf(base64 JSON) --> pU = .../stream-plain?t=<token>
   |
   v
GET pU --> HLS media playlist (Auto) --> segment .png polyglot (TS @ byte 271)  ⚠️ verify ExoPlayer
```

## Việc cần chốt trước khi đi tiếp

1. **[CHẶN] Verify ExoPlayer chơi được PNG-polyglot** — làm spike device thật (Nuvio Plugin Tester)
   với 1 URL `pU` hard-code + header đầy đủ. Nếu KHÔNG chơi được → cân nhắc lại toàn bộ (b/c ở Rủi ro
   số 1). Đây phải là việc đầu Sprint 1 hoặc trước Sprint 2.
2. Reverse LINK2 (`play-fb-v8/play/<id>`) — có thể trả TS sạch (không polyglot)? Chưa kiểm tra.
3. Đo TTL token chính xác (fetch pU lặp tới khi 403) để set cache `resolved link`.
4. TMDB matching: cần TMDB API key hoặc xác nhận Nuvio inject meta (Section 8 mục 4) — cho Sprint 2.
