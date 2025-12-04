# ANSYS Data Auto-Fetch Setup

## How It Works
- GitHub Actions runs every 6 hours
- Puppeteer (headless browser) logs into licensing.ansys.com
- Downloads YTD data and last-week data as CSVs
- Commits the files to your repo's `/data` folder
- Your dashboard can load from these files automatically

## Setup Instructions

### 1. Add your credentials to GitHub Secrets

1. Go to your GitHub repo
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these two secrets:

| Name | Value |
|------|-------|
| `ANSYS_USERNAME` | Your ANSYS portal email/username |
| `ANSYS_PASSWORD` | Your ANSYS portal password |

⚠️ **These are encrypted and never visible in logs or code!**

### 2. Add the files to your repo

Copy these files to your repository:
```
your-repo/
├── .github/
│   └── workflows/
│       └── fetch-ansys-data.yml
├── scripts/
│   └── fetch-ansys-data.js
└── data/
    └── (CSVs will appear here automatically)
```

### 3. Enable GitHub Actions

1. Go to your repo → **Actions** tab
2. If prompted, click "I understand my workflows, go ahead and enable them"

### 4. Test it manually

1. Go to **Actions** → **Fetch ANSYS Usage Data**
2. Click **Run workflow** → **Run workflow**
3. Watch the logs to make sure it works

### 5. Update your dashboard to load from the repo

Modify your dashboard to fetch data from:
- `https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/historical_data.csv`
- `https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/recent_data.csv`

---

## Troubleshooting

### "Login failed"
- Double-check your username/password in GitHub Secrets
- The login page structure may have changed - check the error screenshot

### "Download button not found"
- The script may need adjustments for the exact button selectors
- Check `error-screenshot.png` in the Actions artifacts

### Need to adjust the script?
The selectors in `fetch-ansys-data.js` may need tweaking based on the actual HTML.
You can run locally to debug:
```bash
export ANSYS_USERNAME="your-email"
export ANSYS_PASSWORD="your-password"
node scripts/fetch-ansys-data.js
```

---

## Cost
**$0** - GitHub Actions free tier includes 2,000 minutes/month.
This workflow uses ~2-3 minutes per run × 4 runs/day = ~240-360 minutes/month.
