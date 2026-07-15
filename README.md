# 📈 Stock Briefing Tool

Automated stock briefing system that sends you briefings at 8am, 1pm, and 5pm daily with price data, news, technical analysis, and volume info.

**Currently tracking:** BRC (Brinks), SKHY (Skyline)

---

## Setup Instructions

### Step 1: Get API Keys

You need 3 things:

#### A) Alpha Vantage (Stock Prices)
1. Go to https://www.alphavantage.co/
2. Click "GET FREE API KEY"
3. Enter your email, click the link they send
4. Copy your API key

#### B) NewsAPI (Latest News)
1. Go to https://newsapi.org/
2. Sign up (free tier is fine)
3. Go to Dashboard → API keys
4. Copy your API key

#### C) Gmail App Password
1. Go to https://myaccount.google.com/
2. Click "Security" in the left menu
3. Scroll down to "App passwords"
4. Select "Mail" and "Windows Computer" (or whatever)
5. Google gives you a 16-character password
6. Copy it (this is NOT your regular password)

---

### Step 2: Deploy to Railway

1. **Create Railway Account**
   - Go to https://railway.app/
   - Sign up with GitHub (easiest)

2. **Create New Project**
   - Click "New Project" → "Deploy from GitHub"
   - Connect your GitHub account
   - Create a new public repo called `stock-briefing-tool`
   - Push these files to that repo

3. **Add Environment Variables**
   - In Railway dashboard, go to your project
   - Click "Variables" (at the top)
   - Add these variables:
     ```
     GMAIL_USER = your_email@gmail.com
     GMAIL_PASSWORD = your_16_char_app_password
     ALPHA_VANTAGE_KEY = your_alpha_vantage_key
     NEWS_API_KEY = your_newsapi_key
     ```

4. **Deploy**
   - Railway auto-deploys when you push to GitHub
   - Watch the logs to make sure it starts

---

### Step 3: Get Your Backend URL

Once deployed:
1. In Railway, click on your deployment
2. Look for "Railway URL" or "External URL"
3. Copy it (looks like `https://something.railway.app`)
4. This is your `REACT_APP_API_URL`

---

### Step 4: Deploy Frontend (Optional but Recommended)

You have two options:

**Option A: Vercel (Easy)**
1. Push a `public/index.html` version of the app to GitHub
2. Go to https://vercel.com/
3. Import your GitHub repo
4. Add environment variable: `REACT_APP_API_URL=https://your-railway-url`
5. Deploy

**Option B: Run Locally**
- Just run the React app on your computer with:
  ```
  npm install
  npm start
  ```
- Set `REACT_APP_API_URL=http://localhost:5000`

---

## Adding More Stocks

Once running, you can add stocks through the web app:
1. Go to "Manage Stocks" tab
2. Enter ticker (e.g., AAPL, TSLA)
3. Click "Add Stock"

They'll be included in future 8am, 1pm, 5pm briefings.

---

## How It Works

**Backend (Node.js on Railway):**
- Runs 24/7
- At 8am, 1pm, 5pm daily (UTC):
  - Pulls latest price data from Alpha Vantage
  - Fetches latest news from NewsAPI
  - Generates briefing report
  - Sends email to `joshuamost726@gmail.com`
  - Saves to history

**Frontend (React):**
- Dashboard to view briefings on demand
- Manage tracked stocks
- View briefing history
- Update email address

---

## Troubleshooting

**"Email not sending?"**
- Check Gmail app password is correct
- Make sure 2FA is enabled on Gmail first

**"Stock data not showing?"**
- Alpha Vantage free tier has rate limits (5 calls/min)
- Wait a bit and try again
- Check API key is valid

**"Railway keeps crashing?"**
- Check logs in Railway dashboard
- Make sure all environment variables are set
- Ensure Node.js version is 18.x

---

## Cost

- **Railway**: Free tier includes $5/month credit (this easily covers your use)
- **Alpha Vantage**: Free (5 calls/min limit)
- **NewsAPI**: Free (500 calls/day limit)
- **Gmail**: Free

Total: **$0** (within free limits)

---

## Support

If something breaks, check:
1. Railway logs (in the dashboard)
2. Environment variables are all set correctly
3. Gmail app password (not regular password)
4. API key validity

Let me know if you hit any issues!
