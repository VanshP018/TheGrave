# Going live with TheGrave

This is the step-by-step for taking TheGrave from this repository to a public website on a server you control.
It assumes one Linux server running Docker. Allow about an hour the first time.

Nothing in this guide has been run against a real domain or a cloud server (that needs your accounts). The
whole stack **was** built and run locally in production mode, and a real browser was driven through it:
register with an emailed code, log in, sandboxed code runs, a graded submission and the hint coach. Where
something is untested, this guide says so.

---

## 1. What you are deploying

```
Internet ──► Caddy (ports 80/443, automatic HTTPS) ──┬─► static website files
                                                      └─► api  (/api, /socket.io, /health)
                                                            │
                          ┌─────────────────────────────────┼───────────────┐
                          ▼                                 ▼               ▼
                      postgres                           redis           worker ──► sandbox containers
                   (users, matches,                (queues, ratings,     (judges DSA code and
                    problems, runs)                 pending sign-ups)     programming challenges)
```

| Service | What it does | Reachable from the internet? |
|---|---|---|
| `web` (Caddy) | HTTPS, security headers, serves the site, forwards `/api` and websockets | **Yes**, ports 80 and 443 |
| `api` | The application server. Runs read-only, as a non-root user, with no capabilities | No |
| `worker` | Runs submitted code inside locked-down throwaway containers | No |
| `postgres` | The database | No |
| `redis` | Job queues, leaderboard, battle and sign-up state | No |
| `migrate` | Applies database migrations once per release, then exits | No |

The site and API share one domain. That is deliberate: the login cookie is `SameSite=Strict`, so it only works
when the website and API are the same origin.

---

## 2. Before you start

You need:

- **A Linux server**: Ubuntu 22.04 or 24.04, at least **2 vCPU and 4 GB RAM** (judging code is the heavy part;
  use 4 vCPU / 8 GB if you expect many simultaneous battles) and 30 GB of disk. Do not share it with other
  workloads: the judge relies on the kernel killing runaway programs quickly, and on a memory-starved host a
  memory-hogging submission can be reported as "time limit exceeded" instead of "memory limit exceeded"
  (it is rejected either way; only the label changes). This was seen on a developer laptop whose Docker VM had 4 GB
  shared with several other projects.
- **A domain name** you can edit DNS for.
- **An email provider** that can send from your domain (Mailjet, Resend, SendGrid, Amazon SES...). Registration
  needs email: the server refuses to start without it.
- *(Optional)* an **Anthropic API key** for the AI hint coach. Without it the coach says "not set up".
- **The code in a Git repository** you can clone onto the server.

Do these three things first:

1. **Commit and push your work.** The repository currently has a lot of uncommitted changes. Commit them, push
   to your Git host, and tag the release (`git tag v1.0.0 && git push --tags`). The server builds from Git, so
   whatever is not pushed will not be deployed.
2. **Rotate the Mailjet keys.** They were pasted into a chat. In Mailjet, create a new API key and secret and
   revoke the old pair. Use the new pair in section 6.
3. **Plan your sender address.** Mailjet only sends from verified senders, and sending "from" a gmail.com
   address through a third party often lands in spam. Add your own domain in Mailjet and publish its **SPF and
   DKIM** DNS records (Mailjet shows them under Sender domains & addresses). Then use something like
   `no-reply@yourdomain`.

---

## 3. Prepare the server

Connect over SSH and run:

```sh
# Docker (official script) and git
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y git

# A non-root user to run the site (log out and back in after this)
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
```

> `docker` group membership is root-equivalent on that machine. That is why this guide recommends a server that
> holds nothing else (see section 12).

Firewall: allow only SSH and web traffic. Postgres and Redis are not published to the host at all, so there is
nothing else to expose.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp     # HTTP/3
sudo ufw enable
```

---

## 4. Point your domain at the server

Create DNS records at your registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (or your subdomain) | your server's IPv4 address |
| `AAAA` | `@` (or your subdomain) | your server's IPv6 address, if it has one |

Wait until `dig +short yourdomain.example` shows the server's address. **Do this before the first start:** Caddy
requests the HTTPS certificate on first boot, and Let's Encrypt must be able to reach your server by that name.

---

## 5. Get the code

As the `deploy` user:

```sh
git clone <your repository url> thegrave
cd thegrave
git checkout v1.0.0          # the tag you pushed
```

---

## 6. Create the settings file

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate the four secrets, each separately, and paste them into `.env.production`:

```sh
openssl rand -hex 24        # POSTGRES_PASSWORD
openssl rand -hex 24        # REDIS_PASSWORD
openssl rand -base64 48     # JWT_ACCESS_SECRET
openssl rand -base64 48     # JWT_REFRESH_SECRET   (must differ from the one above)
```

Then fill in the rest:

| Setting | Value |
|---|---|
| `DOMAIN` | `yourdomain.example` (no `https://`) |
| `SMTP_HOST` / `SMTP_PORT` | e.g. `in-v3.mailjet.com` / `587` |
| `SMTP_USER` / `SMTP_PASS` | your **new** provider credentials (Mailjet: API key / secret key) |
| `MAIL_FROM` | `"TheGrave <no-reply@yourdomain.example>"`, a verified sender |
| `ANTHROPIC_API_KEY` | optional, enables the hint coach |
| `DEEPSEEK_API_KEY`, `GROQ_API_KEY` | optional alternatives for the hint coach; with several keys set, `HINT_PROVIDER` (`anthropic`, `deepseek` or `groq`) picks one, else the first set wins in that order |

Leave `SITE_ADDRESS` commented out. `.env.production` is ignored by git; never commit it.

The server **checks its own settings on every start** and refuses to run if any of these is wrong: no SMTP host,
an `http://` or `localhost` origin, the two JWT secrets equal or looking like placeholders, the development
database password, or the test-only `HINT_MODEL=fake`. If it fails, `docker compose logs api` tells you which.

---

## 7. Build and start

All commands run from the `thegrave` folder. To save typing:

```sh
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

```sh
# 1. The two sandbox images the judge launches for every submission (one-off, and after changes to them).
#    This also builds the app images, so step 2 is then quick.
dc --profile images build

# 2. Build the application images and start everything
dc up -d --build
```

The first build takes several minutes. On startup, in order: Postgres and Redis become healthy, `migrate`
creates the database tables and exits, the API starts, then Caddy starts and obtains your certificate.

```sh
dc ps            # api and web should be Up; migrate shows Exited (0), which is correct
```

---

## 8. Load the problems (once)

The DSA problems and programming challenges live in the database. Load them:

```sh
dc run --rm --no-deps api node dist/seed/index.js
```

Expect it to end with `seeded 30 problems` and `seeded 5 projects`. It takes a short while. It is safe to run
again later, for instance after adding problems: it updates by name and never deletes players' data.

---

## 9. Check that it works

```sh
curl -s https://yourdomain.example/health
# {"status":"ok","postgres":true,"redis":true}

curl -sI https://yourdomain.example | grep -i -E "strict-transport|content-security|x-frame"
```

Then in a browser:

1. Open `https://yourdomain.example`. The landing page loads with a padlock.
2. Register. You should receive an email with a 6-digit code within a minute. If not, see Troubleshooting.
3. Enter the code. You land on the DSA page and see **Connected**.
4. Open Programming, then a challenge, type `ls` in the terminal. Output appears: the judge worker is working.
5. Open it in a second browser (or incognito) with another account and run a **Find match** to see a battle start.

---

## 10. Keep it healthy

**Backups.** The database holds all accounts, ratings and history. Back it up daily:

```sh
deploy/backup.sh                       # writes backups/thegrave-<time>.sql.gz and keeps the newest 14
crontab -e                             # then add:
# 30 3 * * * cd /home/deploy/thegrave && deploy/backup.sh >> backups/backup.log 2>&1
```

Copy `backups/` off the server too (object storage, another machine). A backup that lives only on the server it
protects is not a backup. Restore (tested on the local stack with a scratch database; **this overwrites the
database**):

```sh
dc stop api worker
gunzip -c backups/<file>.sql.gz | dc exec -T postgres psql -U thegrave -d thegrave
dc start api worker
```

**Logs.** `dc logs -f api` (JSON lines), `dc logs -f worker`, `dc logs -f web`. Logs rotate at 10 MB x 5 files per
service. Health-check requests are not logged.

**Monitoring.** There is no built-in alerting. Point a free uptime monitor (UptimeRobot, Better Stack) at
`https://yourdomain.example/health`: it returns 503 when Postgres or Redis is unreachable.

**Disk.** Sandbox images and build cache accumulate. Occasionally: `docker system prune -f` (it does not touch
named volumes, which hold your data).

---

## 11. Updating and rolling back

```sh
deploy/backup.sh                       # always back up first
git fetch --tags && git checkout v1.1.0
dc --profile images build              # only if the sandbox images changed
dc up -d --build                       # migrations run automatically before the API restarts
dc run --rm --no-deps api node dist/seed/index.js    # only if problems or challenges changed
```

Expect a few seconds of downtime while the API restarts; players in a live battle reconnect automatically (the
server holds a 30-second grace period).

**Rollback.** Check out the previous tag and run `dc up -d --build`. Migrations only ever go forward, so if a
release changed the database in a way the old code cannot read, restore the backup you took in the first step.

---

## 12. The judge host (read this before you have real users)

The `worker` starts a throwaway container for every submission. To do that it uses the server's Docker socket,
and **access to the Docker socket is root access to that machine**. The sandbox containers themselves are
locked down (no network, read-only filesystem, no capabilities, unprivileged user, memory/CPU/process limits),
and the worker only runs code that players submit. But running strangers' code is the riskiest thing this site does, so:

- **Best:** run the `worker` on its **own small VM** that holds no database and no secrets beyond what it
  needs, separate from the web/API/database machine. Give that VM the same `.env.production` plus Postgres and
  Redis addresses that it can reach (private network or firewall-restricted), and start only the worker there:
  `dc up -d --no-deps worker` (build the sandbox images there too). On the main server, start everything except
  `worker`.
- **Better still:** install **gVisor** on the judge VM (`runsc`) and add `JUDGE_RUNTIME=runsc` to the settings.
  Sandboxes then run with a user-space kernel, a much stronger boundary.
- **Single server (fine to start):** keep everything on one machine as in this guide, accept the risk while the
  site is small, and plan the split before it grows.

---

## 13. Security checklist

Done for you in the code and configuration:

- HTTPS everywhere with automatic certificates; HSTS, `nosniff`, clickjacking protection, a strict
  Content-Security-Policy (scripts only from your own origin; fonts are bundled, nothing loads from third parties).
- Passwords hashed with argon2id; short-lived access tokens; refresh token in an `HttpOnly`, `Secure`,
  `SameSite=Strict` cookie scoped to `/api/auth`.
- Email-verified registration; one-time codes stored hashed, 10-minute expiry, 5 attempts, resend cooldown, and a
  10-codes-per-hour cap per address.
- Rate limits per user and per IP (the real client IP, via the proxy setting `TRUST_PROXY=1`).
- Hidden tests and reference solutions never leave the server; the AI coach never sees them either.
- API container: non-root, read-only filesystem, all capabilities dropped; the database and Redis are not
  reachable from outside the Docker network.

Left for you:

- [ ] Rotated the Mailjet keys that were shared in chat.
- [ ] Sender domain verified with SPF and DKIM.
- [ ] Backups copied off the server; a restore tried once.
- [ ] Uptime monitor on `/health`.
- [ ] SSH key login only (`PasswordAuthentication no`) and automatic security updates on the server.
- [ ] Judge worker moved to its own VM (section 12) before opening to the public.
- [ ] A privacy policy and terms of use. The site stores emails, school names and profile photos, and users
  submit code. Check what the law requires where your users are.
- [ ] A way to contact you for abuse reports, and a plan for removing a player (there is no admin panel;
  it is a database operation today).

---

## 14. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `dc up` stops with "set DOMAIN / POSTGRES_PASSWORD..." | A value is missing in `.env.production`. |
| `api` keeps restarting | `dc logs api`: the startup check names the unsafe setting (see section 6). |
| Site shows a certificate error | DNS does not point at the server yet, or ports 80/443 are blocked. `dc logs web`. |
| Registration says OK but no email arrives | `dc logs api` for a mail error. Check `SMTP_USER/PASS`, that `MAIL_FROM` is a verified sender, and the spam folder. New provider accounts often hold their first messages for review. |
| Terminal and submissions hang on "Queued" | The worker is down or cannot reach Docker: `dc logs worker`, and check the sandbox images exist (`docker images | grep thegrave`; if not, `dc --profile images build`). |
| Everyone gets "Too many requests" | The proxy setting is wrong, so all users share one IP. `TRUST_PROXY=1` must be set (it is, in `docker-compose.prod.yml`). |
| Hint coach says "not set up" | No `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` or `GROQ_API_KEY`. Add one and `dc up -d`. |
| Logged out on every reload | The site is being opened over plain `http://` or a different domain than `DOMAIN`. |

---

## 15. Try the production setup on your own computer first

You can run the exact production stack locally without a domain, which is how it was tested for this guide:

```sh
cp .env.production.example .env.production
# set the secrets as in section 6, then add:
#   DOMAIN=localhost
#   SITE_ADDRESS=:80            (plain http on port 80)
#   SMTP_HOST=host.docker.internal   SMTP_PORT=1025   (the dev Mailpit inbox: docker compose up -d mailpit)
docker compose -f docker-compose.prod.yml --env-file .env.production --profile images build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Then open `http://localhost`. Registration emails appear at `http://localhost:8025`. Stop and remove it with
`... down -v` (this deletes the local test data). It uses its own project name (`thegrave-prod`), so it never
touches your development database.

---

## 16. What this setup does not do (yet)

- **One of everything.** One API process, one database, no failover. A server reboot is a short outage. The
  realtime layer is built to scale across several API servers (Redis adapter), but that has not been tested.
- **No automatic deployment.** CI (`.github/workflows/ci.yml`) checks every push but does not deploy. It has
  not run yet: it activates on your first push to GitHub, and the first run may need small fixes.
- **No admin interface**, error tracker or metrics dashboard.
- **Not load tested.** Capacity depends mostly on how many submissions the judge can run at once
  (`JUDGE_CONCURRENCY`, `WORKSPACE_CONCURRENCY`) and your server size. Raise them with the CPU count and watch
  `dc logs worker`.
