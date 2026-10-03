import { chromium, type Browser, type Page } from 'playwright';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { isPrivateHost } from './netGuard.js';
import type { ScrapeResult } from '../../shared/types.js';

interface ScrapeOptions {
  url: string;
  depth: number;
  maxPages?: number;
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Remove unnecessary elements before converting to markdown
function cleanHtml(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts, styles, nav, footer, ads, etc.
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();
  $('.ad, .advertisement, .social-share, .cookie-banner, [class*="cookie"]').remove();
  $('[class*="sidebar"], [class*="popup"], [class*="modal"]').remove();

  return $.html();
}

// Extract links from page for deeper crawling
function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const visited = new Set<string>();

  $('a[href]').each((_, element) => {
    try {
      const href = $(element).attr('href');
      if (!href) return;

      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl).href;

      // Only include same-domain links
      const baseHost = new URL(baseUrl).hostname;
      const linkHost = new URL(absoluteUrl).hostname;

      if (linkHost === baseHost && !visited.has(absoluteUrl)) {
        visited.add(absoluteUrl);
        links.push(absoluteUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return links;
}

async function scrapePage(
  page: Page,
  url: string
): Promise<{ title: string; html: string; links: string[] }> {
  // SSRF guard: check the target (incl. DNS resolution) before navigating…
  if (await isPrivateHost(new URL(url).hostname)) {
    throw new Error(`Refusing to scrape private/internal host: ${url}`);
  }

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // …and the final URL after redirects (DNS-resolved, so a public page can't
  // bounce us into the internal network via a hostname whose A record is RFC1918).
  if (await isPrivateHost(new URL(page.url()).hostname)) {
    throw new Error(`Redirect to private/internal host blocked: ${page.url()}`);
  }

  const title = await page.title();
  const html = await page.content();
  const links = extractLinks(html, url);

  return { title, html, links };
}

export async function scrapeUrl(options: ScrapeOptions): Promise<ScrapeResult> {
  const { url, depth, maxPages = 50 } = options;

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // SSRF guard on EVERY request the page makes — redirect hops, subresources,
    // iframes and fetch() from page scripts, not just the top-level navigation.
    // Verdicts are cached per host to keep page loads fast; a non-http(s) scheme
    // (file:, ftp:, …) is refused outright. data:/blob:/about: carry no network.
    const hostVerdicts = new Map<string, Promise<boolean>>();
    await page.route('**/*', async route => {
      const reqUrl = route.request().url();
      let parsed: URL;
      try {
        parsed = new URL(reqUrl);
      } catch {
        return route.abort('blockedbyclient');
      }
      if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return route.continue();
      if (!['http:', 'https:'].includes(parsed.protocol)) return route.abort('blockedbyclient');
      let verdict = hostVerdicts.get(parsed.hostname);
      if (!verdict) {
        verdict = isPrivateHost(parsed.hostname);
        hostVerdicts.set(parsed.hostname, verdict);
      }
      if (await verdict) {
        console.warn(`[Scraper] Blocked request to private host: ${reqUrl}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    const visited = new Set<string>();
    const toVisit: Array<{ url: string; level: number }> = [{ url, level: 0 }];
    let allContent = '';
    let mainTitle = '';
    const allLinks: string[] = [];

    // DoS protection: Maximum scraping time of 2 minutes
    const startTime = Date.now();
    const MAX_SCRAPE_TIME_MS = 120000;

    while (toVisit.length > 0 && visited.size < maxPages) {
      // Check if we've exceeded the maximum scraping time
      if (Date.now() - startTime > MAX_SCRAPE_TIME_MS) {
        console.warn('[Scraper] Scraping timeout exceeded, stopping');
        break;
      }

      const current = toVisit.shift();
      if (!current || visited.has(current.url)) continue;

      // Stop if we've exceeded depth
      if (current.level >= depth) continue;

      visited.add(current.url);

      try {
        console.log(`Scraping [${current.level}/${depth}]: ${current.url}`);
        const { title, html, links } = await scrapePage(page, current.url);

        if (current.level === 0) {
          mainTitle = title;
        }

        // Clean and convert to markdown
        const cleanedHtml = cleanHtml(html);
        const markdown = turndownService.turndown(cleanedHtml);

        // Add page separator
        allContent += `\n\n---\n# ${title}\n**URL:** ${current.url}\n\n${markdown}\n`;

        // Add links for next level
        if (current.level + 1 < depth) {
          links.forEach(link => {
            if (!visited.has(link) && allLinks.length < maxPages) {
              toVisit.push({ url: link, level: current.level + 1 });
              allLinks.push(link);
            }
          });
        }
      } catch (error) {
        console.error(`Failed to scrape ${current.url}:`, error);
        allContent += `\n\n---\n# Error scraping ${current.url}\n**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n`;
      }
    }

    await browser.close();

    return {
      url,
      title: mainTitle,
      markdown: allContent.trim(),
      metadata: {
        depth,
        pagesScraped: visited.size,
        timestamp: new Date().toISOString(),
        links: Array.from(visited),
      },
    };
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}
