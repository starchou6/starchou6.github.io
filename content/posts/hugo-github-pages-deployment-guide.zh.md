---
title: "30 分钟搭建免费博客：从零开始用 Hugo + GitHub Pages"
date: 2026-03-29
draft: false
tags: ["hugo", "github-pages", "devops", "blogging"]
categories: ["Engineering"]
description: "不用服务器，不用托管费，不用 CMS，只要 Markdown 和一次 git push。下面介绍如何在 30 分钟内免费上线一个快速、专业的博客。"
ShowToc: true
---

不用服务器，不用托管费，不用 CMS，只要 Markdown 和一次 git push。下面介绍如何在 30 分钟内免费上线一个快速、专业的博客。

---

## 第一部分：用 GitHub 和 GitHub Actions 部署

### 流水线如何工作

每次推送到 `main` 分支，GitHub Actions 都会自动：

1. 检出你的仓库
2. 把 PaperMod 主题克隆到 `themes/PaperMod`
3. 安装 Hugo Extended
4. 运行 `hugo --minify`，把静态网站构建到 `public/` 文件夹
5. 把 `public/` 文件夹上传为部署产物
6. 部署到 GitHub Pages

整个过程大约 20–30 秒。写好 Markdown，推送，文章就上线了。

### 创建仓库

仓库名必须是 `<your-username>.github.io`，GitHub Pages 才会在 `https://<your-username>.github.io` 上提供它。仓库要设为公开。

### GitHub Actions 工作流

工作流定义在 `.github/workflows/deploy.yml` 中：

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

有几点值得注意：

**为什么要 `extended: true`？** PaperMod 主题需要 Hugo Extended 来编译 SCSS。如果用标准版，主题会加载失败。

**为什么直接克隆主题，而不用子模块？** 我最初把 PaperMod 设成了 Git 子模块，但发现 `actions/checkout` 的 `submodules: recursive` 选项偶尔会让主题目录检出为空，结果构建"成功"了，却一个页面也没有生成。在工作流里显式克隆更可靠。

**为什么要 `--minify`？** 它能减小 HTML/CSS/JS 文件体积，加快加载速度。对静态博客来说没有任何坏处。

### 启用 GitHub Pages

第一次推送成功之后：

1. 打开仓库 → **Settings** → **Pages**
2. 在 **Build and deployment → Source** 下选择 **GitHub Actions**
3. 保存

之后 GitHub 会使用工作流的输出，而不是直接从某个分支提供文件。

### 发布新文章

日常流程很简单：

```bash
# Create a new post
hugo new content posts/my-new-post.md

# Edit the file, then publish
git add .
git commit -m "Add post: my new post title"
git push
```

大约 30 秒后，文章就上线了。

---

## 第二部分：文件结构，以及该改哪些文件

下面是完整的目录结构（不含主题和构建输出）：

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

### 你真正会编辑的文件

**`hugo.toml`：控制面板**

所有全局设置都在这里。最常改的字段：

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

想更新名字、简介、首页内容或社交链接时，改这些就行。

**`content/posts/*.md`：你的文章**

这个目录里的每个 Markdown 文件都会发布成一篇文章。每个文件都必须以 Front Matter 块开头：

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

其中两个字段尤其重要：

- **`date`**：必须是今天或更早的日期。Hugo 默认会跳过未来日期的文章。这是文章没有出现在网站上最常见的原因。
- **`draft`**：设为 `false` 才会发布。用 `hugo new` 创建的文件默认是 `draft: true`。

**`content/about.md`：关于页面**

它和普通文章一样是 Markdown 文件，但会渲染在 `/about/`。在 Front Matter 里写上 `layout: "single"`，PaperMod 就会把它渲染成整页，而不是尝试套用列表布局。

**`static/`：图片和文件**

放在 `static/` 里的任何文件都会从根路径提供。例如，`static/images/photo.jpg` 可以通过 `https://yourdomain.com/images/photo.jpg` 访问。在文章里这样引用图片：

```markdown
![Alt text](/images/photo.jpg)
```

### 不应该编辑的文件

**`themes/PaperMod/`**：这个目录由 CI 流水线在构建时（通过 `git clone`）生成。你在本地做的任何修改都会在下次构建时被覆盖。如果想覆盖主题模板，把相应文件从 `themes/PaperMod/layouts/` 复制到你自己的 `layouts/` 目录再修改。Hugo 会优先使用你 `layouts/` 里的文件。

**`public/`**：这是 Hugo 生成的构建输出目录。它已列在 `.gitignore` 中，永远不应提交。GitHub Actions 每次部署都会从头重新构建它。

### 关于 TOML 语法

`hugo.toml` 使用 TOML 格式，语法要求很严格。需要注意几点：

- 字符串必须用双引号：`title = "My Blog"`
- 多行字符串使用三引号：`"""..."""`。不过我建议在单行字符串里用 `\n` 转义，更简单，因为嵌套 TOML 表里的多行块可能导致解析错误
- TOML 写错时 Hugo 会直接退出，没有任何输出。如果部署成功了但网站一片空白，先检查 TOML

---

## 总结

| 任务 | 要编辑的文件 |
|------|-------------|
| 修改网站名称 / 作者 | `hugo.toml` |
| 更新首页内容 | `hugo.toml` → `params.homeInfoParams` |
| 添加或更新社交链接 | `hugo.toml` → `params.socialIcons` |
| 写新文章 | 在 `content/posts/` 中新建文件 |
| 编辑关于页面 | `content/about.md` |
| 给文章添加图片 | 放进 `static/`，用 `/filename` 引用 |
| 自定义主题布局 | 把模板复制到 `layouts/`，在那里修改 |
| 修改 CI/CD 行为 | `.github/workflows/deploy.yml` |

整个系统的设计就是不打扰你。设置好之后，你唯一需要考虑的就是写作。
