# 2-day showcase (fits your current droplet)

Your `Testing` droplet: **3.8 GB RAM**, ~1 GB free, **swap already 2 GB used**, many Docker containers, **26 GB disk free**.

**Do not install full GitLab CE on this box.** Omnibus GitLab alone wants ~3–4 GB RAM. It will fight your existing containers and thrash swap.

## Recommended plan for 2 days

| Piece | Where | Why |
|---|---|---|
| GitLab (UI, repo, pipelines, registry) | **gitlab.com** free | Looks like real GitLab; zero RAM on your droplet |
| Self-hosted Runner | **this DigitalOcean droplet** | JD keyword: self-hosted GitLab runner / on-prem CI |
| App deploy target | same droplet (or existing app path) | Shows Docker + SSH/deploy automation |

**Interview line:**  
“For the demo I used GitLab SaaS as the control plane and a **self-hosted GitLab Runner on DigitalOcean** that builds Docker images and deploys to my droplet. In production I’d run GitLab CE on a dedicated 4–8 GB node; this host already runs the app workload so I kept GitLab off it.”

That is honest and still covers GitLab + Docker + CI/CD + self-hosted runner.

---

## Day 1 — 30–45 min setup

### 1. Create project on gitlab.com

1. https://gitlab.com → New project → Import or empty `voice_ai`
2. Push this repo:

```bash
# on your laptop
cd voice_ai
git remote add gitlab https://gitlab.com/<YOUR_USER>/voice_ai.git
git add .gitlab-ci.yml docker-compose.prod.yml gitlab/
git commit -m "Add GitLab CI and 2-day self-hosted runner showcase"
git push -u gitlab main
```

### 2. Register a self-hosted Runner on the droplet

On the droplet (`root@Testing`):

```bash
# free a little memory if needed
docker system df
free -h

# install runner (official)
curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | bash
apt-get install -y gitlab-runner

# ensure docker group access
usermod -aG docker gitlab-runner
```

In GitLab: **Project → Settings → CI/CD → Runners → New project runner**  
Tags: `docker,digitalocean` · Executor: you’ll finish in CLI.

```bash
gitlab-runner register
# URL: https://gitlab.com/
# Token: (from GitLab UI)
# Executor: docker
# Default image: docker:27
```

Edit `/etc/gitlab-runner/config.toml` so Docker builds work (DinD or socket). **For 2-day demo, socket is simpler and uses less RAM:**

```toml
[[runners]]
  name = "do-testing-runner"
  url = "https://gitlab.com/"
  token = "..."
  executor = "docker"
  [runners.docker]
    image = "docker:27"
    privileged = false
    # socket = build/deploy on host Docker; /opt/voice_ai = compose + .env for deploy_local
    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/opt/voice_ai:/opt/voice_ai", "/cache"]
```

Also set CI variable **`DEMO_SAME_DROPLET=1`** so the pipeline uses `deploy_local` (no SSH).

```bash
gitlab-runner restart
gitlab-runner status
```

GitLab UI should show the runner **online** (green).

### 3. CI variables (Project → Settings → CI/CD → Variables)

For a same-droplet demo you can skip SSH and use a local deploy job (see `.gitlab-ci.yml` job `deploy_local` in notes below), **or** set:

| Key | Value | Notes |
|---|---|---|
| `DEMO_SAME_DROPLET` | `1` | use same-droplet deploy |
| `HEALTH_URL` | `http://172.17.0.1:3006/health` | optional; host gateway from job container |

### 4. Pipeline smoke

Push a tiny change → **CI/CD → Pipelines** → watch `validate` + `build`.  
For showcase, make `deploy` manual and click it once live.

---

## Day 2 — what you show in the call (5–7 min)

1. GitLab project + commits  
2. Runner page: **self-hosted on DigitalOcean**  
3. Pipeline graph: validate → build → deploy → verify  
4. Container built / app restarted  
5. Live URL / health check  
6. “If we had a second 4GB droplet I’d run GitLab CE Omnibus there; here’s the compose file I prepared” → open `gitlab/docker-compose.gitlab.yml`

---

## Optional: real GitLab CE (only if you pay for a 2-day droplet)

Create a **temporary** DigitalOcean droplet: **4 GB RAM**, Ubuntu 22.04, ~$12–24/mo → destroy after interview (~₹100–200 for 2 days).

```bash
# on the NEW empty droplet only
bash gitlab/setup-gitlab.sh gitlab.YOURDOMAIN.com you@email.com
```

Do **not** run this on `Testing` while your current stack is up.

---

## If you insist on GitLab CE on this same droplet

Expect pain. Minimum prep:

```bash
# stop non-essential containers first
docker ps --format '{{.Names}}'
# stop what you can spare for 2 days

# add swap if still tight (you already have 4G swap — avoid more if disk is slow)
free -h
```

Even then, GitLab + existing app + runner on **3.8 GB** often OOMs during `docker build`. Prefer gitlab.com + runner.

---

## Cleanup after the interview (same day or next)

```bash
# on Testing
gitlab-runner stop || true
apt-get remove -y gitlab-runner   # optional
# or leave runner paused: gitlab-runner pause

# if you created a temp GitLab droplet — destroy it in DO console
```

Destroy CI variables / deploy keys you no longer need.
