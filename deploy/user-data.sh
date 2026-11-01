#!/bin/bash
# EC2 Launch Template "User data" for the app tier (Amazon Linux 2023).
# EDIT the 3 values below, then paste the whole script into the Launch Template.
REPO_URL="https://github.com/Geetha-1997/converra.git"
REGION="ap-south-1"
PARAM_PREFIX="/groqchat"

set -e
dnf install -y nodejs20 nginx git

# Fetch app code
git clone "$REPO_URL" /opt/groq-chat
cd /opt/groq-chat/backend
npm install --omit=dev

# Read secrets from SSM Parameter Store and write an env file
get() { aws ssm get-parameter --region "$REGION" --name "$PARAM_PREFIX/$1" --with-decryption --query Parameter.Value --output text; }
cat > /etc/groqchat.env <<EOF
PORT=3000
GROQ_API_KEY=$(get GROQ_API_KEY)
GROQ_MODEL=llama-3.3-70b-versatile
DB_HOST=$(get DB_HOST)
DB_USER=chatuser
DB_PASSWORD=$(get DB_PASSWORD)
DB_NAME=chatdb
DB_SSL=true
EOF
chmod 600 /etc/groqchat.env

# Backend as a systemd service
cat > /etc/systemd/system/groqchat.service <<EOF
[Unit]
Description=Groq Chat backend
After=network.target

[Service]
EnvironmentFile=/etc/groqchat.env
WorkingDirectory=/opt/groq-chat/backend
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Nginx serves the frontend and proxies /api to the backend
cat > /etc/nginx/conf.d/groqchat.conf <<'EOF'
server {
    listen 80 default_server;
    root /opt/groq-chat/frontend;
    index index.html;
    location /api/ { proxy_pass http://127.0.0.1:3000; proxy_read_timeout 90s; }
    location /health { proxy_pass http://127.0.0.1:3000; }
    location / { try_files $uri /index.html; }
}
EOF
# "default_server" above makes our block win over nginx's built-in one
chmod -R o+rX /opt/groq-chat

systemctl daemon-reload
systemctl enable --now groqchat nginx