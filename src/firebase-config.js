/**
 * 株式会社ゆだや vcv - Firebase 接続設定
 *
 * 【重要 / apiKey について】
 *   Firebase Web の apiKey は「秘密情報ではありません」。プロジェクトを識別するための
 *   公開識別子であり、GitHub Pages で配信する以上クライアントに含める必要があります。
 *   実際の防御は firestore.rules（代表UIDのみ読み書き可）が担います。
 *
 * 【禁止事項】
 *   このファイルに実店舗名・住所・スタッフ実名などを書かないこと。
 *   それらは Firestore の config/stores（代表のみ読取可）に置き、認証後に取得します。
 *
 * 値は scripts/setup-yudaya.ps1 が自動で書き込みます（手書きでも可）。
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyD-f83FKVDNRm5qOLMAzA7iepUIE_5WbvM',
  authDomain: 'yudaya-vcv.firebaseapp.com',
  projectId: 'yudaya-vcv',
  appId: '1:778196647921:web:935f588598c3dc4c590e50'
};

/** 設定が実値で埋まっているか（未設定ならアプリはデモモードのまま動く） */
export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(
    (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('REPLACE_WITH_')
  );
}
