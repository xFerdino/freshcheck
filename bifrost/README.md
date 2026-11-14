# Bifrost AI Gateway for FreshCheck

Bifrost is an open-source AI gateway (OpenAI-compatible) by Maxim AI that sits between FreshCheck and LLM providers.

## Self-Hosting Bifrost (Free)

### Option A: Local CLI / npx (Zero Setup)
Run Bifrost directly with Node.js / npx:
```bash
# Set your upstream provider key
export OPENAI_API_KEY="your-openai-key"

# Launch Bifrost with repo config on port 8080
npx -y @maximhq/bifrost -app-dir ./bifrost -port 8080
```
On Windows PowerShell:
```powershell
$env:OPENAI_API_KEY="your-openai-key"
npx -y @maximhq/bifrost -app-dir ./bifrost -port 8080
```

### Option B: Docker Compose
```bash
OPENAI_API_KEY=your-key docker compose up bifrost
```

### Option C: Free Cloud Host (Render / Fly.io / Railway / HuggingFace)
Deploy the official image `maximhq/bifrost:v2.5.1`:
- Environment variables:
  - `OPENAI_API_KEY`: your OpenAI key
  - `BIFROST_PORT`: 8080 (or $PORT)
- Mount or copy `config.json` into `/app/data/config.json`.
- Set your FreshCheck backend environment:
  ```env
  BIFROST_BASE_URL=https://your-bifrost-instance.example.com
  BIFROST_API_KEY=optional-gateway-key
  ```

## Verifying in FreshCheck
When `BIFROST_BASE_URL` is set, FreshCheck automatically routes all LLM extraction and verification calls through Bifrost.
In the FreshCheck UI, expand **Run details** at the bottom of the check results to confirm:
- `route: bifrost` is shown in the header summary.
- Every LLM stage log in the table shows route `bifrost` with model, latency, and token metrics.
