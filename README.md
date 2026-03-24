# shopify-clone

A Node.js CLI tool that clones data from a production Shopify store to a development store using the Shopify Admin REST API (2024-10).

## What It Does

`shopify-clone` reads resources from a source Shopify store and recreates them on a target store. This is useful for setting up development or staging environments with real production data.

### Resources Cloned

| Resource | Details |
|---|---|
| **Products** | Including variants, images, product metafields, and variant metafields |
| **Custom Collections** | Including product associations (via Collects) |
| **Smart Collections** | Including rules (auto-apply on target) |
| **Pages** | Static pages with HTML content |
| **Blogs & Articles** | Blog structure and all articles with images |
| **Redirects** | URL redirects |
| **Script Tags** | External script injections |
| **Theme** | The active/published theme with all assets (Liquid, CSS, JS, images, fonts) |
| **Shop Metafields** | Shop-level custom metadata |

## Prerequisites

- **Node.js 18+** (uses native `fetch`)
- **Shopify Partner account** or admin access to both stores
- **Custom apps** created on both the source and target stores

## Setup

### 1. Create Custom Apps

You need a custom app on each store to get API access tokens.

**On the source (production) store:**

1. Go to **Settings > Apps and sales channels > Develop apps**
2. Click **Create an app** and give it a name (e.g., "Store Clone - Source")
3. Click **Configure Admin API scopes** and enable these **read** scopes:
   - `read_products`
   - `read_content`
   - `read_themes`
   - `read_script_tags`
   - `read_metaobjects`
4. Click **Save** then **Install app**
5. Copy the **Admin API access token** (starts with `shpat_`)

**On the target (development) store:**

1. Repeat the same steps but enable these **write** scopes:
   - `write_products`
   - `write_content`
   - `write_themes`
   - `write_script_tags`
   - `write_metaobjects`
2. Copy the access token

### 2. Install the Tool

```bash
cd shopify-clone
npm install
```

### 3. Configure Credentials

```bash
cp .env.example .env
```

Edit `.env` with your store domains and access tokens:

```env
SOURCE_SHOP=my-store.myshopify.com
SOURCE_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TARGET_SHOP=my-dev-store.myshopify.com
TARGET_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Usage

### Clone everything

```bash
node bin/clone.js
```

### Clone specific resources only

```bash
node bin/clone.js --only products,pages
```

### Skip specific resources

```bash
node bin/clone.js --skip theme,redirects
```

### Dry run (preview without making changes)

```bash
node bin/clone.js --dry-run
```

### Verbose output

```bash
node bin/clone.js --verbose
```

### Combine options

```bash
node bin/clone.js --only products,collections --dry-run --verbose
```

### Available resource keys

`products`, `collections`, `pages`, `blogs`, `redirects`, `script_tags`, `theme`, `metafields`

## How It Works

1. Resources are cloned sequentially in dependency order (e.g., products before collections)
2. API calls are limited to 2 concurrent requests to stay within Shopify rate limits
3. Automatic retry with exponential backoff handles 429 (rate limited) responses
4. The `Retry-After` header is respected when present
5. Errors on individual items are logged but don't stop the overall process
6. A summary table is printed at the end showing success/failure per resource

## Known Limitations

- **Orders and customers are not cloned** — these contain sensitive personal data and should not be copied between stores
- **Navigation menus** are not available via the REST Admin API — recreate them manually in the target store
- **Installed apps** must be manually reinstalled on the target store
- **Inventory levels** are not set — product inventory will default to zero on the target
- **Product reviews** from third-party apps are not included
- **Theme is created as unpublished** — you must manually publish it in the target store admin
- **Discount codes and price rules** are not cloned
- **Shopify Payments** and other payment provider settings must be configured separately
