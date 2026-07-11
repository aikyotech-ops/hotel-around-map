# 開発ワークフロー

- `main`へ直接コミット・pushしない。変更は必ず作業ブランチを切り、PRを作成すること。
- PR作成後は、GitHub Actions(`.github/workflows/pr-agent-review.yml`)によりOllamaが自動でコードレビューし、PRにコメントを投稿する。追加の修正commitをpushすると再レビューされる。
- レビュー内容を確認し、問題なければマージする。

<!-- ブランチ+PR運用の動作確認用コメント -->
