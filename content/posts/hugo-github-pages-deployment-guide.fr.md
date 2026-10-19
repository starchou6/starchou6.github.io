---
title: "Un blog gratuit en 30 minutes : Hugo + GitHub Pages de zéro"
date: 2026-03-29
draft: false
tags: ["hugo", "github-pages", "devops", "blogging"]
categories: ["Engineering"]
description: "Pas de serveur, pas de frais d'hébergement, pas de CMS : juste du Markdown et un git push. Voici comment mettre en ligne gratuitement un blog rapide et professionnel en moins de 30 minutes."
ShowToc: true
---

Pas de serveur, pas de frais d'hébergement, pas de CMS : juste du Markdown et un git push. Voici comment mettre en ligne gratuitement un blog rapide et professionnel en moins de 30 minutes.

---

## Partie 1 : déployer avec GitHub et GitHub Actions

### Comment fonctionne le pipeline

À chaque push sur la branche `main`, GitHub Actions effectue automatiquement les étapes suivantes :

1. Il récupère votre dépôt
2. Il clone le thème PaperMod dans `themes/PaperMod`
3. Il installe Hugo Extended
4. Il lance `hugo --minify` pour générer le site statique dans un dossier `public/`
5. Il téléverse le dossier `public/` comme artefact de déploiement
6. Il le déploie sur GitHub Pages

L'ensemble prend environ 20 à 30 secondes. Vous écrivez du Markdown, vous faites un push, et l'article est en ligne.

### Créer le dépôt

Votre dépôt GitHub doit s'appeler exactement `<your-username>.github.io` pour que GitHub Pages le serve à l'adresse `https://<your-username>.github.io`. Rendez le dépôt public.

### Le workflow GitHub Actions

Le workflow est défini dans `.github/workflows/deploy.yml` :

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

Quelques points à noter :

**Pourquoi `extended: true` ?** Le thème PaperMod a besoin de Hugo Extended pour compiler le SCSS. Avec la version standard, le thème ne se chargera pas.

**Pourquoi cloner le thème directement plutôt que d'utiliser des sous-modules ?** Au départ, j'avais ajouté PaperMod comme sous-module Git, mais l'option `submodules: recursive` de `actions/checkout` laissait parfois le dossier du thème vide. Résultat : un build réussi qui ne produisait aucune page. Cloner explicitement dans le workflow est plus fiable.

**Pourquoi `--minify` ?** Cela réduit la taille des fichiers HTML/CSS/JS et accélère le chargement. Aucun inconvénient pour un blog statique.

### Activer GitHub Pages

Après le premier push réussi :

1. Ouvrez votre dépôt → **Settings** → **Pages**
2. Sous **Build and deployment → Source**, choisissez **GitHub Actions**
3. Enregistrez

GitHub utilisera alors la sortie de votre workflow au lieu de servir directement les fichiers d'une branche.

### Publier un nouvel article

Au quotidien, c'est très simple :

```bash
# Create a new post
hugo new content posts/my-new-post.md

# Edit the file, then publish
git add .
git commit -m "Add post: my new post title"
git push
```

Votre article sera en ligne en une trentaine de secondes.

---

## Partie 2 : l'arborescence des fichiers et ce qu'il faut modifier

Voici l'arborescence complète (sans le thème ni la sortie du build) :

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

### Les fichiers que vous modifierez vraiment

**`hugo.toml` : le tableau de bord**

Tous les réglages globaux se trouvent ici. Les champs les plus souvent modifiés :

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

Modifiez-les pour changer votre nom, votre présentation, le contenu de la page d'accueil ou vos liens vers les réseaux sociaux.

**`content/posts/*.md` : vos articles**

Chaque fichier Markdown de ce dossier devient un article publié. Chaque fichier doit commencer par un bloc Front Matter :

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

Deux champs sont particulièrement importants :

- **`date`** : elle doit être aujourd'hui ou antérieure. Par défaut, Hugo ignore les articles datés dans le futur. C'est la raison la plus fréquente pour laquelle un article n'apparaît pas sur le site.
- **`draft`** : mettez `false` pour publier. Les fichiers créés avec `hugo new` sont en `draft: true` par défaut.

**`content/about.md` : la page À propos**

C'est un fichier Markdown ordinaire, comme un article, mais il s'affiche à l'adresse `/about/`. Ajoutez `layout: "single"` dans le Front Matter pour que PaperMod l'affiche comme une page pleine plutôt que d'essayer d'appliquer une mise en page de liste.

**`static/` : images et fichiers**

Tout ce que vous placez dans `static/` est servi à la racine. Par exemple, `static/images/photo.jpg` est accessible à l'adresse `https://yourdomain.com/images/photo.jpg`. Dans un article, on référence une image ainsi :

```markdown
![Alt text](/images/photo.jpg)
```

### Les fichiers à ne pas modifier

**`themes/PaperMod/`** : ce dossier est rempli par le pipeline CI au moment du build (via `git clone`). Toute modification locale sera écrasée au build suivant. Pour surcharger un modèle du thème, copiez le fichier concerné de `themes/PaperMod/layouts/` vers votre propre dossier `layouts/` et modifiez-le là. Hugo donne la priorité aux fichiers de votre `layouts/` sur ceux du thème.

**`public/`** : c'est le dossier de sortie généré par Hugo. Il figure dans `.gitignore` et ne doit jamais être commité. GitHub Actions le reconstruit de zéro à chaque déploiement.

### Un mot sur la syntaxe TOML

`hugo.toml` utilise le format TOML, très strict sur la syntaxe. Quelques points à surveiller :

- Les chaînes doivent être entre guillemets doubles : `title = "My Blog"`
- Les chaînes multilignes utilisent des triples guillemets : `"""..."""`. Je recommande toutefois d'utiliser des séquences `\n` dans une chaîne sur une seule ligne, plus simples, car les blocs multilignes dans des tables TOML imbriquées peuvent provoquer des erreurs d'analyse
- Un TOML invalide fait quitter Hugo immédiatement, sans aucune sortie. Si le déploiement réussit mais que votre site est vide, vérifiez d'abord le TOML

---

## Récapitulatif

| Tâche | Fichier à modifier |
|------|-------------|
| Changer le nom du site / l'auteur | `hugo.toml` |
| Mettre à jour la page d'accueil | `hugo.toml` → `params.homeInfoParams` |
| Ajouter ou modifier les liens sociaux | `hugo.toml` → `params.socialIcons` |
| Écrire un nouvel article | Nouveau fichier dans `content/posts/` |
| Modifier la page À propos | `content/about.md` |
| Ajouter une image à un article | La placer dans `static/`, la référencer avec `/filename` |
| Personnaliser la mise en page du thème | Copier le modèle dans `layouts/` et le modifier là |
| Changer le comportement du CI/CD | `.github/workflows/deploy.yml` |

Tout le système est conçu pour se faire oublier. Une fois en place, la seule chose à laquelle vous devez penser, c'est l'écriture.
