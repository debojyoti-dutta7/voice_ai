# GitLab Self-Hosted Showcase — Voice AI on DigitalOcean

**For a 2-day demo on your current 4GB `Testing` droplet → read [`2DAY-DEMO.md`](./2DAY-DEMO.md) first.**  
Do not install full GitLab CE on that box while other containers are running.

Use this doc in the Reddensoft interview. It maps the **job JD** to what this repo demonstrates.

## Architecture (what to draw on a whiteboard)

```
┌─────────────────────────────┐          ┌──────────────────────────────┐
│  Droplet A — GitLab CE      │          │  Droplet B — App (prod)      │
│  • GitLab (source of truth) │  CI/CD   │  • Docker: voice-ai          │
│  • Container Registry       │ ───────► │  • Caddy / Nginx TLS         │
│  • GitLab Runner (Docker)   │  deploy  │  • .env secrets on host only │
└─────────────────────────────┘          └──────────────────────────────┘
         ▲
         │ git push
   Developer laptop
```

**Story in one line:**  
GitHub was the original remote; we **self-host GitLab CE** on DigitalOcean, run pipelines with a **self-hosted Runner**, push images to the **GitLab Container Registry**, and **SSH-deploy** the Docker image to the app droplet.

## JD → this project

| JD skill | How you demo it |
|---|---|
| GitLab Self-Hosted | `gitlab/docker-compose.gitlab.yml` + `setup-gitlab.sh` |
| CI/CD (GitLab CI) | `.gitlab-ci.yml` — validate → build → deploy → verify |
| Docker | `Dockerfile`, `docker-compose.prod.yml` |
| Cloud infra (DO ≈ AWS EC2) | Two droplets: GitLab + app; firewall, TLS |
| IaC / automation | Shell bootstrap scripts (`setup-gitlab.sh`, `deploy/setup.sh`) |
| Linux + Git | Clone, remotes, protected branches, deploy keys |
| Monitoring / troubleshoot | Health check job, container healthcheck, journal/docker logs |
| DevSecOps (lite) | Secrets in CI variables (masked), `.env` never in image, manual deploy gate |

## Demo script (5–7 minutes)

1. **Show GitLab UI** — project `voice_ai`, branches, CI/CD → Pipelines.  
2. **Open `.gitlab-ci.yml`** — explain four stages and why deploy is **manual** (production safety).  
3. **Show Runner** — Admin → Runners, Docker executor on the same DO host.  
4. **Trigger a pipeline** — push a small commit or “Run pipeline”.  
5. **Watch jobs** — lint passes, image builds, image appears in **Container Registry**.  
6. **Click Deploy** — SSH to app droplet, `docker pull` + `compose up`.  
7. **Verify** — curl health / open the live URL.  
8. **Security talking point** — CI variables for `SSH_PRIVATE_KEY`; app secrets stay in droplet `.env`, not in Git.

## Setup order (if they ask you to rebuild)

### Droplet A — GitLab (4GB RAM minimum)

```bash
# DNS first:
#   gitlab.yourdomain.com     → Droplet A
#   registry.yourdomain.com   → Droplet A

bash gitlab/setup-gitlab.sh gitlab.yourdomain.com you@email.com
bash gitlab/setup-runner.sh <REGISTRATION_TOKEN>
```

### Push the repo into self-hosted GitLab

```bash
git remote add gitlab https://gitlab.yourdomain.com/root/voice_ai.git
git push -u gitlab main
```

(Keep GitHub as `origin` if you want a mirror; GitLab becomes the CI source of truth.)

### Droplet B — App

```bash
# One-time on app droplet
mkdir -p /opt/voice_ai && cd /opt/voice_ai
# copy docker-compose.prod.yml + create .env from .env.example
docker pull <gitlab-registry>/root/voice_ai:latest
docker tag <gitlab-registry>/root/voice_ai:latest voice-ai:current
docker compose -f docker-compose.prod.yml up -d
```

### GitLab CI/CD variables

| Variable | Protected | Masked |
|---|---|---|
| `SSH_PRIVATE_KEY` | yes | yes |
| `DROPLET_HOST` | yes | no |
| `DROPLET_USER` | yes | no |

## Interview answers (short)

**Why self-host GitLab instead of gitlab.com?**  
Full control of code, runners, and registry on our own DO network; matches enterprise “on-prem / private GitLab” setups; no shared SaaS runner limits for Docker-in-Docker builds.

**Why not only GitHub Actions?**  
The JD asks for GitLab Self-Hosted. Same CI ideas, different product surface — runners, Omnibus install, Container Registry, protected environments.

**How do you roll back?**  
Redeploy previous image tag from the registry (`$CI_COMMIT_SHORT_SHA` of last good commit) and `compose up -d`.

**How is this like AWS?**  
Droplet ≈ EC2, Docker ≈ ECS/EKS workload unit, GitLab Registry ≈ ECR, CI deploy ≈ CodeDeploy/GitHub Actions → SSH, Caddy TLS ≈ ALB + ACM.

## Files added for this showcase

```
.gitlab-ci.yml                 # pipeline
docker-compose.prod.yml        # app on droplet
gitlab/docker-compose.gitlab.yml
gitlab/setup-gitlab.sh
gitlab/setup-runner.sh
gitlab/SHOWCASE.md             # this file
```
