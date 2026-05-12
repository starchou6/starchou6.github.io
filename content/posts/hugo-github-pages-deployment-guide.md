---
title: "How I Deployed This Blog with Hugo and GitHub Pages"
date: 2026-03-29
draft: false
tags: ["hugo", "github-pages", "devops", "blogging"]
categories: ["Engineering"]
description: "A practical guide to deploying a Hugo blog on GitHub Pages using GitHub Actions — covering the full deployment pipeline and file architecture."
ShowToc: true
---

When I decided to start a technical blog, I wanted something fast, free, and version-controlled — no databases, no hosting bills, no CMS to maintain. Hugo with GitHub Pages turned out to be exactly that. In this post I'll walk through how the deployment pipeline works and explain the file structure so you can maintain and extend it confidently.

---

## Part 1: Deploying with GitHub and GitHub Actions

### How the pipeline works

Every time you push to the `main` branch, GitHub Actions automatically:

1. Checks out your repository (including the theme submodule)
2. Installs Hugo Extended
3. Runs `hugo --minify` to build the static site into a `public/` folder
4. Uploads the `public/` folder as a deployment artifact
5. Deploys it to GitHub Pages

The whole process takes about 20–30 seconds. You write Markdown, push, and your post is live.

### Setting up the repository

Your GitHub repository must be named exactly `<your-username>.github.io` for GitHub Pages to serve it at `https://<your-username>.github.io`. Make the repository public.

### The GitHub Actions workflow

The workflow is defined in `.github/workflows/deploy.yml`:

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

A few things worth noting:

**Why `extended: true`?** The PaperMod theme requires Hugo Extended to compile SCSS. If you use the standard build, the theme will fail to load.

**Why clone the theme directly instead of using submodules?** I initially set up PaperMod as a Git submodule, but found that the `submodules: recursive` flag in `actions/checkout` occasionally caused the theme directory to be checked out empty — resulting in a successful build with zero output pages. Cloning explicitly in the workflow is more reliable.

**Why `--minify`?** It reduces HTML/CSS/JS file sizes, improving load times. No downside for a static blog.

### Enabling GitHub Pages

After your first successful push:

1. Go to your repository → **Settings** → **Pages**
2. Under **Build and deployment → Source**, select **GitHub Actions**
3. Save

GitHub will then use your workflow's output instead of trying to serve files directly from a branch.

### Publishing a new post

The day-to-day workflow is straightforward:

```bash
# Create a new post
hugo new content posts/my-new-post.md

# Edit the file, then publish
git add .
git commit -m "Add post: my new post title"
git push
```

Your post will be live in about 30 seconds.

---

## Part 2: File Architecture and What to Modify

Here is the full directory structure (excluding the theme and build output):

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

### Files you will actually edit

**`hugo.toml` — the control panel**

This is where all global settings live. The most commonly changed fields:

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

Change these when you want to update your name, bio, homepage content, or social links.

**`content/posts/*.md` — your articles**

Each Markdown file in this directory becomes a published post. Every file must start with a Front Matter block:

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

Two fields are especially important:

- **`date`**: Must be today's date or earlier. Hugo skips future-dated posts by default. This is the most common reason a post doesn't appear on the site.
- **`draft`**: Set to `false` to publish. Files created with `hugo new` default to `draft: true`.

**`content/about.md` — the About page**

This is a regular Markdown file like any post, but it renders at `/about/`. Use `layout: "single"` in the Front Matter so PaperMod renders it as a full-width page rather than trying to apply a list layout.

**`static/` — images and files**

Anything placed in `static/` is served at the root path. For example, `static/images/photo.jpg` becomes accessible at `https://yourdomain.com/images/photo.jpg`. Reference images in posts like this:

```markdown
![Alt text](/images/photo.jpg)
```

### Files you should not edit

**`themes/PaperMod/`** — This directory is populated by the CI pipeline at build time (via `git clone`). Any manual changes you make locally will be overwritten on the next build. If you want to override a theme template, copy the relevant file from `themes/PaperMod/layouts/` into your own `layouts/` directory and edit it there. Hugo gives your `layouts/` files priority over the theme.

**`public/`** — This is the build output directory generated by Hugo. It is listed in `.gitignore` and should never be committed. GitHub Actions rebuilds it from scratch on every deploy.

### A note on TOML syntax

`hugo.toml` uses the TOML format, which is strict about syntax. A few things to watch:

- Strings must be in double quotes: `title = "My Blog"`
- Multiline strings use triple quotes: `"""..."""` — but I recommend using `\n` escape sequences in a single-line string for simplicity, since multiline blocks inside nested TOML tables can cause parse errors
- Broken TOML causes Hugo to exit immediately with no output — if a deploy succeeds but your site looks blank, check the TOML first

---

## Summary

| Task | File to edit |
|------|-------------|
| Change site name / author | `hugo.toml` |
| Update homepage content | `hugo.toml` → `params.homeInfoParams` |
| Add or update social links | `hugo.toml` → `params.socialIcons` |
| Write a new post | New file in `content/posts/` |
| Edit the About page | `content/about.md` |
| Add an image to a post | Put it in `static/`, reference with `/filename` |
| Customize theme layout | Copy template to `layouts/`, edit there |
| Change CI/CD behavior | `.github/workflows/deploy.yml` |

The whole system is designed to stay out of your way. Once it's set up, the only thing you need to think about is writing.
