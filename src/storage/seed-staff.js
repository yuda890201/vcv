/**
 * 体験版（デモ）の名簿。
 * ------------------------------------------------------------------
 * ここに実在スタッフの氏名を書かないこと（CLAUDE.md ルール5）。
 * コードに置いてよいのは役割だけのダミー表記。
 * 実名が必要な場合は Firestore の config/staff（代表のみ読取可）に置き、
 * 認証成功後に取得して差し替える。
 *
 * 設計ルール3「スタッフ名簿と権限は、共通の土台に1つだけ置く」の実体。
 * 各画面がそれぞれ名簿を持たないよう、ここ1か所から配る。
 */
export const SEED_STAFF = [
  { id: 'manager',  label: '店長AI',   role: '店長',   station: 'office'    },
  { id: 'kitchen',  label: '厨房AI',   role: '厨房',   station: 'kitchen'   },
  { id: 'register', label: 'リーダーAI', role: 'リーダー', station: 'counter'  },
  { id: 'jiikun',   label: 'じい君',   role: '相談役', station: 'breakroom' }
];
