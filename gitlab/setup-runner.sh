#!/usr/bin/env bash
# Register the Docker executor runner with your self-hosted GitLab.
# Get a registration token from: GitLab → Admin → CI/CD → Runners → New instance runner
# Or a project token from: Project → Settings → CI/CD → Runners
set -euo pipefail

TOKEN="${1:?usage: setup-runner.sh <registration-token>}"
URL="${GITLAB_URL:-}"

if [ -z "$URL" ]; then
  # shellcheck disable=SC1091
  [ -f "$(dirname "$0")/.env" ] && . "$(dirname "$0")/.env"
  URL="https://${GITLAB_DOMAIN:?Set GITLAB_DOMAIN or GITLAB_URL}"
fi

echo "==> Registering runner against $URL"
docker exec -it gitlab-runner gitlab-runner register \
  --non-interactive \
  --url "$URL" \
  --token "$TOKEN" \
  --executor docker \
  --docker-image docker:27 \
  --docker-privileged \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --description "do-docker-runner" \
  --tag-list "docker,digitalocean" \
  --run-untagged=true

echo "==> Runner registered. Check: Admin → CI/CD → Runners (or Project → Settings → CI/CD)"
