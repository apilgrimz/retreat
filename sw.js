// 하계수양회 PWA Service Worker
// v1.0.9 — 모바일 안정성 강화: HTML 캐시 우선, 네트워크 차단/호스팅 다운 시에도 동작
const CACHE_VERSION = 'retreat-v1.0.28';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './template.xlsx',
];
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // 핵심 자원은 무조건 캐시 — 한 개라도 실패하면 캐시 안 됨, 그래서 개별로 추가
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try { await cache.add(url); } catch (e) { console.warn('Core skip:', url, e.message); }
    }));
    // CDN은 옵셔널
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try { await cache.add(url); } catch (e) { console.warn('CDN skip:', url, e.message); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // navigationPreload — SW 시작 동안 네트워크 요청 미리 시작 (모바일 속도 ↑)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch(e){}
    }
    // 오래된 캐시 정리
    const names = await caches.keys();
    await Promise.all(names.map(n => n !== CACHE_VERSION && caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  // HTML/네비게이션 요청 — 캐시 우선, 네트워크는 백그라운드 갱신
  // (호스팅이 다운되거나 모바일이 인터넷에 연결 안 됐을 때도 앱이 열림)
  if (isHTML) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 1) 캐시에서 index.html 찾기 (가장 안전한 fallback)
      const cached = await cache.match('./index.html') || await cache.match('./') || await cache.match(req);
      // 2) navigationPreload가 있다면 그것도 시도
      const preload = event.preloadResponse ? event.preloadResponse.catch(() => null) : Promise.resolve(null);
      // 3) 네트워크 시도 (백그라운드 갱신용)
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          cache.put('./index.html', res.clone()).catch(()=>{});
        }
        return res;
      }).catch(() => null);

      // 캐시 있으면 즉시 반환 (백그라운드로 갱신은 계속)
      if (cached) {
        // 네트워크가 빠르면 더 신선한 응답으로 갱신만 시키고 즉시 캐시 반환
        return cached;
      }
      // 캐시 없음 → preload나 네트워크 응답 시도
      const fresh = (await preload) || (await network);
      if (fresh) return fresh;
      // 정말 아무것도 없음 → 최소한의 오프라인 페이지
      return new Response(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><title>오프라인</title>' +
        '<body style="font-family:sans-serif;padding:20px;text-align:center"><h2>연결 실패</h2>' +
        '<p>네트워크에 연결되어 있는지 확인하시고, 한 번 더 시도해 주세요.</p>' +
        '<button onclick="location.reload()" style="padding:10px 20px;font-size:16px">다시 시도</button></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })());
    return;
  }

  // 일반 자원 (JS/CSS/이미지/CDN) — Stale-While-Revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then((res) => {
      if (res && res.ok && (url.origin === location.origin
          || CDN_ASSETS.some((u) => req.url.startsWith(u.split('?')[0])))) {
        cache.put(req, res.clone()).catch(()=>{});
      }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
