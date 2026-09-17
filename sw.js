/**
 * Service Worker（「ホーム画面に追加」で使えるようにするため）
 * ------------------------------------------------------------------
 * キャッシュしてよいもの:
 *   - 同一オリジンのアプリ本体（HTML / JS / アイコン）
 *   - 見た目に必要な外部CDN（Tailwind / Google Fonts）
 *
 * 絶対にキャッシュしないもの:
 *   - Firebase SDK (www.gstatic.com) と Firestore への通信
 *     → 古いデータを掴んだまま「同期できている」ように見える事故を防ぐ。
 *   - 自作アプリ (yuda890201.github.io/<repo>/) の中身
 *     → 各アプリは各アプリで更新される。ここが握ると更新が届かなくなる。
 * これらは respondWith を呼ばずに素通しする（＝通常のネットワーク動作）。
 *
 * 更新の当て方:
 *   CACHE_VERSION を上げると古いキャッシュは activate 時に消える。
 *   skipWaiting + clients.claim で、次の読み込みから新しい資産に切り替わる。
 *
 * 取り外し方（不具合時）:
 *   ブラウザの DevTools → Application → Service Workers → Unregister。
 *   GitHub Pages で一度配ると自動では消えないので注意。
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `vcv-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `vcv-runtime-${CACHE_VERSION}`;

/** 見た目に必要な外部CDN。ホスト名の完全一致で判定する */
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

/**
 * 先読みするのはアプリ本体だけ。
 * QRライブラリ(51KB)と Firestore ストアは、ここに入れると
 * 体験版の来訪者全員が裏で取得してしまうため入れない。
 * どちらも「初めて使った時」にランタイムキャッシュへ入る。
 */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/app-firebase.js',
  './src/firebase-config.js',
  './src/qr.js',
  './src/storage/index.js',
  './src/storage/local.js',
  './src/storage/seed-tasks.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 1つでも失敗すると install ごと失敗するため、個別に追加して取りこぼしを許容する
    await Promise.all(SHELL_ASSETS.map((url) =>
      cache.add(url).catch((err) => console.warn('[vcv-sw] キャッシュできませんでした', url, err))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/**
 * 画面遷移はネットワーク優先。
 * 本体HTMLをキャッシュ優先にすると、更新を配信しても店舗端末が古い画面を
 * 出し続けてしまうため。オフラインのときだけキャッシュを返す。
 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put('./index.html', res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    throw err;
  }
}

/** キャッシュを見てから、裏でネットワーク更新もかける */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      // opaque(status 0) も CDN では正常。ok か opaque なら保存する
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;

  // 画面遷移だけは、オフラインでもアプリ本体を返して起動できるようにする
  if (request.mode === 'navigate') {
    const shell = await caches.open(SHELL_CACHE);
    const fallback = await shell.match('./index.html');
    if (fallback) return fallback;
  }
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    event.respondWith(request.mode === 'navigate'
      ? networkFirst(request)
      : staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Firebase / Firestore / 自作アプリ … 触らず素通し
});
