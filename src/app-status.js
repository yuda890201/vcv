/**
 * アプリ状態連携（受信側）
 * ------------------------------------------------------------------
 * docs/APP_STATUS_PROTOCOL.md の v1 に対応。
 *
 * 設計ルール2「各アプリは今の状態を統一形式で返す口を1つ持つ。
 * ハブが各アプリの内部を直接のぞく形にしない」に従い、
 * iframe の中身は一切読まず、postMessage で返ってきたものだけを扱う。
 *
 * アプリ側が未対応でも壊れない。応答が無ければタイムアウトして静かに諦める。
 */

const PROTOCOL = 1;
const DEFAULT_TIMEOUT_MS = 2500;

/** アプリが載っているオリジン。ここ以外からのメッセージは無視する */
const TRUSTED_ORIGIN = 'https://yuda890201.github.io';

/** app_id → 直近の AppStatus。このセッション中だけ保持する */
const latest = new Map();
const pushListeners = new Set();

let seq = 0;
/** requestId → { resolve, timer, appId, source } */
const pending = new Map();

function isTrustedOrigin(origin) {
  if (origin === TRUSTED_ORIGIN) return true;
  // 本番(GitHub Pages)では上だけ。ローカル開発で自前サーバから開いた時だけ緩める
  if (window.location.origin !== TRUSTED_ORIGIN && origin === window.location.origin) return true;
  return false;
}

/**
 * 今 iframe に載せているアプリ。
 * 12アプリはすべて同一オリジンのため、payload の app_id を信じると
 * あるアプリのバグが別アプリの表示を書き換えられてしまう。
 * 「どのアプリの状態か」は送信元フレームから決め、自己申告は採用しない。
 */
let bound = null;   // { window, appId }

function sourceAppId(source) {
  if (!bound || !source) return null;
  return source === bound.window ? bound.appId : null;
}

/**
 * 受け取った payload を検証する。
 * 必須項目が欠けているものは捨てる（壊れた表示を出さないため）。
 */
function sanitize(payload, expectedAppId) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.summary !== 'string' || !payload.summary.trim()) return null;

  const appId = typeof payload.app_id === 'string' && payload.app_id ? payload.app_id : expectedAppId;
  if (!appId) return null;

  const levels = ['ok', 'info', 'warn', 'alert'];
  let badge = null;
  if (payload.badge && typeof payload.badge === 'object') {
    const count = Number(payload.badge.count);
    badge = {
      count: Number.isFinite(count) ? count : 0,
      level: levels.includes(payload.badge.level) ? payload.badge.level : 'info'
    };
  }

  const items = Array.isArray(payload.items)
    ? payload.items.slice(0, 5).filter((it) => it && typeof it.label === 'string').map((it) => ({
        id: String(it.id || ''),
        label: String(it.label),
        level: levels.includes(it.level) ? it.level : 'info',
        at: typeof it.at === 'string' ? it.at : null
      }))
    : [];

  return {
    app_id: appId,
    updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : new Date().toISOString(),
    summary: payload.summary.trim().slice(0, 40),
    badge,
    items,
    received_at: new Date().toISOString()
  };
}

window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.__vcv !== PROTOCOL) return;
  if (!isTrustedOrigin(ev.origin)) return;

  if (d.type === 'status:response') {
    const entry = pending.get(d.requestId);
    if (!entry) return;                       // 期限切れ、または身に覚えのない応答
    if (entry.source && ev.source !== entry.source) return;  // 問い合わせ先以外からの返事は捨てる
    clearTimeout(entry.timer);
    pending.delete(d.requestId);
    const status = sanitize(d.payload, entry.appId);
    if (status) {
      status.app_id = entry.appId;            // 問い合わせた相手の分として扱う
      latest.set(status.app_id, status);
    }
    entry.resolve(status);
    return;
  }

  if (d.type === 'status:push') {
    const appId = sourceAppId(ev.source);
    if (!appId) return;                       // 開いているアプリ以外からの通知は無視する
    const status = sanitize(d.payload, appId);
    if (!status) return;
    status.app_id = appId;                    // 自己申告ではなく送信元で決める
    latest.set(status.app_id, status);
    pushListeners.forEach((fn) => {
      try { fn(status); } catch (err) { console.error('[vcv] status push listener failed', err); }
    });
  }
});

/**
 * iframe の中のアプリに状態を問い合わせる。
 * @param {HTMLIFrameElement} frame
 * @param {string} appId
 * @returns {Promise<object|null>} 応答が無ければ null
 */
function request(frame, appId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!frame || !frame.contentWindow) return Promise.resolve(null);

  const requestId = `r-${Date.now()}-${seq += 1}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);          // 未対応アプリはここに来る。エラーにはしない
    }, timeoutMs);

    pending.set(requestId, { resolve, timer, appId, source: frame.contentWindow });

    try {
      // iframe の src は常に GitHub Pages なので宛先を固定する。
      // '*' にすると、将来 iframe の行き先が変わったときに黙って別サイトへ届く
      frame.contentWindow.postMessage(
        { __vcv: PROTOCOL, type: 'status:request', requestId },
        TRUSTED_ORIGIN
      );
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      console.warn('[vcv] status request failed', appId, err);
      resolve(null);
    }
  });
}

window.VCV_STATUS = {
  request,
  /** iframe に載せたアプリを登録する。自発通知の送信元判定に使う */
  bind(frame, appId) {
    bound = (frame && frame.contentWindow) ? { window: frame.contentWindow, appId } : null;
  },
  unbind() { bound = null; },
  /** 直近に受け取った状態（このセッション中のみ） */
  get(appId) { return latest.get(appId) || null; },
  all() { return Array.from(latest.values()); },
  /** アプリからの自発通知を受け取る */
  onPush(fn) { pushListeners.add(fn); return () => pushListeners.delete(fn); }
};
