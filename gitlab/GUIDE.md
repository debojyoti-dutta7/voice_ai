# Step-by-step: Host Voice AI with GitLab.com + self-hosted Runner

Architecture for this showcase:

```
Laptop ──git push──► GitLab.com (repo, CI UI, Container Registry)
                              │
                              │ job scheduled
                              ▼
                     DigitalOcean droplet
                     • GitLab Runner (builds image here)
                     • Docker (runs voice-ai container)
```

---

## Part A — Laptop: push code to GitLab

### A1. Create project on GitLab.com

1. Open https://gitlab.com → **New project** → **Create blank project**
2. Name: `voice_ai`
3. Visibility: Private (fine for demo)
4. **Uncheck** “Initialize with README” (you already have code)
5. Create project → copy the HTTPS URL  
   Example: `https://gitlab.com/<YOUR_USER>/voice_ai.git`

### A2. Commit pipeline files and push

On your Windows machine (PowerShell):

```powershell
cd C:\Users\STPL\code\voice_ai

git add .gitlab-ci.yml docker-compose.prod.yml gitlab/
git commit -m "Add GitLab CI and 2-day self-hosted runner showcase"

# Keep GitHub as origin; add GitLab as second remote
git remote add gitlab https://gitlab.com/<YOUR_USER>/voice_ai.git
git push -u gitlab main
```

If GitLab asks for a password, use a **Personal Access Token**  
(GitLab → Avatar → Preferences → Access Tokens → `write_repository`).

After push, open the project → you should see all files including `.gitlab-ci.yml`.

---

## Part B — Droplet: prepare app folder

SSH into DigitalOcean (`root@Testing`):

```bash
mkdir -p /opt/voice_ai/data
# copy compose file from your machine, or:
# if repo is already somewhere on the server, copy from there
```

From laptop (example with scp):

```powershell
scp docker-compose.prod.yml root@YOUR_DROPLET_IP:/opt/voice_ai/
scp .env root@YOUR_DROPLET_IP:/opt/voice_ai/.env
```

On droplet:

```bash
chmod 600 /opt/voice_ai/.env
ls -la /opt/voice_ai
# expect: docker-compose.prod.yml  .env  data/
free -h   # sanity check RAM before installing runner
```

---

## Part C — Droplet: install & register GitLab Runner

### C1. Install runner

```bash
curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | bash
apt-get install -y gitlab-runner
usermod -aG docker gitlab-runner
gitlab-runner --version
```

### C2. Create runner in GitLab UI

1. GitLab project → **Settings** → **CI/CD**
2. Expand **Runners**
3. Click **Create project runner** (or “New project runner”)
4. Tags: `docker`, `digitalocean` (optional but good for demos)
5. Create → **copy the registration token**

### C3. Register on the server

```bash
gitlab-runner register
```

Answer prompts:

| Prompt | Answer |
|---|---|
| GitLab URL | `https://gitlab.com/` |
| Token | paste from UI |
| Description | `do-testing-runner` |
| Tags | `docker,digitalocean` |
| Executor | `docker` |
| Default Docker image | `docker:27` |

### C4. Edit runner config (important for this demo)

```bash
nano /etc/gitlab-runner/config.toml
```

Make sure you have:

```toml
concurrent = 1

[[runners]]
  name = "do-testing-runner"
  url = "https://gitlab.com/"
  token = "KEEP_EXISTING_TOKEN"
  executor = "docker"
  [runners.docker]
    image = "docker:27"
    privileged = false
    volumes = [
      "/var/run/docker.sock:/var/run/docker.sock",
      "/opt/voice_ai:/opt/voice_ai",
      "/cache"
    ]
```

```bash
gitlab-runner restart
gitlab-runner status
```

In GitLab → **Settings → CI/CD → Runners**: runner should be **green / online**.

---

## Part D — GitLab UI: configure CI/CD variables

Project → **Settings** → **CI/CD** → **Variables** → **Add variable**

| Key | Value | Flags |
|---|---|---|
| `DEMO_SAME_DROPLET` | `1` | — |
| `HEALTH_URL` | `http://172.17.0.1:3006/health` | optional |

You do **not** need to set `CI_REGISTRY_USER` / `CI_REGISTRY_PASSWORD` manually — GitLab injects them for its Container Registry.

**Container Registry:** Project → **Deploy** → **Container Registry**  
(first successful `build` job creates images here).

---

## Part E — Run the first pipeline

### E1. Trigger

Option A: push a tiny change to `main`  
Option B: **Build** → **Pipelines** → **Run pipeline** → branch `main`

### E2. What you should see

| Stage | Job | What it does |
|---|---|---|
| validate | `lint` | `npm ci` + syntax check |
| build | `build` | `docker build` + push to GitLab Registry |
| deploy | `deploy_local` | **manual** — pull image, recreate container |
| verify | `verify` | curl health (may warn; `allow_failure`) |

Click the play button on **`deploy_local`** when you are ready to update the live container.

### E3. Confirm on droplet

```bash
docker ps | grep voice-ai
curl -s http://127.0.0.1:3006/health
docker images | head
free -h
```

---

## Part F — Demo checklist (interview)

1. Show GitLab project + `.gitlab-ci.yml`
2. Show Runner online (self-hosted on DO)
3. Show a green pipeline
4. Show Container Registry image tags
5. Click manual deploy → show `docker ps` / live URL
6. Say: “In production I’d put GitLab CE on a dedicated 4–8 GB node; this host runs the app, so control plane is GitLab.com and execution is self-hosted.”

---

## Part G — Lessons learned (say this in interview)

### 1. GitLab.com vs self-hosted GitLab CE
- **GitLab.com** = control plane (repo, pipelines UI, registry).
- **Self-hosted Runner** = where jobs actually run (CPU/RAM/Docker).
- Full **GitLab CE** needs its own 4–8 GB server. Don’t co-locate with a busy app on 4 GB.

### 2. Pipeline ≠ Runner
- Pipeline = workflow definition + status in UI.
- Runner = machine that executes `script:` blocks.
- `docker build` in CI runs **on the runner**, not on gitlab.com.

### 3. Docker executor + socket vs DinD
- **DinD** (Docker-in-Docker) needs `privileged` and more RAM.
- **Host docker.sock** is lighter for a small droplet demo.
- Trade-off: jobs share the host Docker daemon (simpler, less isolation).

### 4. Stages & safety gates
- `validate → build → deploy → verify`
- Manual deploy (`when: manual`) protects production from every push auto-shipping.

### 5. Secrets & config
- App secrets stay in droplet `.env` (never baked into the image).
- CI variables for demo flags (`DEMO_SAME_DROPLET`).
- Registry auth uses built-in `CI_JOB_TOKEN` / registry variables.

### 6. Resource planning
- Idle runner ≈ safe on 4 GB.
- Build spikes RAM; use `concurrent = 1`.
- Disk + swap matter; prune old images after demos.

### 7. Same-droplet deploy pattern
- Runner and app share one Docker host → `deploy_local` can pull + recreate without SSH.
- Production often uses SSH/Kubernetes to a **separate** app cluster.

### 8. Mapping to the DevOps JD
| JD item | What you did |
|---|---|
| GitLab / CI/CD | `.gitlab-ci.yml` pipelines |
| Self-hosted runner | Runner on DigitalOcean |
| Docker | Build + run image |
| Cloud | DO droplet as compute |
| Linux / shell | Install, register, `config.toml` |
| Monitoring/troubleshoot | health job, `free -h`, runner logs |

---

## Quick troubleshooting

| Problem | Fix |
|---|---|
| Runner offline | `gitlab-runner status`; check token; `systemctl restart gitlab-runner` |
| `docker: permission denied` | `usermod -aG docker gitlab-runner` then restart runner |
| `docker info` fails in job | mount `/var/run/docker.sock` in `config.toml` |
| `deploy_local` missing | set CI variable `DEMO_SAME_DROPLET=1` |
| Build OOM / killed | stop unused containers; retry; keep `concurrent = 1` |
| Registry push denied | ensure project Container Registry is enabled; re-run on `main` |
| Health check fails | app not up yet, or wrong `HEALTH_URL`; check `docker logs voice-ai` |

Runner logs:

```bash
journalctl -u gitlab-runner -f
```

---

## Cleanup after 2 days (optional)

```bash
gitlab-runner stop
# or uninstall:
# apt-get remove -y gitlab-runner
```

Remove CI variables you no longer need. Keep the GitLab project if you want it on your resume.
