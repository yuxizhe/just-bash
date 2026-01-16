#!/bin/bash

# just-bash Cloudflare Worker 部署脚本
# 自动化部署流程

set -e  # 遇到错误立即退出

echo "🚀 just-bash Cloudflare Worker 部署脚本"
echo "========================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查依赖
echo "📋 检查依赖..."

if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ 错误: pnpm 未安装${NC}"
    echo "请先安装 pnpm: npm install -g pnpm"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ 错误: npx 未安装${NC}"
    echo "请先安装 Node.js"
    exit 1
fi

echo -e "${GREEN}✅ 依赖检查通过${NC}"
echo ""

# 检查是否已登录
echo "🔐 检查 Cloudflare 登录状态..."

if npx wrangler whoami &> /dev/null; then
    echo -e "${GREEN}✅ 已登录 Cloudflare${NC}"
    npx wrangler whoami
    echo ""
else
    echo -e "${YELLOW}⚠️  未登录 Cloudflare${NC}"
    echo "正在打开浏览器进行登录..."
    npx wrangler login
    echo ""
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装项目依赖..."
    pnpm install
    echo -e "${GREEN}✅ 依赖安装完成${NC}"
    echo ""
fi

# 询问是否本地测试
echo -e "${BLUE}❓ 是否先进行本地测试？(推荐) [y/N]${NC}"
read -r test_local

if [[ $test_local =~ ^[Yy]$ ]]; then
    echo ""
    echo "🧪 启动本地开发服务器..."
    echo "访问 http://localhost:8787 进行测试"
    echo "按 Ctrl+C 停止并继续部署"
    echo ""
    pnpm dev || true
    echo ""
fi

# 确认部署
echo -e "${YELLOW}⚠️  准备部署到生产环境${NC}"
echo "账户 ID: 3c181a61e54b069ab102a8c08e966237"
echo "Worker 名称: just-bash-worker"
echo ""
echo -e "${BLUE}❓ 确认部署？[y/N]${NC}"
read -r confirm_deploy

if [[ ! $confirm_deploy =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}❌ 部署已取消${NC}"
    exit 0
fi

# 开始部署
echo ""
echo "🚀 开始部署..."
echo ""

if pnpm deploy; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}✨ 部署成功！${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "🌍 你的 Worker 已部署到："
    echo "   https://just-bash-worker.<your-subdomain>.workers.dev"
    echo ""
    echo "📱 功能："
    echo "   • Web 终端界面"
    echo "   • 持久化文件系统"
    echo "   • RESTful API"
    echo "   • 会话隔离"
    echo ""
    echo "🔗 快速链接："
    echo "   • Web 界面: /"
    echo "   • API 文档: /api"
    echo "   • 执行命令: /exec?cmd=<command>"
    echo ""
    echo "📊 监控和管理："
    echo "   • Dashboard: https://dash.cloudflare.com"
    echo "   • 实时日志: npx wrangler tail"
    echo "   • DO 列表: npx wrangler durable-objects list"
    echo ""
    echo "🎉 享受你的 edge bash 体验！"
    echo ""
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${RED}❌ 部署失败${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "🔍 故障排查："
    echo "   1. 检查登录状态: npx wrangler whoami"
    echo "   2. 查看详细错误信息（见上方）"
    echo "   3. 阅读部署文档: cat DEPLOYMENT.md"
    echo ""
    echo "💡 常见问题："
    echo "   • 认证错误 → 重新登录: npx wrangler login"
    echo "   • 账户不匹配 → 检查 account_id"
    echo "   • DO 绑定错误 → 检查 wrangler.toml"
    echo ""
    exit 1
fi
