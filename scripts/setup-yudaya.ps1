<#
.SYNOPSIS
  株式会社ゆだや vcv - 一括セットアップスクリプト（Windows / PowerShell）

.DESCRIPTION
  Claude が自動化できない「あなたの手元の操作」だけをまとめて実行します。
    1. 前提ツール（Node.js / Firebase CLI）の確認とインストール
    2. Firebase へのログイン
    3. apiKey / appId を src/firebase-config.js へ書き込み
    4. 代表UID を firestore.rules へ書き込み
    5. Firestore セキュリティルールを本番へデプロイ
    6. GitHub への commit / push（任意）

  何度実行しても安全です（冪等）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-yudaya.ps1
#>

[CmdletBinding()]
param(
    [string]$ProjectId,
    [string]$ApiKey,
    [string]$AppId,
    [string]$OwnerUid,
    [switch]$SkipDeploy,
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------- helpers --
function Write-Step  ($n, $t) { Write-Host ""; Write-Host "=== [$n] $t ===" -ForegroundColor Cyan }
function Write-Ok    ($t)     { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2 ($t)     { Write-Host "  [警告] $t" -ForegroundColor Yellow }
function Write-Info  ($t)     { Write-Host "  $t" -ForegroundColor Gray }
function Write-Err2  ($t)     { Write-Host "  [失敗] $t" -ForegroundColor Red }

function Test-Command ($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# UTF-8 (BOMなし) で保存する。BOMが付くとブラウザ/JSパーサが誤作動するため必須。
function Save-Utf8NoBom ($path, $text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $enc)
}

function Read-Value ($prompt, $current, $example) {
    Write-Host ""
    Write-Host "  $prompt" -ForegroundColor White
    if ($example) { Write-Info "例: $example" }
    if ($current -and -not $current.StartsWith('REPLACE_WITH_')) {
        Write-Info "現在の設定値: $current"
        Write-Info "(変更しない場合はそのまま Enter)"
    }
    $v = Read-Host "  入力"
    if ([string]::IsNullOrWhiteSpace($v)) { return $current }
    return $v.Trim()
}

# ------------------------------------------------------------------ start --
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  株式会社ゆだや  バーチャルコンビニ vcv  セットアップ" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
Write-Info "リポジトリ: $RepoRoot"

$ConfigPath = Join-Path $RepoRoot 'src\firebase-config.js'
$RulesPath  = Join-Path $RepoRoot 'firestore.rules'

foreach ($p in @($ConfigPath, $RulesPath)) {
    if (-not (Test-Path $p)) {
        Write-Err2 "必要なファイルが見つかりません: $p"
        Write-Info "vcv リポジトリのルートで実行しているか確認してください。"
        exit 1
    }
}

# ------------------------------------------------- [1] 前提ツールのチェック --
Write-Step 1 "前提ツールの確認"

if (-not (Test-Command 'git')) {
    Write-Err2 "git が見つかりません。https://git-scm.com/ からインストールしてください。"
    exit 1
}
Write-Ok "git: $(git --version)"

if (-not (Test-Command 'node')) {
    Write-Err2 "Node.js が見つかりません。"
    Write-Info "https://nodejs.org/ja/ から LTS 版をインストールし、PowerShell を再起動してから再実行してください。"
    exit 1
}
Write-Ok "Node.js: $(node --version)"

if (-not (Test-Command 'firebase')) {
    Write-Warn2 "Firebase CLI が未インストールです。いまインストールします（数分かかります）..."
    npm install -g firebase-tools
    if ($LASTEXITCODE -ne 0) {
        Write-Err2 "firebase-tools のインストールに失敗しました。"
        Write-Info "管理者権限の PowerShell で 'npm install -g firebase-tools' を手動実行してください。"
        exit 1
    }
    if (-not (Test-Command 'firebase')) {
        Write-Err2 "インストールは完了しましたが firebase コマンドが見つかりません。"
        Write-Info "PowerShell を一度閉じて開き直し、このスクリプトを再実行してください。"
        exit 1
    }
}
Write-Ok "Firebase CLI: $(firebase --version)"

# ------------------------------------------------- [2] Firebase へログイン --
Write-Step 2 "Firebase へのログイン"

$loginList = (firebase login:list 2>&1 | Out-String)
if ($loginList -match 'No authorized accounts|ログインしていません') {
    Write-Info "ブラウザが開きます。湯田代表の Google アカウントでログインしてください..."
    firebase login
    if ($LASTEXITCODE -ne 0) { Write-Err2 "ログインに失敗しました。"; exit 1 }
}
Write-Ok "Firebase CLI ログイン済み"

# --------------------------------------------- [3] 設定値の入力と書き込み --
Write-Step 3 "Firebase プロジェクトの確認"

$configText = Get-Content $ConfigPath -Raw
$curProject = if ($configText -match "projectId:\s*'([^']*)'") { $Matches[1] } else { '' }

Write-Info "現在コードに設定されているプロジェクトID: $curProject"
Write-Info ""
Write-Info "あなたの Firebase アカウントで利用できるプロジェクト一覧:"
firebase projects:list

Write-Host ""
Write-Host "  ▼ 上の一覧に使いたいプロジェクトが無い場合" -ForegroundColor White
Write-Info "https://console.firebase.google.com/ を開き [プロジェクトを追加] で作成してください。"
Write-Info "作成後、Firestore Database と Authentication(Google) の有効化も必要です。"
Write-Info "作成が終わったら、このスクリプトを再実行してください。"

$ProjectId = Read-Value 'Project ID を入力してください（上の一覧の Project ID 列）' $curProject 'yudaya-vcv'
if (-not $ProjectId -or $ProjectId.StartsWith('REPLACE_WITH_')) { Write-Err2 'Project ID が未入力です。'; exit 1 }

# プロジェクトが実在するか確認（架空IDのまま進むのを防ぐ）
$projList = (firebase projects:list 2>&1 | Out-String)
if ($projList -notmatch [regex]::Escape($ProjectId)) {
    Write-Err2 "プロジェクト '$ProjectId' が一覧に見つかりません。"
    Write-Info 'IDの入力ミスか、プロジェクトが未作成です。'
    Write-Info 'https://console.firebase.google.com/ で作成してから再実行してください。'
    exit 1
}
Write-Ok "プロジェクト '$ProjectId' を確認しました"

$ConsoleBase = "https://console.firebase.google.com/project/$ProjectId"

Write-Step 4 "Firebase 接続設定 (src/firebase-config.js)"

Write-Host ""
Write-Host "  ▼ 値の取得場所" -ForegroundColor White
Write-Info "Firebase コンソール → プロジェクトの設定(歯車) → 全般 → マイアプリ → Web アプリ"
Write-Info "$ConsoleBase/settings/general"
Write-Info "（Web アプリが未登録なら、同じ画面の </> アイコンから追加してください）"
Write-Info ""
Write-Info "※ apiKey は秘密情報ではありません。Web アプリでは公開が前提で、"
Write-Info "   実際の防御は Firestore セキュリティルールが担います。"

$curApiKey = if ($configText -match "apiKey:\s*'([^']*)'") { $Matches[1] } else { '' }
$curAppId  = if ($configText -match "appId:\s*'([^']*)'")  { $Matches[1] } else { '' }

if (-not $ApiKey) { $ApiKey = Read-Value 'apiKey を入力してください' $curApiKey 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }
if (-not $AppId)  { $AppId  = Read-Value 'appId を入力してください'  $curAppId  '1:123456789012:web:abcdef1234567890' }

if (-not $ApiKey -or $ApiKey.StartsWith('REPLACE_WITH_')) { Write-Err2 'apiKey が未入力です。'; exit 1 }
if (-not $AppId  -or $AppId.StartsWith('REPLACE_WITH_'))  { Write-Err2 'appId が未入力です.';  exit 1 }

if ($ApiKey -notmatch '^AIza[0-9A-Za-z_\-]{30,}$') { Write-Warn2 "apiKey の形式が一般的な Firebase の形式と異なります。入力ミスにご注意ください。" }
if ($AppId  -notmatch '^\d+:\d+:web:[0-9a-f]+$')   { Write-Warn2 "appId の形式が一般的な Firebase の形式と異なります。入力ミスにご注意ください。" }

$configText = [regex]::Replace($configText, "(apiKey:\s*')[^']*(')",     "`${1}$ApiKey`${2}")
$configText = [regex]::Replace($configText, "(appId:\s*')[^']*(')",      "`${1}$AppId`${2}")
$configText = [regex]::Replace($configText, "(projectId:\s*')[^']*(')",  "`${1}$ProjectId`${2}")
$configText = [regex]::Replace($configText, "(authDomain:\s*')[^']*(')", "`${1}$ProjectId.firebaseapp.com`${2}")
Save-Utf8NoBom $ConfigPath $configText
Write-Ok "src/firebase-config.js を更新しました"

# .firebaserc もプロジェクトIDに追従させる
$RcPath = Join-Path $RepoRoot '.firebaserc'
Save-Utf8NoBom $RcPath ("{`n  `"projects`": {`n    `"default`": `"$ProjectId`"`n  }`n}`n")
Write-Ok ".firebaserc を更新しました"

# -------------------------------------------- [4] 代表UID をルールへ反映 --
Write-Step 5 "代表UID の設定 (firestore.rules)"

Write-Host ""
Write-Host "  ▼ UID の取得場所" -ForegroundColor White
Write-Info "Firebase コンソール → Authentication → Users → 該当アカウントの「ユーザーUID」列"
Write-Info "$ConsoleBase/authentication/users"
Write-Info ""
Write-Info "※ まだ一度もログインしたことがない場合、Users 一覧は空です。"
Write-Info "   その場合はいったんこのスクリプトを Ctrl+C で中断し、"
Write-Info "   Authentication → Sign-in method で「Google」を有効化 → vcv でログイン → 再実行してください。"

$rulesText = Get-Content $RulesPath -Raw
$curUid = if ($rulesText -match "request\.auth\.uid\s*==\s*'([^']*)'") { $Matches[1] } else { '' }

if (-not $OwnerUid) { $OwnerUid = Read-Value '代表の Firebase UID を入力してください' $curUid 'aBcDeFgHiJkLmNoPqRsTuVwXyZ12' }

if (-not $OwnerUid -or $OwnerUid.StartsWith('REPLACE_WITH_')) { Write-Err2 'UID が未入力です。'; exit 1 }
if ($OwnerUid -notmatch '^[A-Za-z0-9]{20,40}$') { Write-Warn2 "UID の形式が一般的な Firebase UID (28文字の英数字) と異なります。" }

$rulesText = [regex]::Replace($rulesText, "(request\.auth\.uid\s*==\s*')[^']*(')", "`${1}$OwnerUid`${2}")
Save-Utf8NoBom $RulesPath $rulesText
Write-Ok "firestore.rules を更新しました（代表UIDのみ許可）"

# ------------------------------------------------------ [5] ルールのデプロイ --
Write-Step 6 "Firestore セキュリティルールのデプロイ"

if ($SkipDeploy) {
    Write-Warn2 "-SkipDeploy が指定されたためスキップします。"
} else {
    Write-Info "本番プロジェクトへルールを反映します..."
    firebase deploy --only firestore:rules --project $ProjectId
    if ($LASTEXITCODE -ne 0) {
        Write-Err2 "ルールのデプロイに失敗しました。"
        Write-Info "Firestore データベースが未作成の可能性があります。コンソールで作成してから再実行してください:"
        Write-Info "$ConsoleBase/firestore"
        exit 1
    }
    Write-Ok "ルールをデプロイしました。これで実店舗データは代表以外から完全に遮断されます。"
}

# ------------------------------------------------------ [6] GitHub へ反映 --
Write-Step 7 "GitHub への反映"

if ($SkipPush) {
    Write-Warn2 "-SkipPush が指定されたためスキップします。"
} else {
    $changed = (git status --porcelain -- src/firebase-config.js firestore.rules .firebaserc | Out-String).Trim()
    if (-not $changed) {
        Write-Ok "コミットすべき変更はありません。"
    } else {
        Write-Host ""
        Write-Info "以下のファイルが変更されています:"
        git status --short -- src/firebase-config.js firestore.rules .firebaserc
        Write-Info ""
        Write-Info "※ apiKey / appId / UID はいずれも秘密情報ではなく、"
        Write-Info "   GitHub Pages で動作させるにはリポジトリに含める必要があります。"
        $ans = Read-Host "  コミットして push しますか? (y/N)"
        if ($ans -eq 'y' -or $ans -eq 'Y') {
            $branch = (git rev-parse --abbrev-ref HEAD).Trim()
            git add src/firebase-config.js firestore.rules .firebaserc
            git commit -m "chore: Firebase接続設定と代表UIDを設定"
            for ($i = 1; $i -le 5; $i++) {
                git push -u origin $branch
                if ($LASTEXITCODE -eq 0) { break }
                if ($i -eq 5) { Write-Err2 "push に失敗しました。ネットワークを確認して再実行してください。"; break }
                $wait = [math]::Pow(2, $i)
                Write-Warn2 "push に失敗しました。${wait} 秒後に再試行します... ($i/5)"
                Start-Sleep -Seconds $wait
            }
            if ($LASTEXITCODE -eq 0) { Write-Ok "push しました（ブランチ: $branch）" }
        } else {
            Write-Info "スキップしました。後で 'git add / commit / push' を実行してください。"
        }
    }
}

# ----------------------------------------------------------- 残りの手作業 --
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  セットアップ完了。残りはコンソールでの操作です。" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  [A] Google ログインを有効化（未設定の場合）" -ForegroundColor White
Write-Info "$ConsoleBase/authentication/providers"
Write-Info "→ Google を「有効」にして保存"
Write-Host ""
Write-Host "  [B] 承認済みドメインに GitHub Pages を追加" -ForegroundColor White
Write-Info "$ConsoleBase/authentication/settings"
Write-Info "→ 承認済みドメイン に 'yuda890201.github.io' を追加"
Write-Info "   （これが無いと公開URLでログインできません）"
Write-Host ""
Write-Host "  [C] 実店舗情報を Firestore へ登録" -ForegroundColor White
Write-Info "下記をブラウザで開き、代表アカウントでログインして店舗名を入力・保存してください。"
Write-Info "https://yuda890201.github.io/vcv/tools/seed-store-config.html"
Write-Info ""
Write-Warn2 "ローカルのHTMLファイルを直接ダブルクリックしても動きません。"
Write-Info "  ES モジュールの読み込みが file:// では遮断されるためです。"
Write-Info "  上記の公開URL（Pages に新コードが反映された後）から開いてください。"
Write-Info ""
Write-Info "※ 実店舗名はコードには一切書かれていません。ここで登録した内容が"
Write-Info "   代表ログイン時にのみ画面へ反映されます。"
Write-Host ""
Write-Host "  [D] 動作確認" -ForegroundColor White
Write-Info "https://yuda890201.github.io/vcv/ を開き、"
Write-Info "  ・未ログイン → 「ゆだや1号店 (モデル店)」と表示されること"
Write-Info "  ・代表ログイン後 → 実店舗名に切り替わること"
Write-Host ""
