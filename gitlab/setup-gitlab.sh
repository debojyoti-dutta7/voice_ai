#!/usr/bin/env bash
# Bootstrap self-hosted GitLab CE on a DigitalOcean droplet.
# Usage (as root on the GitLab droplet):
#   bash setup-gitlab.sh gitlab.yourdomain.com you@email.com
set -euo pipefail

DOMAIN="${1:?usage: setup-gitlab.sh <gitlab-domain> <letsencrypt-email>}"
EMAIL="${2:?usage: setup-gitlab.sh <gitlab-domain> <letsencrypt-email>}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> DNS check: A record for $DOMAIN and registry.$DOMAIN must point here"
echo "==> Installing Docker if needed"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> Writing .env for compose"
cat > "$DIR/.env" <<EOF
GITLAB_DOMAIN=$DOMAIN
GITLAB_LETSENCRYPT_EMAIL=$EMAIL
EOF

echo "==> Starting GitLab CE (first boot ~3–5 min)"
cd "$DIR"
docker compose -f docker-compose.gitlab.yml up -d

echo "==> Waiting for GitLab to become healthy"
for i in $(seq 1 60); do
  if docker exec gitlab curl -fsS http://127.0.0.1/-/readiness >/dev/null 2>&1; then
    break
  fi
  sleep 10
  echo "  still starting... ($i)"
done

echo "==> Initial root password:"
docker exec gitlab grep 'Password:' /etc/gitlab/initial_root_password || true

echo
echo "Next steps:"
echo "  1. Open https://$DOMAIN  (login: root / password above)"
echo "  2. Create project: voice_ai"
echo "  3. Push code:  git remote add gitlab https://$DOMAIN/root/voice_ai.git && git push -u gitlab main"
echo "  4. Register a runner:  bash setup-runner.sh"
echo "  5. Add CI variables: SSH_PRIVATE_KEY, DROPLET_HOST, DROPLET_USER"
echo "  6. Push to main → pipeline builds image → manual Deploy job ships to app droplet"
