/**
 * 体験版（デモ）の初期タスク。
 * ------------------------------------------------------------------
 * ここに実店舗名・実スタッフ名を書かないこと（CLAUDE.md ルール5）。
 * ダミー表記のみ。初回起動時に1度だけ端末内へコピーされ、
 * 以降は利用者が編集した状態が localStorage に残る。
 */
export const SEED_TASKS = [
  {
    id: 'T-101',
    title: '翌週シフト希望集計とコマ割り策定',
    assignee: 'manager',
    status: 'approval',
    requires_approval: true,
    summary: '昼ピーク3名配置。予算比97.4%。',
    diff_preview: '+2名補強 (金曜夜間) / 総人件費 ¥248,500 週',
    db_target: 'ゆだやシフト管理DB'
  },
  {
    id: 'T-102',
    title: '14:00 レジ交代・釣銭準備金点検',
    assignee: 'register',
    status: 'approval',
    requires_approval: true,
    summary: '点検完了。違算0円。金庫在高一致。',
    diff_preview: 'POS1 ¥150,000 / POS2 ¥150,000 / 金庫 ¥482,000 (差異 ¥0)',
    db_target: 'ゆだや金庫・レジ引継ぎDB'
  },
  {
    id: 'T-103',
    title: 'ランチピーク前 チキン仕込み',
    assignee: 'kitchen',
    status: 'progress',
    requires_approval: false,
    summary: 'チキン24個仕込み中。油温175℃。',
    diff_preview: '',
    db_target: 'ゆだやFF調理・廃棄DB'
  },
  {
    id: 'T-104',
    title: '1号棚スナック 前出し・欠品チェック',
    assignee: 'kitchen',
    status: 'todo',
    requires_approval: false,
    summary: '朝勤帯の定例棚点検。',
    diff_preview: '',
    db_target: 'ゆだや棚点検DB'
  }
];
