# shopify-clone

A Node.js CLI tool that clones data from a production Shopify store to a development store. Supports the **new Shopify Dev Dashboard** (client credentials grant) and legacy admin-created custom apps.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Source Store Safety](#source-store-safety)
- [Prerequisites](#prerequisites)
- [Step-by-Step Setup](#step-by-step-setup)
  - [Step 1: Install Node.js](#step-1-install-nodejs)
  - [Step 2: Download and Install the Tool](#step-2-download-and-install-the-tool)
  - [Step 3: Create Apps in the Dev Dashboard](#step-3-create-apps-in-the-dev-dashboard)
  - [Step 4: Configure API Scopes](#step-4-configure-api-scopes)
  - [Step 5: Release App Versions](#step-5-release-app-versions)
  - [Step 6: Install Apps on Your Stores](#step-6-install-apps-on-your-stores)
  - [Step 7: Get Your Client Credentials](#step-7-get-your-client-credentials)
  - [Step 8: Configure the .env File](#step-8-configure-the-env-file)
  - [Step 9: Run the Clone](#step-9-run-the-clone)
- [Usage Examples](#usage-examples)
- [Resources Cloned](#resources-cloned)
- [How It Works](#how-it-works)
- [How Matrixify and Other Apps Do It](#how-matrixify-and-other-apps-do-it)
- [Legacy Auth (Admin-Created Custom Apps)](#legacy-auth-admin-created-custom-apps)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)

---

## What It Does

`shopify-clone` reads resources from a **source** Shopify store (your production store) and recreates them on a **target** store (your development store). This is useful for setting up staging environments with real production data for app testing.

---

## Source Store Safety

Your production store will **never be modified** by this tool. Here's why:

### Layer 1: Read-Only API Scopes

The source app only needs **read** scopes (`read_products`, `read_content`, etc.). It literally does not have permission to write data. Even if the tool tried, Shopify's API would reject the request with a 403 Forbidden.

**Recommendation:** When creating the source app in the Dev Dashboard, only grant `read_*` scopes — never `write_*`. This is your first line of defense enforced by Shopify itself.

### Layer 2: Read-Only Client Lock

The source store's API client is initialized in **read-only mode** at the code level. The `post()`, `put()`, and `delete()` methods are hard-blocked on the source client. If any code path ever attempted a write operation on the source store (which none do), the tool would immediately throw an error:

```
SAFETY BLOCK: Attempted POST /products.json on read-only store my-store.myshopify.com.
This is a bug — the source store should never receive write requests.
The operation has been blocked. Your source store is safe.
```

This is a defense-in-depth measure — the code already never writes to source, but the lock guarantees it.

### Layer 3: Same-Store Prevention

If `SOURCE_SHOP` and `TARGET_SHOP` are accidentally set to the same domain, the tool refuses to start:

```
Error: SOURCE_SHOP and TARGET_SHOP are the same store.
This would create duplicate data on your production store. Aborting.
```

### Layer 4: Confirmation Prompt

Before any data is written, the tool shows a confirmation prompt:

```
Ready to clone data from my-store.myshopify.com → my-dev-store.myshopify.com.
  This will CREATE new data on my-dev-store.myshopify.com.
  The source store (my-store.myshopify.com) will NOT be modified.
  Continue? (y/N):
```

You must type `y` to proceed. Use `--dry-run` to preview without writing anything at all.

### Layer 5: Target Store Pre-Flight Check

Before cloning, the tool checks if the target store already has data (products, pages, collections, redirects). If it does, you get a warning:

```
⚠ Target store (my-dev-store.myshopify.com) already has data:
  Products: 142 already exist — cloning will create duplicates
  Pages: 5 already exist — cloning will create duplicates
⚠ Running the clone again will create DUPLICATE items.
  Consider using --skip or clearing the target store first.
```

This prevents you from accidentally running the clone twice and ending up with duplicate products.

### What the Tool Does to Each Store

| Action | Source Store | Target Store |
|---|---|---|
| Read products, pages, themes, etc. | Yes (GET only) | No |
| Create products, pages, themes, etc. | **Never** | Yes |
| Update existing data | **Never** | **Never** |
| Delete data | **Never** | **Never** |
| Modify settings, payments, etc. | **Never** | **Never** |

### Side Effects on the Source Store

The only interaction with your source store is **reading data via API GET requests**. This has minimal side effects:

- **Rate limit usage:** The tool makes GET requests at a controlled rate (max 2/second). This counts against your source store's API rate limit bucket (40 requests for standard plans). If you have other apps making heavy API calls simultaneously, they could collectively hit the rate limit and experience brief throttling. This is temporary and resolves within seconds.
- **No data changes:** GET requests do not create, modify, or delete any store data. They are the equivalent of viewing your store admin — just reading information.
- **No webhooks triggered:** Reading data does not trigger any webhook events on your source store.
- **No customer notifications:** No emails, SMS, or notifications are sent.

---

## Prerequisites

- **Node.js 18 or higher** — the tool uses native `fetch` (available in Node 18+)
- **A Shopify store** (the production/source store)
- **A Shopify development store** (the target store)
  - Create one at [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard/) > **Stores** > **Create store** > **Development store**
- **A Shopify Partner account** (free) — sign up at [partners.shopify.com](https://partners.shopify.com) if you don't have one. This gives you access to the Dev Dashboard.

---

## Step-by-Step Setup

### Step 1: Install Node.js

If you don't have Node.js installed:

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the **LTS** version (must be 18 or higher)
3. Install it following the on-screen instructions
4. Verify by opening a terminal and running:

```bash
node --version
# Should show v18.x.x or higher
```

### Step 2: Download and Install the Tool

```bash
cd shopify-clone
npm install
```

This installs all dependencies. You should see a success message with no errors.

### Step 3: Create Apps in the Dev Dashboard

> **Important:** Since January 1, 2026, you can no longer create new custom apps from the Shopify admin. All new apps must be created through the **Dev Dashboard**.

You need **two apps** — one installed on your source (production) store and one on your target (development) store.

**Create the Source App (for reading from production):**

1. Go to [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard/)
2. Click **Create app** (top-right)
3. Choose **Create app manually** (not the Remix/CLI template — you don't need a full app framework)
4. Enter a name like `Store Clone - Source (Read)`
5. Under **Distribution**, choose **Custom distribution** (single-store use)
6. Click **Create**

**Create the Target App (for writing to development):**

1. Same steps as above
2. Name it `Store Clone - Target (Write)`
3. Choose **Custom distribution**
4. Click **Create**

### Step 4: Configure API Scopes

Each app needs specific permissions (scopes) to access store data.

**For the Source App (read-only access):**

1. Open your Source app in the Dev Dashboard
2. Go to **Configuration** (left sidebar)
3. Under **Admin API integration**, click **Configure** (or **Edit**)
4. Under **Admin API access scopes**, check these boxes:

| Scope | What it accesses |
|---|---|
| `read_products` | Products, variants, collections, inventory |
| `read_content` | Pages, blogs, articles, redirects |
| `read_themes` | Theme templates and asset files |
| `read_script_tags` | Script tag injections |
| `read_metaobjects` | Metaobject entries |
| `read_metaobject_definitions` | Metaobject definitions |

5. Click **Save**

**For the Target App (write access):**

1. Open your Target app in the Dev Dashboard
2. Same navigation as above
3. Check these scopes:

| Scope | What it accesses |
|---|---|
| `write_products` | Create products, variants, collections |
| `write_content` | Create pages, blogs, articles, redirects |
| `write_themes` | Create themes and upload assets |
| `write_script_tags` | Create script tags |
| `write_metaobjects` | Create metaobject entries |
| `write_metaobject_definitions` | Create metaobject definitions |

5. Click **Save**

### Step 5: Release App Versions

Before you can install an app, you must **release a version** of it. This is a new requirement with the Dev Dashboard — think of it like publishing a draft.

1. In the Dev Dashboard, open your Source app
2. Go to **Release** (left sidebar) or look for **Versions**
3. Click **Create version** (or **Release new version**)
4. Add a version name/note (e.g., `v1.0 — Initial release`)
5. Click **Release**
6. Repeat for the Target app

> If you skip this step, the install link won't work and you'll get an error.

### Step 6: Install Apps on Your Stores

After releasing a version, you need to install each app on its respective store.

**Install the Source App on your production store:**

1. In the Dev Dashboard, open the Source app
2. Go to **Distribution** (left sidebar)
3. You'll see an **Install link** — it looks like:
   `https://admin.shopify.com/store/{your-store}/oauth/install?client_id=xxx`
4. Click the link (or copy/paste into your browser)
5. You'll see a permission consent screen — click **Install**

**Install the Target App on your development store:**

1. Same steps for the Target app
2. Use the install link and install it on your **development** store

> **Tip:** If you don't see the install link, make sure you've released a version (Step 5) and selected **Custom distribution** (Step 3).

### Step 7: Get Your Client Credentials

Now get the Client ID and Client Secret for each app.

1. In the Dev Dashboard, open the Source app
2. Go to **Settings** (left sidebar, near bottom)
3. You'll see **Client ID** and **Client secret** — copy both
4. Repeat for the Target app

> **Never share your Client Secret publicly.** Treat it like a password.

### Step 8: Configure the .env File

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in your values:

```env
AUTH_METHOD=client_credentials

# Source Store (Production)
SOURCE_SHOP=my-store.myshopify.com
SOURCE_CLIENT_ID=abc123xxxxxxxxxxxxxxxxxxxxxxxxxx
SOURCE_CLIENT_SECRET=def456xxxxxxxxxxxxxxxxxxxxxxxxxx

# Target Store (Development)
TARGET_SHOP=my-dev-store.myshopify.com
TARGET_CLIENT_ID=ghi789xxxxxxxxxxxxxxxxxxxxxxxxxx
TARGET_CLIENT_SECRET=jkl012xxxxxxxxxxxxxxxxxxxxxxxxxx
```

- For `SOURCE_SHOP` / `TARGET_SHOP`, use just the `xxx.myshopify.com` domain — no `https://`
- The Client ID and Client Secret come from the Dev Dashboard (Step 7)

### Step 9: Run the Clone

```bash
# First, do a dry run to preview what will be cloned:
node bin/clone.js --dry-run

# If everything looks good, run the actual clone:
node bin/clone.js

# Use --verbose for detailed output:
node bin/clone.js --verbose
```

You'll see a progress log and a summary at the end.

---

## Usage Examples

```bash
# Clone everything (with confirmation prompt)
node bin/clone.js

# Dry run — preview without making changes (RECOMMENDED for first run)
node bin/clone.js --dry-run

# Clone only products and pages
node bin/clone.js --only products,pages

# Clone everything except the theme
node bin/clone.js --skip theme

# Verbose output with only collections
node bin/clone.js --only collections --verbose

# Skip the confirmation prompt (for scripted/automated use)
node bin/clone.js --yes

# Combine flags
node bin/clone.js --only products,collections --dry-run --verbose
```

**Available resource keys:**
`products`, `collections`, `pages`, `blogs`, `redirects`, `script_tags`, `theme`, `metafields`

---

## Resources Cloned

| Resource | Details |
|---|---|
| **Products** | Including variants, images, product metafields, and variant metafields |
| **Custom Collections** | Including product associations (via Collects) |
| **Smart Collections** | Including rules (auto-apply on target) |
| **Pages** | Static pages with HTML content |
| **Blogs & Articles** | Blog structure and all articles with images |
| **Redirects** | URL redirects |
| **Script Tags** | External script injections |
| **Theme** | The active/published theme with all assets (Liquid, CSS, JS, images, fonts). Created as **unpublished** on the target. |
| **Shop Metafields** | Shop-level custom metadata |

---

## How It Works

1. The tool authenticates with both stores using the **client credentials grant** (OAuth 2.0). Tokens are valid for ~24 hours and are automatically refreshed.
2. **Pre-flight checks** verify connectivity, detect existing data on the target, and ask for confirmation.
3. Resources are cloned **sequentially in dependency order** (e.g., products before collections, so product-collection associations work correctly).
4. API calls are limited to **2 concurrent requests** to stay within Shopify rate limits.
5. **Automatic retry with exponential backoff** handles 429 (rate limited) and 5xx (server error) responses.
6. The `Retry-After` header is respected when present.
7. Errors on individual items are logged but **don't stop** the overall process.
8. A summary table is printed at the end showing success/failure per resource.

---

## How Matrixify and Other Apps Do It

Matrixify (formerly Excelify), Rewind Staging, and similar tools use the same underlying approach:

1. **Export phase:** They read data from the source store using Shopify's Admin API (the same API this tool uses). Matrixify exports to Excel/CSV files; this tool reads directly via API.
2. **Import phase:** They write data to the target store using Shopify's Admin API. Matrixify imports from spreadsheet files; this tool creates resources directly via API.

The key similarities:
- All tools use the same Shopify API — there is no special "clone" API. It's always read from source, write to target.
- All tools require API access (scopes/permissions) to both stores.
- None of them modify the source store — they only read from it.

The key difference with this tool:
- **No ongoing subscription fee.** Matrixify charges $20-200/month. This tool is free.
- **You control the code.** You can audit exactly what it does, modify it, or extend it.
- **Matrixify can export to files** (useful as backups). This tool clones directly store-to-store.
- **Matrixify supports more data types** (navigation menus, metaobject entries, discount codes). This tool covers the most common resources.

---

## Legacy Auth (Admin-Created Custom Apps)

If you have **existing** custom apps created directly in the Shopify admin (before the Jan 2026 deprecation), you can still use their static access tokens.

In your `.env`:

```env
AUTH_METHOD=static

SOURCE_SHOP=my-store.myshopify.com
SOURCE_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

TARGET_SHOP=my-dev-store.myshopify.com
TARGET_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The static token comes from: **Store Admin > Settings > Apps and sales channels > Develop apps > Your App > API credentials > Admin API access token**.

> Note: You cannot create new legacy custom apps after January 1, 2026. Existing ones continue to work.

---

## Troubleshooting

### "Failed to get access token" (HTTP 400 or 401)

**Cause:** The client credentials are wrong or the app isn't properly installed.

**Fix:**
1. Double-check your `CLIENT_ID` and `CLIENT_SECRET` in `.env` — copy them fresh from Dev Dashboard > Settings
2. Make sure you've **released a version** of the app (Step 5)
3. Make sure the app is **installed** on the store (Step 6)
4. Confirm the `SOURCE_SHOP` / `TARGET_SHOP` domains are correct (e.g., `my-store.myshopify.com` — no `https://`)

### "403 Forbidden" on specific resources

**Cause:** The app doesn't have the required API scope for that resource.

**Fix:**
1. Go to Dev Dashboard > Your App > Configuration
2. Add the missing scope (check the table in Step 4)
3. **Release a new version** after changing scopes — scope changes don't take effect until you release
4. You may need to **reinstall** the app on the store after the new version is released

### "404 Not Found" on API calls

**Cause:** Usually means the shop domain is wrong or the API version is invalid.

**Fix:**
1. Verify the shop domain in `.env` is the `xxx.myshopify.com` format
2. Make sure the store exists and is accessible
3. Try running with `--verbose` to see the full URL being requested

### "429 Too Many Requests" (Rate Limiting)

**Cause:** You're hitting Shopify's API rate limit. This is normal for stores with lots of data.

**This is handled automatically** — the tool will wait and retry. If you see many of these:
- The tool has a 2-concurrent-request limit to be gentle on the API
- Large stores with thousands of products may take a while
- Consider using `--only` to clone resources in batches

### "Network error" / Connection failures

**Cause:** Internet connectivity issue or Shopify API is temporarily down.

**Fix:**
1. Check your internet connection
2. Try again in a few minutes
3. Run with `--verbose` to see which request is failing
4. Check [Shopify Status](https://www.shopifystatus.com/) for outages

### Theme assets fail to copy

**Cause:** Some theme assets (especially large images or generated files) may fail individually.

**Fix:**
- The tool logs failed assets but continues with the rest
- Check the verbose output for specific failures
- You can manually upload the failed assets through the Shopify admin > Online Store > Themes > Edit code

### Products created but collections are empty

**Cause:** Products must exist on the target before collections can be associated.

**Fix:**
- Make sure products are cloned first (they are, by default)
- If you used `--only collections`, run `--only products` first, then `--only collections`
- The tool matches products by **handle** — if handles don't match between source and target, the association won't work

### "Missing source/target store credentials"

**Cause:** Your `.env` file is missing or incomplete.

**Fix:**
1. Make sure you copied `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Make sure `.env` is in the same directory you're running the command from
3. Fill in all required fields for your chosen `AUTH_METHOD`

### Token expires during a long clone

**Cause:** Client credential tokens last ~24 hours. For very large stores, the clone could theoretically take longer.

**This is handled automatically** — the tool detects 401 responses and refreshes the token. If you still see issues, run the clone in parts using `--only`.

### How to verify the app is correctly installed

1. Go to your Shopify store admin
2. Navigate to **Settings > Apps and sales channels**
3. Your Dev Dashboard app should appear in the list
4. If it's not there, use the install link from the Dev Dashboard (Step 6)

### How to check what scopes are granted

Run this curl command to verify (replace the placeholders):

```bash
# Get a token first
curl -X POST "https://YOUR-STORE.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"

# Response includes "scope" field listing granted scopes
```

### Development store limitations

Development stores have some restrictions compared to live stores:
- Cannot process real payments
- May have limits on product count
- Some apps/features may not be available
- Password protection is always enabled

---

## Known Limitations

- **Orders and customers are not cloned** — these contain sensitive personal data and should not be copied between stores for privacy/compliance reasons
- **Navigation menus** are not available via the REST Admin API — recreate them manually in the target store's admin (Online Store > Navigation)
- **Installed apps** must be manually reinstalled and reconfigured on the target store
- **Inventory levels** are not set — product inventory will default to zero on the target
- **Product reviews** from third-party apps are not included
- **Theme is created as unpublished** — you must manually publish it in the target store admin (Online Store > Themes > the cloned theme > Publish)
- **Discount codes and price rules** are not cloned
- **Shopify Payments** and other payment provider settings must be configured separately
- **Shopify Flow** automations are not cloned
- **Metaobject entries** — while shop-level metafields are cloned, complex metaobject entries may require additional handling
- **Files/media** in the Shopify file manager (Settings > Files) are not cloned — only product images and theme assets
