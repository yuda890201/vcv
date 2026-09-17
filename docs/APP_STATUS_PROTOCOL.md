# アプリ状態連携プロトコル v1（共通ルール）

各アプリが「今の状態」を統一形式で返すための取り決めです。
バーチャルコンビニ（vcv）が各アプリの最新情報を集約して表示するために使います。

**この文書が正本です。** 各アプリの改修時はこれを渡してください。

---

## 1. 原則

- **ハブは各アプリの内部を直接のぞかない。** 同一オリジン（`yuda890201.github.io`）
  なので技術的には DOM も localStorage も読めてしまいますが、読みません。
  アプリ側が「返すと決めたもの」だけを postMessage で受け取ります。
- **アプリ側は何も実装しなくても壊れません。** 応答が無ければ vcv は
  タイムアウトして静かに諦めます。段階的に対応できます。
- **返すのは要約だけ。** 生データ・明細・個人情報は返しません。

---

## 2. ⚠️ 共有端末に出る前提で作ること

vcv は**店舗共有タブレット**で表示されます。誰が見てもよい情報だけを返してください。

| 返してよい | 返してはいけない |
|---|---|
| 「未処理 3件」「本日の点検 完了」 | スタッフの実名・個人の勤怠 |
| 「要確認あり」 | 金庫の在高・売上金額などの金額 |
| 最終更新時刻 | 顧客情報、実店舗名・住所 |

金額や個人名が必要な作業は、QRで店用スマホに渡してそちらで見てください
（vcv は QR 受け渡しに対応済み）。

---

## 3. データ形式（AppStatus）

```js
{
  app_id: 'kinko-app',            // 必須。GitHubリポジトリ名と揃える
                                  //   ※ vcv 側は「どの iframe から来たか」で
                                  //     所属を決めるため、ここを偽っても他アプリの
                                  //     表示は書き換えられません
  updated_at: '2026-09-17T05:30:00.000Z',  // 必須。ISO8601
  summary: '本日の引継ぎ 未完了',   // 必須。20文字程度まで。共有端末に出る一行
  badge: {                        // 任意
    count: 3,                     //   数値。0 ならバッジを出さない
    level: 'warn'                 //   'ok' | 'info' | 'warn' | 'alert'
  },
  items: [                        // 任意。最大5件。多いものは返さない
    { id: 'a1', label: 'レジ2 未確認', level: 'warn', at: '2026-09-17T05:00:00.000Z' }
  ]
}
```

`level` の意味:

| level | 色 | 使いどころ |
|---|---|---|
| `ok` | 緑 | 完了している・問題なし |
| `info` | 青 | 情報として知らせたい |
| `warn` | 黄 | 未処理がある・期限が近い |
| `alert` | 赤 | 対応が必要 |

---

## 4. やりとり（v1）

vcv が iframe でアプリを開いたとき、または裏で問い合わせたときに使います。

### 問い合わせ（vcv → アプリ）

```js
{ __vcv: 1, type: 'status:request', requestId: 'r-1737...' }
```

### 応答（アプリ → vcv）

`requestId` をそのまま返してください。

```js
{ __vcv: 1, type: 'status:response', requestId: 'r-1737...', payload: { /* AppStatus */ } }
```

### 自発的な通知（アプリ → vcv、任意）

状態が変わったときにアプリ側から送れます。`requestId` は不要です。

```js
{ __vcv: 1, type: 'status:push', payload: { /* AppStatus */ } }
```

---

## 5. アプリ側の実装（コピーして使えます）

```js
/**
 * vcv 状態連携 v1
 * docs/APP_STATUS_PROTOCOL.md 準拠
 */
(function () {
  const APP_ID = 'kinko-app';   // ← 自分のリポジトリ名に変える

  /** 共有端末に出しても問題ない要約だけを組み立てる */
  function buildStatus() {
    return {
      app_id: APP_ID,
      updated_at: new Date().toISOString(),
      summary: '未処理 3件',
      badge: { count: 3, level: 'warn' }
    };
  }

  function reply(target, origin, requestId) {
    target.postMessage(
      { __vcv: 1, type: 'status:response', requestId, payload: buildStatus() },
      origin
    );
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__vcv !== 1 || d.type !== 'status:request') return;
    // 送り主にだけ返す。origin を '*' にしないこと
    reply(ev.source, ev.origin, d.requestId);
  });

  /** 状態が変わったら呼ぶ（任意） */
  window.notifyVcv = function () {
    if (window.parent === window) return;   // 単体で開かれている時は何もしない
    window.parent.postMessage({ __vcv: 1, type: 'status:push', payload: buildStatus() }, '*');
  };
})();
```

### 実装時の注意

- **応答は `ev.origin` 宛てに返す。** `'*'` にすると、別サイトに埋め込まれたときに
  中身が漏れます。
- **`window.parent === window` のとき（単体で開かれている）は何もしない。**
- **重い計算をしない。** 問い合わせは画面表示のたびに飛びます。
  すでに画面に出している値をそのまま返す程度にしてください。
- **自発通知 (`status:push`) は vcv に開かれている間だけ届きます。**
  12アプリはすべて同一オリジンのため、vcv は送信元フレームを見て
  「今開いているアプリからの通知」以外を捨てます。

---

## 6. vcv 側の実装状況

- 受信口は実装済み（`src/app-status.js`）。アプリが応答すれば表示に反映されます
- **どのアプリもまだ応答しません。** 現状は毎回タイムアウトして何も起きません
- ハブとしての集約表示（全アプリを一覧して状態を出す）は、
  各アプリの「返す口」が揃ってから着手します

---

## 7. 変更するとき

このプロトコルを変える場合は `__vcv` のバージョン番号を上げ、
vcv 側が旧バージョンも受け取れる状態にしてから各アプリを移行してください。
先にアプリ側を変えると、移行中のアプリが無言になります。
