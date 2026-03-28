#!/bin/bash
# =============================================================
# Hugo Blog 初始化脚本
# 在 blog/ 目录下运行：bash init.sh
# =============================================================

set -e

echo "🚀 开始初始化 Hugo 博客..."

# 1. 初始化 Git 仓库
if [ ! -d ".git" ]; then
  git init
  echo "✅ Git 仓库初始化完成"
else
  echo "ℹ️  Git 仓库已存在，跳过"
fi

# 2. 安装 PaperMod 主题（Git Submodule）
if [ ! -d "themes/PaperMod/.git" ]; then
  git submodule add --depth=1 https://github.com/adityatelange/hugo-PaperMod.git themes/PaperMod
  git submodule update --init --recursive
  echo "✅ PaperMod 主题安装完成"
else
  echo "ℹ️  PaperMod 主题已存在，跳过"
fi

# 3. 本地预览
echo ""
echo "✅ 初始化完成！"
echo ""
echo "👉 下一步："
echo "   1. 启动本地预览：hugo server -D"
echo "      访问 http://localhost:1313"
echo ""
echo "   2. 创建 GitHub 仓库（名称必须为 starchou6.github.io）"
echo "      然后运行以下命令推送："
echo ""
echo "      git add ."
echo "      git commit -m 'Initial Hugo blog setup'"
echo "      git branch -M main"
echo "      git remote add origin git@github.com:starchou6/starchou6.github.io.git"
echo "      git push -u origin main"
echo ""
echo "   3. GitHub 仓库 → Settings → Pages → Source: GitHub Actions"
echo "      等待 2-3 分钟，博客即可在以下地址访问："
echo "      https://starchou6.github.io"
echo ""
echo "📝 记得编辑 hugo.toml 中的 LinkedIn 链接！"
