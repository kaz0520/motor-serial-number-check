# CLAUDE.md — 開発時の約束ごと（入庫記録アプリ）

このリポジトリで作業する際に**必ず守るルール**です。セッションが変わっても、
ここを読んで同じ運用を続けてください。

## 変更履歴は「Notion」と「Supabase」の両方に必ず残す

アプリに**意味のある変更（新機能・改善・修正・基盤）**を加えたら、その都度
**両方のデータベースに1行ずつ追記**すること（ユーザーの指示：2026-07-29）。

追記する項目（両方とも同じ内容）：
- `№`（通し番号・古い順）
- 日付（変更日）
- 種別：`新機能` / `改善` / `修正` / `基盤`
- 変更の要約
- 詳細
- （Supabaseのみ）対応するコミットメッセージ

### 保存先1: Supabase テーブル `public.changelog`
- プロジェクト ID：`yqlbidxvkvzyhvjgiohl`（kaz0520's Project）
- 列：`no, changed_on, category, summary, detail, commit_msg`
- 追記方法：`execute_sql` で INSERT

### 保存先2: Notion データベース「入庫記録アプリ 変更履歴（Changelog）」
- データベース URL：https://app.notion.com/p/1c6550ac1d7148fb9f7dfa35f1a469b7
- data_source_id：`ad5d66bb-8067-4a13-a8af-dafca97d645a`
- プロパティ：`変更内容`(title), `詳細`(text), `種別`(select), `日付`(date), `№`(number)
- 追記方法：`notion-create-pages`（parent に上記 data_source_id を指定）

> 補足：不具合対応の場合は、`TROUBLESHOOTING.md` と Supabase `troubleshooting`
> テーブル、Notionのトラブルシューティングページにも記録すると望ましい。

## その他の前提
- 公開URL：https://kaz0520.github.io/motor-serial-number-check/
- 開発ブランチ：`claude/qr-code-motor-app-b67zq5`
- push すると GitHub Actions が自動で GitHub Pages に公開される。
- 型番リストは `app.js` 冒頭の `const MODELS = [...]` で管理。
- データは各端末内（localStorage）に保存。外部送信なし。オフライン動作・AI不使用。
- 詳しい不具合と対処は `TROUBLESHOOTING.md` を参照。
