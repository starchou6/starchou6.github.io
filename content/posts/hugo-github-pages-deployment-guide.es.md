---
title: "Un blog gratis en 30 minutos: Hugo + GitHub Pages desde cero"
date: 2026-03-29
draft: false
tags: ["hugo", "github-pages", "devops", "blogging"]
categories: ["Engineering"]
description: "Sin servidores, sin costes de alojamiento, sin CMS: solo Markdown y un git push. Así puedes publicar gratis un blog rápido y profesional en menos de 30 minutos."
ShowToc: true
---

Sin servidores, sin costes de alojamiento, sin CMS: solo Markdown y un git push. Así puedes publicar gratis un blog rápido y profesional en menos de 30 minutos.

---

## Parte 1: desplegar con GitHub y GitHub Actions

### Cómo funciona el pipeline

Cada vez que haces push a la rama `main`, GitHub Actions automáticamente:

1. Descarga tu repositorio
2. Clona el tema PaperMod en `themes/PaperMod`
3. Instala Hugo Extended
4. Ejecuta `hugo --minify` para generar el sitio estático en una carpeta `public/`
5. Sube la carpeta `public/` como artefacto de despliegue
6. La despliega en GitHub Pages

Todo el proceso tarda unos 20–30 segundos. Escribes Markdown, haces push y el artículo ya está publicado.

### Preparar el repositorio

Tu repositorio de GitHub debe llamarse exactamente `<your-username>.github.io` para que GitHub Pages lo sirva en `https://<your-username>.github.io`. Hazlo público.

### El workflow de GitHub Actions

El workflow se define en `.github/workflows/deploy.yml`:

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

Algunos detalles a tener en cuenta:

**¿Por qué `extended: true`?** El tema PaperMod necesita Hugo Extended para compilar SCSS. Con la versión estándar, el tema no se cargará.

**¿Por qué clonar el tema directamente en lugar de usar submódulos?** Al principio configuré PaperMod como submódulo de Git, pero la opción `submodules: recursive` de `actions/checkout` a veces dejaba vacía la carpeta del tema. El resultado era una compilación correcta sin ninguna página generada. Clonarlo explícitamente en el workflow es más fiable.

**¿Por qué `--minify`?** Reduce el tamaño de los archivos HTML/CSS/JS y mejora los tiempos de carga. No tiene ninguna desventaja para un blog estático.

### Activar GitHub Pages

Después del primer push correcto:

1. Ve a tu repositorio → **Settings** → **Pages**
2. En **Build and deployment → Source**, elige **GitHub Actions**
3. Guarda

A partir de entonces, GitHub usará la salida de tu workflow en lugar de servir los archivos directamente desde una rama.

### Publicar un artículo nuevo

El día a día es muy sencillo:

```bash
# Create a new post
hugo new content posts/my-new-post.md

# Edit the file, then publish
git add .
git commit -m "Add post: my new post title"
git push
```

Tu artículo estará publicado en unos 30 segundos.

---

## Parte 2: estructura de archivos y qué modificar

Esta es la estructura completa de carpetas (sin el tema ni la salida de la compilación):

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

### Los archivos que de verdad vas a editar

**`hugo.toml`: el panel de control**

Aquí están todos los ajustes globales. Los campos que más se cambian:

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

Cámbialos cuando quieras actualizar tu nombre, tu presentación, el contenido de la portada o los enlaces a redes sociales.

**`content/posts/*.md`: tus artículos**

Cada archivo Markdown de esta carpeta se publica como un artículo. Todos deben empezar con un bloque Front Matter:

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

Dos campos son especialmente importantes:

- **`date`**: debe ser hoy o una fecha anterior. Por defecto, Hugo omite los artículos con fecha futura. Es el motivo más habitual por el que un artículo no aparece en el sitio.
- **`draft`**: ponlo en `false` para publicar. Los archivos creados con `hugo new` vienen con `draft: true` por defecto.

**`content/about.md`: la página Sobre mí**

Es un archivo Markdown normal, como cualquier artículo, pero se muestra en `/about/`. Usa `layout: "single"` en el Front Matter para que PaperMod la muestre como una página completa en lugar de intentar aplicarle un diseño de lista.

**`static/`: imágenes y archivos**

Todo lo que pongas en `static/` se sirve desde la raíz. Por ejemplo, `static/images/photo.jpg` queda accesible en `https://yourdomain.com/images/photo.jpg`. En los artículos, las imágenes se referencian así:

```markdown
![Alt text](/images/photo.jpg)
```

### Los archivos que no debes editar

**`themes/PaperMod/`**: esta carpeta la rellena el pipeline de CI durante la compilación (con `git clone`). Cualquier cambio local se sobrescribirá en la siguiente compilación. Si quieres sobrescribir una plantilla del tema, copia el archivo correspondiente de `themes/PaperMod/layouts/` a tu propia carpeta `layouts/` y edítalo allí. Hugo da prioridad a los archivos de tu `layouts/` sobre los del tema.

**`public/`**: es la carpeta de salida que genera Hugo. Está en `.gitignore` y nunca debe subirse al repositorio. GitHub Actions la vuelve a generar desde cero en cada despliegue.

### Una nota sobre la sintaxis TOML

`hugo.toml` usa el formato TOML, que es muy estricto con la sintaxis. Algunas cosas a vigilar:

- Las cadenas van entre comillas dobles: `title = "My Blog"`
- Las cadenas de varias líneas usan comillas triples: `"""..."""`. Aun así, recomiendo usar secuencias `\n` en una cadena de una sola línea, porque es más sencillo y los bloques de varias líneas dentro de tablas TOML anidadas pueden provocar errores de análisis
- Un TOML roto hace que Hugo termine al instante sin generar nada. Si el despliegue funciona pero tu sitio aparece en blanco, revisa primero el TOML

---

## Resumen

| Tarea | Archivo a editar |
|------|-------------|
| Cambiar el nombre del sitio / el autor | `hugo.toml` |
| Actualizar la portada | `hugo.toml` → `params.homeInfoParams` |
| Añadir o actualizar enlaces sociales | `hugo.toml` → `params.socialIcons` |
| Escribir un artículo nuevo | Archivo nuevo en `content/posts/` |
| Editar la página Sobre mí | `content/about.md` |
| Añadir una imagen a un artículo | Ponerla en `static/` y referenciarla con `/filename` |
| Personalizar el diseño del tema | Copiar la plantilla a `layouts/` y editarla allí |
| Cambiar el comportamiento de CI/CD | `.github/workflows/deploy.yml` |

Todo el sistema está pensado para no estorbar. Una vez configurado, lo único en lo que tienes que pensar es en escribir.
