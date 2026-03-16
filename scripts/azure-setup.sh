#!/bin/bash
set -e

echo "==> Updating system..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git

echo "==> Installing Docker (official repo)..."
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Starting Docker service..."
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker "$USER"

echo "==> Cloning repo..."
cd ~
if [ -d "wa-chat-summariser" ]; then
  cd wa-chat-summariser && git pull
else
  git clone https://github.com/syswraith/wa-chat-summariser.git
  cd wa-chat-summariser
fi

mkdir -p data logs
echo "==> SETUP COMPLETE - now create .env and run docker compose"