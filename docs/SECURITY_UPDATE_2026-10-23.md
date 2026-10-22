# 2026-10-23 セキュリティ更新（v0.32.1）

## 更新内容

| 対象                     | 更新前                 | 更新後                      |
| ------------------------ | ---------------------- | --------------------------- |
| 開発・CI用Node.js        | 24.15.0                | 24.22.1                     |
| Electron                 | 44.3.0                 | 44.9.3                      |
| Electron内蔵Node.js      | 24.20.0                | 24.22.0（下記の残課題あり） |
| Electron内蔵Chromium     | 152.0.7977.78          | 152.0.7977.167              |
| adm-zip                  | 0.6.0                  | 0.6.1                       |
| Vite                     | 7.3.6                  | 7.3.7                       |
| brace-expansion          | 1.1.18 / 2.1.4 / 5.0.9 | 1.1.21 / 2.1.7 / 5.0.12     |
| fast-uri                 | 3.1.7                  | 3.1.9                       |
| http-cache-semantics     | 4.2.0                  | 4.3.0                       |
| source-map-js            | 1.2.1                  | 1.2.2                       |
| 配布ツールのglobal-agent | 3.0.0                  | 4.1.3                       |

既存のメジャーバージョンを維持し、ロックファイルに更新を固定しました。global-agentのみ、`@electron/get@3.1.0`配下に限定したoverrideで4.1.3に置き換えています。これは修正版のないsprintf-jsを、依存するroarrごと除くためです。呼び出し側が使うCommonJSの`bootstrap()` APIを維持していることと、PC内のHTTPプロキシ経由で通信できることを確認しました。electron-builder側がこの依存を更新した際はoverrideを再確認してください。

データベース構造・計算方法・Excelひな形は変更していません。検証は一時データで行い、日常使用している案件データは使用しません。

## 未解決：Electron内蔵Node.js

Node.jsは2026-10-21に24.22.1を公開しています。Brotliデコーダー、DNS・TLSなどのセキュリティ修正が含まれます。一方、確認時点のElectron安定版44.9.3および45.0.0が内蔵するNode.jsは24.22.0です。今回は同じ44系の安定版に更新し、10月21日のNode.js修正を取り込んだと確認できるElectronの公開を待つ状態です。**今回の更新で完全に対応済みとは扱いません。**

アプリ本体は公開HTTPサーバーを起動せず、Brotliの展開処理も直接呼び出していません。これだけで内蔵ランタイムの安全性を保証することはできません。npm auditはElectron内のNode.js・Chromiumの問題を網羅しないため、監査結果が0件でも、この残課題は別に追跡します。

次回はElectronの公式リリースノート・取り込み済み修正・実際の内蔵バージョンを確認し、修正を取り込んだ安定版へ更新してPDF・Excel・保存の検証を行ってください。開発用Node.jsの更新だけでインストール済みアプリ内のNode.jsは更新されません。

## 検査と再現

- npm監査は開発用・任意依存を含めて実施します。更新前は高5件・中10件のパッケージ指摘がありました（伝播した親パッケージを含み、独立した脆弱性の数ではありません）。
- 更新後の監査は全重要度0件でした。修正版のないsprintf-jsもロックファイルから除去済みです。監査対象外のElectron内蔵Node.jsについては、上記の残課題を維持します。
- Node.js 24.22.1でのクリーンインストール、型検査・本番ビルド、単体テスト178件が成功しました。
- Mac実画面テスト：拾い出し・集計Excel・床材の割り付け・集計/割り付けPDF・バックアップ復元、約515万文字の画像を含む大きなカーペットPDF、見積編集/選択ページPDF/印刷、壁クロスの割り付け/PDFが成功しました。
- 見積の印刷テストが旧data URL方式を前提としていたため、印刷ウィンドウに実際に読み込まれたHTMLを検証するよう修正しました。アプリ本体の印刷処理は変更していません。
- Mac arm64配布用ビルドが成功しました。作成したアプリのElectron/Node.js/Chromiumバージョン、adm-zip 0.6.1の同梱、開発ツールが配布アーカイブに含まれないことを確認しました。
- GitHub CIにも`npm audit --include=dev --include=optional --audit-level=moderate`を追加しました。Windows/macOSの両方で検査します。
- 開発環境はNode.js 24.22.1へ更新してから`npm ci`を実行します。nvm利用時はこのフォルダで`nvm install`、`nvm use`を実行します。nvm-windowsでは`nvm install 24.22.1`、`nvm use 24.22.1`とバージョンを指定します。
- Windows用の配布アプリは更新した依存から再ビルド・再インストールする必要があります。このMac上での検証だけではWindowsでの動作確認済みにはなりません。

## 公開情報

- [Node.js 2026-10-21セキュリティ修正](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Electron 44.9.3の内蔵バージョン・修正](https://releases.electronjs.org/release/v44.9.3)
- [adm-zipのメモリ割り当て問題](https://github.com/cthackers/adm-zip/security/advisories/GHSA-7q85-xj36-vmfc)
- [Vite開発ツールのWindows向け問題](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)
- [sprintf-jsの未修正の問題](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
- [global-agentのリリース履歴](https://github.com/gajus/global-agent/releases)
