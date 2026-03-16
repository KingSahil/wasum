#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# WA Chat Summariser — Oracle Cloud VM Setup Script
# Run this ONCE on a fresh Ubuntu 22.04 Oracle Always Free ARM instance:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USER/wa-chat-summariser/main/setup.sh | bash
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "──────────────────────────────────────────"
echo "  WA Summariser — Oracle VM Setup"
echo "──────────────────────────────────────────"

# 1. System update
echo "[1/6] Updating system..."
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

# 2. Install Docker
echo "[2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "  → Docker installed. You may need to log out & back in."
else
    echo "  → Docker already installed, skipping."
fi

# 3. Install Docker Compose plugin
echo "[3/6] Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
    sudo apt-get install -y docker-compose-plugin -qq
fi

# 4. Open firewall port 3000
echo "[4/6] Opening port 3000 in iptables..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

# 5. Clone or pull the repo
REPO_URL="${REPO_URL:-https://github.com/YOUR_USER/wa-chat-summariser.git}"
APP_DIR="$HOME/wa-chat-summariser"

if [ -d "$APP_DIR/.git" ]; then
    echo "[5/6] Pulling latest code..."
    cd "$APP_DIR" && git pull
else
    echo "[5/6] Cloning repo to $APP_DIR..."
    git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# 6. Create .env if missing
if [ ! -f .env ]; then
    echo "[6/6] Creating .env from template..."
    cp .env.example .env
    echo ""
    echo "  ⚠  Edit .env before starting:"
    echo "     nano $APP_DIR/.env"
    echo ""
fi

echo ""
echo "──────────────────────────────────────────"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit your .env:       nano $APP_DIR/.env"
echo "  2. Build & start:        cd $APP_DIR && docker compose up -d --build"
echo "  3. View logs:            docker compose logs -f"
echo "  4. Open in browser:      http://YOUR_ORACLE_PUBLIC_IP:3000"
echo "──────────────────────────────────────────"
