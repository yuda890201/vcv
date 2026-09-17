<#
.SYNOPSIS
  株式会社ゆだや vcv - セットアップ＆診断 一括スクリプト

.DESCRIPTION
  これ1本で以下を行います。何度実行しても同じ結果になります（冪等）。

    1. 前提チェック（git / node / firebase-tools）
    2. 最新コードの取り込み（git pull）
    3. Firebase 接続設定の読み取り
    4. ★ログイン不具合の自動診断★
         ブラウザのコンソールを読まなくても、
         「Authentication が未有効」「承認済みドメイン未登録」
         「Firestore 未作成」のどれなのかを切り分けます
    5. 代表UIDをルールに書き込み、Firestore ルールをデプロイ
    6. コミット＆プッシュ
    7. 残っている手作業の案内

.PARAMETER OwnerUid
  代表の Firebase UID。省略すると診断だけ行い、後から聞かれます。

.PARAMETER DiagnoseOnly
  診断だけ行い、書き込み・デプロイ・プッシュをしません。

.EXAMPLE
  .\scripts\yudaya-setup.ps1
  .\scripts\yudaya-setup.ps1 -DiagnoseOnly
  .\scripts\yudaya-setup.ps1 -OwnerUid "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
#>

[CmdletBinding()]
param(
  [string]$RepoPath   = (Split-Path -Parent $PSScriptRoot),
  [string]$OwnerUid   = "",
  [string]$ApiKey     = "",
  [string]$AppId      = "",
  [switch]$DiagnoseOnly,
  [switch]$SkipPull,
  [switch]$SkipDeploy,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
# PowerShell 5.1 は既定で TLS1.0 のことがあるため明示する
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PAGES_DOMAIN = "yuda890201.github.io"

function Write-Step($n, $t) { Write-Host ""; Write-Host "===== [$n] $t =====" -ForegroundColor Cyan }
function Write-Ok($t)       { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t)    { Write-Host "  [注意] $t" -ForegroundColor Yellow }
function Write-Ng($t)       { Write-Host "  [NG]   $t" -ForegroundColor Red }
function Write-Info($t)     { Write-Host "         $t" -ForegroundColor Gray }

function Test-Cmd($name) {
  $null = Get-Command $name -ErrorAction SilentlyContinue
  return $?
}

# HTTP を投げて、成否とステータスと本文を必ず返す（例外で止めない）
function Invoke-Api {
  param([string]$Url, [string]$Method = "GET")
  $r = @{ ok = $false; status = 0; body = "" }
  try {
    $res = Invoke-WebRequest -Uri $Url -Method $Method -UseBasicParsing -TimeoutSec 20
    $r.ok = $true; $r.status = [int]$res.StatusCode; $r.body = $res.Content
  } catch {
    $resp = $_.Exception.Response
    if ($resp -ne $null) {
      try { $r.status = [int]$resp.StatusCode } catch {}
      try {
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $r.body = $sr.ReadToEnd(); $sr.Close()
      } catch {}
    }
    if (-not $r.body -and $_.ErrorDetails) { $r.body = $_.ErrorDetails.Message }
    if (-not $r.body) { $r.body = $_.Exception.Message }
  }
  return $r
}

function Save-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Text, $enc)
}

# ---------------------------------------------------------------- 1
Write-Step 1 "前提チェック"
if (-not (Test-Path $RepoPath)) { Write-Ng "リポジトリが見つかりません: $RepoPath"; exit 1 }
Set-Location $RepoPath
Write-Ok "作業ディレクトリ: $RepoPath"

foreach ($c in @("git","node","npm")) {
  if (Test-Cmd $c) { Write-Ok "$c あり" } else { Write-Ng "$c が見つかりません。インストールしてください。"; exit 1 }
}
if (-not (Test-Cmd "firebase")) {
  Write-Warn2 "firebase-tools が未導入です。導入します..."
  npm install -g firebase-tools
  if ($LASTEXITCODE -ne 0) { Write-Ng "firebase-tools の導入に失敗しました。"; exit 1 }
}
Write-Ok "firebase-tools あり"

# ---------------------------------------------------------------- 2
Write-Step 2 "最新コードの取り込み"
if ($SkipPull) {
  Write-Info "-SkipPull が指定されたので飛ばします"
} else {
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  Write-Info "現在のブランチ: $branch"
  $dirty = git status --porcelain
  if ($dirty) {
    Write-Warn2 "未コミットの変更があります。pull は行いません。"
    Write-Info "内容を確認してから手動で pull してください: git status"
  } else {
    git pull origin $branch
    if ($LASTEXITCODE -eq 0) { Write-Ok "取り込みました" } else { Write-Warn2 "pull に失敗しました（ネットワーク等）。続行します。" }
  }
}

# ---------------------------------------------------------------- 3
Write-Step 3 "Firebase 接続設定の読み取り"
$cfgPath = Join-Path $RepoPath "src\firebase-config.js"
if (-not (Test-Path $cfgPath)) { Write-Ng "$cfgPath がありません"; exit 1 }
$cfgText = Get-Content $cfgPath -Raw -Encoding UTF8

function Get-CfgValue([string]$key) {
  $m = [regex]::Match($cfgText, "$key\s*:\s*'([^']*)'")
  if ($m.Success) { return $m.Groups[1].Value } else { return "" }
}

if ($ApiKey) { $cfgText = [regex]::Replace($cfgText, "(apiKey\s*:\s*')[^']*(')", "`${1}$ApiKey`${2}"); Save-Utf8NoBom $cfgPath $cfgText; Write-Ok "apiKey を更新しました" }
if ($AppId)  { $cfgText = [regex]::Replace($cfgText, "(appId\s*:\s*')[^']*(')",  "`${1}$AppId`${2}");  Save-Utf8NoBom $cfgPath $cfgText; Write-Ok "appId を更新しました" }

$apiKey     = Get-CfgValue "apiKey"
$projectId  = Get-CfgValue "projectId"
$authDomain = Get-CfgValue "authDomain"

if (-not $apiKey -or $apiKey.StartsWith("REPLACE_WITH_")) {
  Write-Ng "apiKey が未設定です。-ApiKey を付けて実行し直してください。"
  exit 1
}
Write-Ok "projectId : $projectId"
Write-Ok "authDomain: $authDomain"
Write-Info "apiKey    : $($apiKey.Substring(0,[Math]::Min(10,$apiKey.Length)))... （Webの apiKey は秘密情報ではありません）"

# ---------------------------------------------------------------- 4
Write-Step 4 "ログイン不具合の自動診断"
$problems = New-Object System.Collections.Generic.List[string]

# 4-1 Authentication が有効になっているか
Write-Host "  -- Authentication --"
$auth = Invoke-Api "https://identitytoolkit.googleapis.com/v1/projects?key=$apiKey"
if ($auth.ok) {
  Write-Ok "Authentication は有効です"

  # 4-2 承認済みドメイン
  $domains = @()
  try { $domains = (ConvertFrom-Json $auth.body).authorizedDomains } catch {}
  if ($domains -contains $PAGES_DOMAIN) {
    Write-Ok "承認済みドメインに $PAGES_DOMAIN が入っています"
  } else {
    Write-Ng "承認済みドメインに $PAGES_DOMAIN がありません"
    Write-Info "→ https://console.firebase.google.com/project/$projectId/authentication/settings"
    Write-Info "   「承認済みドメイン」に $PAGES_DOMAIN を追加してください"
    $problems.Add("承認済みドメインに $PAGES_DOMAIN を追加")
  }
  if ($domains -contains "localhost") {
    Write-Ok "localhost も入っています（ローカル確認できます）"
  } else {
    Write-Warn2 "localhost が入っていません。手元での確認ができません。"
  }
  # Google プロバイダの有効/無効は、このAPIからは分からない（外から読めない）
  Write-Warn2 "Google プロバイダの有効状態はここからは確認できません"
  Write-Info "→ https://console.firebase.google.com/project/$projectId/authentication/providers"
  Write-Info "   Google が「有効」になっているか目視で確認してください"
  Write-Info "   無効だとログイン時に auth/operation-not-allowed が出ます"
} else {
  if ($auth.body -match "CONFIGURATION_NOT_FOUND") {
    Write-Ng "Authentication がまだ開始されていません ← ログイン画面が出ない原因はこれです"
    Write-Info "→ https://console.firebase.google.com/project/$projectId/authentication"
    Write-Info "   「始める」を押し、Google プロバイダを有効にしてください"
    $problems.Add("Authentication を開始し Google プロバイダを有効化")
  } elseif ($auth.body -match "API key not valid") {
    Write-Ng "apiKey が正しくありません"
    Write-Info "→ Firebase コンソールのウェブアプリ設定から取り直してください"
    $problems.Add("apiKey を取り直す")
  } else {
    Write-Ng "Authentication を確認できませんでした (HTTP $($auth.status))"
    Write-Info $auth.body
    $problems.Add("Authentication の状態を要確認")
  }
}

# 4-3 ログイン用ハンドラが配信されているか
Write-Host "  -- ログインハンドラ --"
if ($authDomain) {
  $handler = Invoke-Api "https://$authDomain/__/auth/handler"
  if ($handler.ok) {
    Write-Ok "https://$authDomain/__/auth/handler に到達できます"
  } elseif ($handler.status -eq 0) {
    # ステータス0はサーバの返事ではなく「そもそも繋がらなかった」。
    # 社内プロキシやオフラインでも起きるので、不具合として数えない。
    Write-Warn2 "ログインハンドラに接続できませんでした（ネットワーク側の可能性）"
    Write-Info "この判定は飛ばします。上の Authentication の結果を見てください。"
  } elseif ($handler.status -eq 404) {
    Write-Ng "ログインハンドラが 404 です。Authentication が未開始の可能性があります。"
    Write-Info "→ https://console.firebase.google.com/project/$projectId/authentication"
    if (-not ($problems -match "Authentication")) { $problems.Add("Authentication の開始を確認") }
  } else {
    Write-Warn2 "ログインハンドラの応答が想定外です (HTTP $($handler.status))"
  }
}

# 4-4 Firestore が作成されているか
Write-Host "  -- Firestore --"
$fs = Invoke-Api "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/config/stores"
if ($fs.body -match "does not exist" -or $fs.body -match "NOT_FOUND.*database") {
  Write-Ng "Firestore データベースがまだ作成されていません"
  Write-Info "→ https://console.firebase.google.com/project/$projectId/firestore"
  Write-Info "   「データベースを作成」→ 本番環境モード → リージョン asia-northeast1 を推奨"
  $problems.Add("Firestore データベースを作成")
} elseif ($fs.status -eq 403 -or $fs.body -match "PERMISSION_DENIED" -or $fs.body -match "Missing or insufficient") {
  Write-Ok "Firestore は作成済みで、未認証からは拒否されています（正しい状態です）"
} elseif ($fs.ok) {
  Write-Ng "未認証で config/stores が読めてしまいました。ルールが緩すぎます。"
  Write-Info "このスクリプトの [5] でルールをデプロイして塞いでください"
  $problems.Add("Firestore ルールをデプロイして塞ぐ")
} else {
  Write-Warn2 "Firestore の状態を判定できませんでした (HTTP $($fs.status))"
  Write-Info $fs.body
}

# 診断まとめ
Write-Host ""
if ($problems.Count -eq 0) {
  Write-Host "  診断結果: 問題は見つかりませんでした。" -ForegroundColor Green
} else {
  Write-Host "  診断結果: 対応が必要な項目が $($problems.Count) 件あります" -ForegroundColor Yellow
  $i = 1
  foreach ($p in $problems) { Write-Host "    $i. $p" -ForegroundColor Yellow; $i++ }
  Write-Host ""
  Write-Host "  ※ 上のコンソールURLで対応したあと、このスクリプトをもう一度実行してください。" -ForegroundColor Yellow
}

if ($DiagnoseOnly) { Write-Host ""; Write-Host "-DiagnoseOnly のため、ここで終了します。" -ForegroundColor Cyan; exit 0 }

# ---------------------------------------------------------------- 5
Write-Step 5 "代表UIDの設定と Firestore ルールのデプロイ"
$rulesPath = Join-Path $RepoPath "firestore.rules"
$rulesText = Get-Content $rulesPath -Raw -Encoding UTF8
$currentUid = ""
$m = [regex]::Match($rulesText, "request\.auth\.uid\s*==\s*'([^']*)'")
if ($m.Success) { $currentUid = $m.Groups[1].Value }

if (-not $OwnerUid) {
  if ($currentUid -and -not $currentUid.StartsWith("REPLACE_WITH_")) {
    Write-Ok "代表UIDは設定済みです: $currentUid"
    $OwnerUid = $currentUid
  } else {
    Write-Host ""
    Write-Host "  代表UIDがまだ未設定です。" -ForegroundColor Yellow
    Write-Info "取得方法: 上の [4] をすべて解消 → アプリでGoogleログイン →"
    Write-Info "  https://console.firebase.google.com/project/$projectId/authentication/users"
    Write-Info "  の「ユーザーUID」列の値（28文字程度の英数字）"
    Write-Host ""
    $OwnerUid = (Read-Host "  代表UID（まだ分からなければ空のまま Enter）").Trim()
  }
}

if ($OwnerUid) {
  if ($OwnerUid -notmatch '^[A-Za-z0-9]{20,64}$') {
    Write-Warn2 "UIDの形式が想定と違います: $OwnerUid"
    Write-Info "メールアドレスや表示名ではなく「ユーザーUID」を入れてください。"
  } else {
    $newRules = [regex]::Replace($rulesText, "(request\.auth\.uid\s*==\s*')[^']*(')", "`${1}$OwnerUid`${2}")
    if ($newRules -ne $rulesText) { Save-Utf8NoBom $rulesPath $newRules; Write-Ok "firestore.rules に代表UIDを書き込みました" }
    else { Write-Ok "firestore.rules は既に最新です" }

    if ($SkipDeploy) {
      Write-Info "-SkipDeploy のためデプロイは行いません"
    } elseif ($problems.Count -gt 0) {
      Write-Warn2 "未解消の項目があるためデプロイは行いません。上の対応後にもう一度実行してください。"
    } else {
      Write-Info "firebase にログインします（ブラウザが開きます。済んでいれば一瞬で終わります）"
      firebase login
      firebase deploy --only firestore:rules --project $projectId
      if ($LASTEXITCODE -eq 0) { Write-Ok "Firestore ルールをデプロイしました" }
      else { Write-Ng "デプロイに失敗しました。上のメッセージを確認してください。" }
    }
  }
} else {
  Write-Info "UID未入力のため、ルールの書き込みは行いませんでした"
}

# ---------------------------------------------------------------- 6
Write-Step 6 "コミット＆プッシュ"
if ($SkipPush) {
  Write-Info "-SkipPush のため行いません"
} else {
  $dirty = git status --porcelain
  if (-not $dirty) {
    Write-Ok "変更はありません"
  } else {
    git add firestore.rules src/firebase-config.js
    $staged = git diff --cached --name-only
    if ($staged) {
      $msgFile = Join-Path $env:TEMP "vcv-commit-msg.txt"
      Save-Utf8NoBom $msgFile "chore: Firebase 接続設定と代表UIDを反映`n`n（yudaya-setup.ps1 による自動更新）`n"
      git commit -F $msgFile
      Remove-Item $msgFile -ErrorAction SilentlyContinue
      $branch = (git rev-parse --abbrev-ref HEAD).Trim()
      git push -u origin $branch
      if ($LASTEXITCODE -eq 0) { Write-Ok "プッシュしました" } else { Write-Warn2 "プッシュに失敗しました。ネットワークを確認してください。" }
    } else {
      Write-Info "コミット対象はありませんでした"
    }
  }
}

# ---------------------------------------------------------------- 7
Write-Step 7 "残っている手作業"
Write-Host ""
if ($problems.Count -gt 0) {
  Write-Host "  まず [4] の項目を Firebase コンソールで対応し、このスクリプトを再実行してください。" -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "  A) 履歴の消去（未実施なら）" -ForegroundColor White
Write-Info  "   purge-history.ps1 を実行してください。"
Write-Info  "   ※ このスクリプトはリポジトリの外に置いたままにしてください。"
Write-Info  "     中に実店舗名の一覧を持っているため、コミットすると履歴に戻ります。"
Write-Host ""
Write-Host "  B) 実店舗情報の登録（A のあと）" -ForegroundColor White
Write-Info  "   https://$PAGES_DOMAIN/vcv/tools/seed-store-config.html"
Write-Info  "   ※ ファイルをダブルクリックしても動きません（ESモジュールのため）"
Write-Host ""
Write-Host "  C) スタッフ名を実名にする場合（任意）" -ForegroundColor White
Write-Info  "   Firestore の config/staff に下記の形で登録してください。"
Write-Info  '   { "members": [ { "id": "manager", "label": "…" }, { "id": "kitchen", "label": "…" } ] }'
Write-Info  "   id は manager / kitchen / register / jiikun の4つです。"
Write-Info  "   コード側には役割だけのダミー表記しか置きません。"
Write-Host ""
Write-Host "  D) 実機での確認" -ForegroundColor White
Write-Info  "   1. 店用スマホのカメラでQRを読み取れるか"
Write-Info  "   2. 「ホーム画面に追加」でアプリとして起動するか"
Write-Host ""
Write-Host "完了しました。" -ForegroundColor Cyan
