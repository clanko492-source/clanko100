# Put CLANKO100 online for free

You need two things: **hosting** (free, below) and, if you want `clanko100.com`, a **domain** (this part costs money every year). The site works perfectly on a free address like `clanko100.pages.dev` while you decide.

## 1. Free hosting

Pick one. Cloudflare Pages is the quickest because you can upload the whole folder in one go.

### Option A: Cloudflare Pages (recommended)

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Go to **Workers & Pages**, select **Create application**, then **Get started** next to **Drag and drop your files**.
3. Enter `clanko100` as the project name.
4. Drag in the **unzipped website folder** (or the zip itself) and select **Deploy site** (some versions of the dashboard call it **Save and Deploy**).
5. Your site is live at `https://clanko100.pages.dev`. If someone already has that name, Cloudflare adds a few random letters, so check the address it shows you.

To update the site later, open the project and select **Create new deployment**, then upload the folder again. Drag-and-drop projects can't be switched to GitHub auto-deploys later; if you want those, make a new project with **Connect to Git** and use these settings: framework preset **None**, build command **empty**, build output directory **/**.

### Option B: GitHub Pages

1. Make a free account at [github.com](https://github.com/signup).
2. Create a new **public** repository. Name it `YOUR-USERNAME.github.io` (with your real username) so the site lives at `https://YOUR-USERNAME.github.io/`.
3. On the repository page, select **Add file > Upload files** and drag in everything from the website folder. The website uploader takes up to 100 files at a time, so upload in two goes: first everything except the `embed` folder, then the `embed` folder.
4. Go to **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick **main** and **/ (root)**, then **Save**.
5. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/`.

If you'd rather name the repository `clanko100`, the address becomes `https://YOUR-USERNAME.github.io/clanko100/`. Everything still works, except you should set `"basePath": "/clanko100/"` in `tools/site.config.json` and rebuild (see step 3 below) so the 404 page finds its styles.

## 2. The clanko100.com domain

**Is it free to register?** A `.com` domain is never free. You pay a registrar every year (usually around 10 to 15 US dollars). You'll need a payment card, so you may need a parent or guardian to buy it.

**Is it available?** On 15 October 2026 the official `.com` registry had no record of `clanko100.com`, which normally means nobody owns it. That can change at any moment, so check it yourself before paying:

- Registration status: [lookup.icann.org](https://lookup.icann.org/en/lookup?name=clanko100.com)
- Buy it from any registrar, for example [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (sells at cost and makes Option A's setup automatic), [Porkbun](https://porkbun.com) or [Namecheap](https://www.namecheap.com).

Until you buy it, use your free `pages.dev` or `github.io` address. Nothing on the site needs the domain to work.

### Connect clanko100.com to Cloudflare Pages

Always add the domain in Cloudflare first, then set up DNS. Adding the DNS record first can make the domain show an error page.

1. If you bought the domain from Cloudflare, it's already set up. If you bought it somewhere else, add it to Cloudflare (**Add a domain** in the dashboard, free plan) and change the domain's nameservers at your registrar to the two Cloudflare shows you. This is required for the main `clanko100.com` address.
2. Open your Pages project, go to **Custom domains**, select **Set up a domain**, type `clanko100.com` and select **Continue**. Cloudflare creates the DNS record for you.
3. Repeat for `www.clanko100.com` if you want that address to work too.
4. HTTPS turns on automatically within a few minutes.

### Connect clanko100.com to GitHub Pages

1. In the repository, go to **Settings > Pages**, type `clanko100.com` under **Custom domain**, and select **Save**. (GitHub recommends verifying the domain in your account's **Pages** settings first, which stops anyone else using it.)
2. At your registrar's DNS settings, delete any default "parking" records, then add:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | CNAME | www | YOUR-USERNAME.github.io |

   Optional IPv6 records: four **AAAA** records for `@` with `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153` and `2606:50c0:8003::153`. Don't add wildcard (`*`) records.
3. DNS changes can take up to 24 hours. When the domain works, tick **Enforce HTTPS** in **Settings > Pages**.

## 3. Tell the site its address

The page links work anywhere, but search engines and share previews use the full address written into each page. It's set to `https://clanko100.com`. If you launch on a different address first, change it so Google doesn't get pointed at a domain that isn't live yet:

1. Open `tools/site.config.json` and change `siteUrl`, for example to `https://clanko100.pages.dev`.
2. Install [Node.js](https://nodejs.org) if you haven't, then run `node tools/build.mjs` in the website folder.
3. Upload the folder again.

Switch it back to `https://clanko100.com` (and rebuild) once the domain is connected.

## 4. After launch

- **Reports and messages**: open `assets/js/config.js` and add a free [Formspree](https://formspree.io) form ID so "Report a problem" and the contact form reach your inbox.
- **Get found on Google**: add your site in [Google Search Console](https://search.google.com/search-console), then submit `https://YOUR-ADDRESS/sitemap.xml` under **Sitemaps**. [Bing Webmaster Tools](https://www.bing.com/webmasters) can import it from Google in one click.
- **Check it on a phone**: open a few games, try Fullscreen, and save a favourite.
