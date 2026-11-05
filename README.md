# AIと育てる、自分用の家計簿

カードの利用通知から支出を取り込み、購入メールで品目を補完し、用途を暫定分類する個人用の家計簿です。後から本人が訂正した判断を自動処理で上書きしないことを重視しています。作者が企画・要件を判断し、実利用で改善しながら、AIコーディングエージェントと協働して開発しました。

Google Apps Script（GAS）が画面と保存処理を担い、Google Sheetsを正本にします。AIは用途や品目を提案し、コードは認証・重複・入力版・本人訂正保護・保存後の読戻しを検証します。すべての支出の捕捉や、請求額の確定を保証するものではありません。

**この配布物は、仕組みを読み、合成データで試し、自分用の環境を検討するための developer preview です。** クローンだけでメール連携や日次処理が動く製品ではありません。一般的なGmail/Driveコネクター、新しいGoogleアカウントでの認可・配備・定期実行は未実証です。公開前の条件と導入前の条件を [RELEASE-BLOCKERS.md](RELEASE-BLOCKERS.md) に分けて記載しています。

## 読む順序

- 仕組みを知る: [設計概要](docs/DESIGN.md)
- 合成データで試す: 下の「オフラインで試す」
- AIエージェントと導入を検討する: [AGENTS.md](AGENTS.md) と [セットアップ](docs/SETUP.md)
- メール取得・保存をつなぐ: [ランタイム契約](docs/RUNTIME.md)

## オフラインで試す

Node.js 18以上とPython 3.9以上が必要です。標準ライブラリのみを使用し、npm/pipパッケージ、APIキー、有料API、ネットワーク接続は不要です。以下はリポジトリのルートから実行します。

```sh
bash tools/test-all.sh
node webapp/tools/package.cjs
node tools/check-config.cjs config/profile.example.json
```

設定例の検査は **NOT_CONFIGUREDで停止するのが正しい結果** です。例のまま配備できないようにしています。設定検査は認証・アップロード・配備・スケジュール作成を行いません。GAS用の生成物は `webapp/build/gas/` に出力されます。

空の一時ディレクトリを使う合成デモ:

```sh
demo_dir="$(mktemp -d)"
python3 tools/demo.py "$demo_dir"
```

デモは架空の入力から prepare → validate → 合成commit → confirm を実行します。合成commitはローカルの保存シミュレーションであり、Google Sheetsへの書込みではありません。confirmは全行の読戻し内容と保存receiptを検査し、実行環境の実時計より未来の時刻も拒否します。デモが成功しても、実Google環境の認証・通信・保存が検証済みになるわけではありません。

## 対応範囲

初期プロファイルはGoogleアカウント、本人だけが使うGAS/Sheets/非公開Drive、日本語のSMBC/Vpass通知と既存の2種類のCSVパーサーです。対応する送信元・件名・カード・CSV列はコードで明示しています。未知の入力は保留し、金額ゼロや推測した購入として扱いません。CSVは任意の照合手段で、継続的な取込みの必須入力ではありません。

画面の日本語分類・8つの表示枠・一部の店舗判定・JSTの日付処理は現在の実装上の前提です。設定ファイルだけで任意の銀行・分類・言語・タイムゾーンへ対応できるとは限りません。変更には合成回帰テストが必要です。

## 配布物を検査する

```sh
python3 tools/release.py /tmp/kakeibo-preview.tar.gz
python3 tools/verify-package.py /tmp/kakeibo-preview.tar.gz
```

公開用アーカイブはソースと合成テストを対象にします。個人設定、認証情報、実メール、実CSV、実台帳、生成ログを追加しないでください。公開・リポジトリ作成・共有は所有者が最終確認して行います。既存の非公開リポジトリを公開せず、[公開チェックリスト](docs/PUBLISH.md) に従って新規の空リポジトリへ検証済みファイルだけを置いてください。

MITライセンスの著作権表示は、本人確認済みの「hirame6548」です。コード全体の過去の由来について、独立した全行確認を完了したものではありません。[THIRD_PARTY.md](THIRD_PARTY.md) と LICENSE を確認してください。

Privacy and safe reporting: [docs/PRIVACY.md](docs/PRIVACY.md).
