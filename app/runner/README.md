# The agent runner

The agent loop, moved off Netlify onto our own server. Same code as the
`agent-tick` schedule, from `netlify/functions/loop-core.mts`.

## Why it can move without a deploy

Each pass writes a heartbeat. The Netlify schedule checks it first and stands
down while it is under 45 minutes old. Start this and the schedule goes quiet
by itself; stop it and the schedule takes the loop back within 45 minutes.

## What it needs

- Node 20.6 or newer (for `--env-file`)
- `CLEAT_RUNNER_SECRET` set in Netlify too, and the next deploy made, so
  `/api/agent-store` exists and answers. Until then the runner cannot reach
  the paper books.
- Optionally a local model with an OpenAI-compatible API, such as the Qwen
  already on the box. With `LOCAL_LLM_URL` set, Gemini is never asked and the
  prompt never leaves the server.

It holds no Netlify token. `/api/agent-store` reads and writes only the loop's
own keys and nothing else on the account.

## Setting it up

```
# on this machine, from app/
node scripts/bundle-runner.mjs
scp runner/dist/agent-runner.mjs runner/cleat-agent.service root@<server>:/root/

# on the server
mkdir -p /opt/cleat-agent && mv /root/agent-runner.mjs /opt/cleat-agent/
mv /root/cleat-agent.service /etc/systemd/system/
cp cleat-agent.env.example /etc/cleat-agent.env && chmod 600 /etc/cleat-agent.env
# fill in /etc/cleat-agent.env, then
systemctl daemon-reload && systemctl enable --now cleat-agent
journalctl -u cleat-agent -f
```

A pass logs one line: vaults, proposals, and which model answered.
