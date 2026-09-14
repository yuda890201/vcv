/**
 * 株式会社ゆだや vcv - 認証 ＆ Firestore 連携ブリッジ
 *
 * 設計方針（カモフラージュの実装）:
 *   1. 実店舗名・住所はクライアントコードに一切持たない。Firestore の
 *      config/stores（代表のみ読取可）から認証後に取得する。
 *   2. 「代表かどうか」をクライアント側のUID比較で判定しない。
 *      owner-only ドキュメントの読み取りを試み、成功＝代表 / permission-denied＝一般
 *      と判定する。つまり firestore.rules が唯一の判定根拠になる。
 *   3. Firebase SDK は「ログインボタンが押された時」に初めて動的 import する。
 *      一般来訪者（デモ）は SDK を1バイトも読み込まない＝低スペック端末でも軽い。
 *
 * index.html（classic script）との連携:
 *   - window.VCV_AUTH  … signIn / signOut / isConfigured
 *   - 'vcv:auth-state' CustomEvent … 状態が変わるたびに発火
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.8.0';

/** 読み込み済み Firebase コンテキスト（遅延生成） */
let ctx = null;
let unsubscribeAuth = null;

/**
 * 「このブラウザで代表がログインしたことがある」ヒント。
 * これは認証情報ではなく、リロード時に SDK を読むべきか判断するだけのフラグ。
 * 一般来訪者のブラウザには存在しないので、SDK は一切ダウンロードされない。
 */
const SESSION_HINT_KEY = 'vcv:owner-session';

/**
 * signInWithRedirect でページを離れる直前に立てるフラグ。
 * 戻ってきた時に getRedirectResult を拾うため、リスナーを起動する必要がある。
 */
const PENDING_REDIRECT_KEY = 'vcv:auth-redirect';

function readPendingRedirect() {
  try {
    return window.localStorage.getItem(PENDING_REDIRECT_KEY) === '1';
  } catch {
    return false;
  }
}

function writePendingRedirect(on) {
  try {
    if (on) window.localStorage.setItem(PENDING_REDIRECT_KEY, '1');
    else window.localStorage.removeItem(PENDING_REDIRECT_KEY);
  } catch {
    /* 無視して構わない */
  }
}

function readSessionHint() {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionHint(on) {
  try {
    if (on) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* プライベートモード等では無視して構わない */
  }
}

async function ensureFirebase() {
  if (ctx) return ctx;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-auth.js`),
    import(`${SDK_BASE}/firebase-firestore.js`)
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  ctx = {
    app,
    auth: authMod.getAuth(app),
    db: storeMod.getFirestore(app),
    authMod,
    storeMod
  };
  return ctx;
}

function emit(detail) {
  window.dispatchEvent(new CustomEvent('vcv:auth-state', { detail }));
}

/**
 * owner-only ドキュメントを読み、成功すれば代表と判定する。
 * @returns {Promise<object|null>} 店舗設定 or null（＝代表ではない）
 */
async function fetchOwnerStoreConfig() {
  const { db, storeMod } = await ensureFirebase();
  try {
    const snap = await storeMod.getDoc(storeMod.doc(db, 'config', 'stores'));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    if (err && err.code === 'permission-denied') return null;
    throw err;
  }
}

async function handleUser(user) {
  if (!user) {
    writeSessionHint(false);
    emit({ signedIn: false, isOwner: false, displayName: null, stores: null });
    return;
  }
  let stores = null;
  let error = null;
  try {
    stores = await fetchOwnerStoreConfig();
  } catch (err) {
    error = err;
  }
  writeSessionHint(Boolean(stores));
  emit({
    signedIn: true,
    isOwner: Boolean(stores),
    displayName: user.displayName || user.email || '代表',
    stores,
    error: error ? String(error.code || error.message || error) : null
  });
}

async function startAuthListener() {
  const { auth, authMod } = await ensureFirebase();
  if (unsubscribeAuth) return;
  unsubscribeAuth = authMod.onAuthStateChanged(auth, (user) => {
    handleUser(user).catch((err) => console.error('[vcv] auth state error', err));
  });

  // リダイレクト方式でログインした場合、戻ってきた時にここで結果を拾う
  if (readPendingRedirect()) {
    authMod
      .getRedirectResult(auth)
      .catch((err) => {
        console.error('[vcv] redirect sign-in failed', err);
        window.dispatchEvent(new CustomEvent('vcv:auth-error', { detail: { code: (err && err.code) || String(err) } }));
      })
      .finally(() => writePendingRedirect(false));
  }
}

window.VCV_AUTH = {
  isConfigured: isFirebaseConfigured,

  async signIn() {
    const { auth, authMod } = await ensureFirebase();
    await startAuthListener();
    const provider = new authMod.GoogleAuthProvider();
    try {
      await authMod.signInWithPopup(auth, provider);
    } catch (err) {
      const code = err && err.code;
      // ポップアップがブロックされる環境（ブロッカー、一部のアプリ内ブラウザ等）では
      // ページ遷移するリダイレクト方式へ自動で切り替える
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        writePendingRedirect(true);
        await authMod.signInWithRedirect(auth, provider);
        return;
      }
      throw err;
    }
  },

  async signOut() {
    if (!ctx) return;
    await ctx.authMod.signOut(ctx.auth);
  },

  /** 既存セッションの復帰（設定済み かつ 過去にログイン実績のあるブラウザのみ） */
  async restore() {
    if (!isFirebaseConfigured()) return;
    if (!readSessionHint() && !readPendingRedirect()) return;
    await startAuthListener();
  }
};

// リロード後もログイン状態を復帰させる。
// 未設定 or 一般来訪者のブラウザでは Firebase SDK を一切読み込まない。
window.VCV_AUTH.restore().catch((err) => console.error('[vcv] restore failed', err));

// ================= タスク（カンバン）連携 =================
// 代表ログイン時のみ Firestore の tasks コレクションを購読する。
// デモモードでは一切呼ばれない（index.html 側がモックを使う）。

let unsubscribeTasks = null;

window.VCV_DATA = {
  /**
   * tasks コレクションをリアルタイム購読する。
   * @param {(tasks: object[]) => void} onChange
   * @returns {Promise<() => void>} 購読解除関数
   */
  async subscribeTasks(onChange) {
    const { db, storeMod } = await ensureFirebase();
    if (unsubscribeTasks) unsubscribeTasks();
    unsubscribeTasks = storeMod.onSnapshot(
      storeMod.collection(db, 'tasks'),
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[vcv] tasks subscribe error', err)
    );
    return () => {
      if (unsubscribeTasks) unsubscribeTasks();
      unsubscribeTasks = null;
    };
  },

  unsubscribeTasks() {
    if (unsubscribeTasks) unsubscribeTasks();
    unsubscribeTasks = null;
  },

  /** 代表承認を確定し Firestore へ保存する */
  async approveTask(taskId, approverName) {
    const { db, storeMod } = await ensureFirebase();
    await storeMod.updateDoc(storeMod.doc(db, 'tasks', taskId), {
      status: 'done',
      approved_at: new Date().toISOString(),
      approved_by: approverName
    });
  },

  /** 差し戻し（点検中へ戻す） */
  async rejectTask(taskId, reason) {
    const { db, storeMod } = await ensureFirebase();
    await storeMod.updateDoc(storeMod.doc(db, 'tasks', taskId), {
      status: 'review',
      approved_at: null,
      approved_by: null,
      reject_reason: reason || ''
    });
  }
};
