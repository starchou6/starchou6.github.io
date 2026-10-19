---
title: "30分で無料ブログ：Hugo + GitHub Pages をゼロから構築"
date: 2026-03-29
draft: false
tags: ["hugo", "github-pages", "devops", "blogging"]
categories: ["Engineering"]
description: "サーバーもホスティング費用も CMS も不要。必要なのは Markdown と git push だけ。高速でプロフェッショナルなブログを、30分以内に無料で公開する方法を紹介します。"
ShowToc: true
---

サーバーもホスティング費用も CMS も不要。必要なのは Markdown と git push だけ。高速でプロフェッショナルなブログを、30分以内に無料で公開する方法を紹介します。

---

## パート1：GitHub と GitHub Actions でデプロイする

### パイプラインの仕組み

`main` ブランチに push するたびに、GitHub Actions が自動的に次の処理を行います。

1. リポジトリをチェックアウトする
2. PaperMod テーマを `themes/PaperMod` にクローンする
3. Hugo Extended をインストールする
4. `hugo --minify` を実行して、静的サイトを `public/` フォルダにビルドする
5. `public/` フォルダをデプロイ用アーティファクトとしてアップロードする
6. GitHub Pages にデプロイする

全体で 20〜30 秒ほどです。Markdown を書いて push すれば、記事が公開されます。

### リポジトリの準備

GitHub Pages で `https://<your-username>.github.io` として公開するには、リポジトリ名を正確に `<your-username>.github.io` にする必要があります。リポジトリは public にしてください。

### GitHub Actions ワークフロー

ワークフローは `.github/workflows/deploy.yml` に定義します。

```yaml
name: Deploy Hugo Blog

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install PaperMod theme
        run: git clone --depth=1 https://github.com/adityatelange/hugo-PaperMod.git themes/PaperMod

      - name: Setup Hugo
        uses: peaceiris/actions-hugo@v3
        with:
          hugo-version: 'latest'
          extended: true

      - name: Build
        run: hugo --minify

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

いくつか補足します。

**なぜ `extended: true` なのか？** PaperMod テーマは SCSS のコンパイルに Hugo Extended を必要とします。標準版を使うと、テーマの読み込みに失敗します。

**なぜサブモジュールではなく、テーマを直接クローンするのか？** 最初は PaperMod を Git サブモジュールとして設定していましたが、`actions/checkout` の `submodules: recursive` オプションで、ときどきテーマのディレクトリが空のままチェックアウトされることがありました。その結果、ビルドは成功するのにページが1つも出力されません。ワークフローで明示的にクローンするほうが確実です。

**なぜ `--minify` なのか？** HTML/CSS/JS のファイルサイズが小さくなり、読み込みが速くなります。静的ブログにとってデメリットはありません。

### GitHub Pages を有効にする

最初の push が成功したら：

1. リポジトリ → **Settings** → **Pages** を開く
2. **Build and deployment → Source** で **GitHub Actions** を選ぶ
3. 保存する

以降、GitHub はブランチから直接ファイルを配信するのではなく、ワークフローの出力を使うようになります。

### 新しい記事を公開する

日々の流れはシンプルです。

```bash
# Create a new post
hugo new content posts/my-new-post.md

# Edit the file, then publish
git add .
git commit -m "Add post: my new post title"
git push
```

30秒ほどで記事が公開されます。

---

## パート2：ファイル構成と編集すべきファイル

テーマとビルド出力を除いた、ディレクトリ構成の全体です。

```
blog/
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD pipeline — triggers on every push
├── archetypes/
│   └── default.md            # Template applied when running `hugo new`
├── content/
│   ├── about.md              # The /about/ page
│   └── posts/
│       └── my-post.md        # Each file = one blog post
├── layouts/                  # Custom template overrides (empty for now)
├── static/                   # Images, PDFs, and other static assets
├── themes/
│   └── PaperMod/             # The theme — cloned by CI, do not edit manually
├── .gitignore
├── .gitmodules
└── hugo.toml                 # Global site configuration
```

### 実際に編集するファイル

**`hugo.toml`：コントロールパネル**

グローバルな設定はすべてここにあります。よく変更する項目は次のとおりです。

```toml
title = "Your Blog Title"

[params]
  author = "Your Name"
  description = "A short tagline shown in metadata"

  [params.homeInfoParams]
    Title = "Homepage heading"
    Content = "Whatever you want on your homepage"

  [[params.socialIcons]]
    name = "github"
    url = "https://github.com/yourusername"
```

名前、自己紹介、トップページの内容、SNS リンクを変えたいときは、ここを編集します。

**`content/posts/*.md`：記事**

このディレクトリの Markdown ファイルが、それぞれ1つの記事として公開されます。各ファイルは Front Matter ブロックで始める必要があります。

```markdown
---
title: "Your Post Title"
date: 2026-03-29
draft: false
tags: ["tag1", "tag2"]
description: "A short summary shown in post listings."
ShowToc: true
---

Your content starts here...
```

特に重要な項目が2つあります。

- **`date`**：今日以前の日付にする必要があります。Hugo はデフォルトで未来の日付の記事をスキップします。記事がサイトに表示されない原因として最も多いのがこれです。
- **`draft`**：公開するには `false` にします。`hugo new` で作成したファイルはデフォルトで `draft: true` です。

**`content/about.md`：About ページ**

ほかの記事と同じ普通の Markdown ファイルですが、`/about/` に表示されます。Front Matter に `layout: "single"` を指定すると、PaperMod は一覧レイアウトではなく1ページ全体として表示します。

**`static/`：画像やファイル**

`static/` に置いたものはルートパスで配信されます。たとえば `static/images/photo.jpg` は `https://yourdomain.com/images/photo.jpg` でアクセスできます。記事では次のように画像を参照します。

```markdown
![Alt text](/images/photo.jpg)
```

### 編集してはいけないファイル

**`themes/PaperMod/`**：このディレクトリはビルド時に CI パイプラインが（`git clone` で）用意します。ローカルで変更しても、次のビルドで上書きされます。テーマのテンプレートを上書きしたい場合は、`themes/PaperMod/layouts/` から該当ファイルを自分の `layouts/` ディレクトリにコピーして編集してください。Hugo は `layouts/` のファイルをテーマより優先します。

**`public/`**：Hugo が生成するビルド出力ディレクトリです。`.gitignore` に含まれており、コミットしてはいけません。GitHub Actions がデプロイのたびにゼロから作り直します。

### TOML の書き方について

`hugo.toml` は TOML 形式で、文法に厳格です。注意点をいくつか挙げます。

- 文字列はダブルクォートで囲む：`title = "My Blog"`
- 複数行の文字列は三重引用符 `"""..."""` を使う。ただし、ネストした TOML テーブル内の複数行ブロックはパースエラーの原因になりやすいので、1行の文字列の中で `\n` エスケープを使うほうが簡単でおすすめです
- TOML が壊れていると、Hugo は何も出力せずにすぐ終了します。デプロイは成功したのにサイトが真っ白なら、まず TOML を確認してください

---

## まとめ

| やりたいこと | 編集するファイル |
|------|-------------|
| サイト名・著者を変更する | `hugo.toml` |
| トップページの内容を更新する | `hugo.toml` → `params.homeInfoParams` |
| SNS リンクを追加・更新する | `hugo.toml` → `params.socialIcons` |
| 新しい記事を書く | `content/posts/` に新規ファイル |
| About ページを編集する | `content/about.md` |
| 記事に画像を追加する | `static/` に置き、`/filename` で参照 |
| テーマのレイアウトをカスタマイズする | テンプレートを `layouts/` にコピーして編集 |
| CI/CD の動作を変える | `.github/workflows/deploy.yml` |

この仕組みは、できるだけ邪魔にならないように作られています。一度セットアップすれば、考えるべきことは書くことだけです。
