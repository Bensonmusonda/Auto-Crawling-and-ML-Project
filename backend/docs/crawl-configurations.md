---
title: Crawl Configurations Guide
slug: crawl-configurations
category: Technical
description: Detailed breakdown of the crawl settings, routing, and configurations available in the Universal Spider.
---

# Crawl Configurations Guide

This document dives deep into the technical configurations available within the scraping pipeline. It explains how the visual rules you generate in the **Web Scraper Configuration Extension** map to the logic defined in `spiders.py`, empowering our **Universal Spider**.

---

## 1. Crawl Types (Target Archetypes)

The Universal Spider (`spiders.py`) is designed to handle the two most common architectures found on the web via the `crawl_type` parameter.

### Flat Crawl (`crawl_type="flat"`)
Used when all the target data is present on a single repeating page. 

**Example:** A search results page that lists products with their titles, prices, and ratings all visible without needing to click into them.
**How it works:**
1. The spider navigates to the `start_url`.
2. It looks for the **Container Selector** (e.g., `.product-card`), which defines the boundary of an individual item.
3. For each container found, it applies the **Item Selectors** (e.g., `.title`, `.price`) to extract the fields.
4. It packages the item and moves to the next container.

### List-Detail Crawl (`crawl_type="list-detail"`)
Used when the list page only contains summary information, and the spider must navigate to the specific details page to get the full data.

**Example:** A job board where the list shows the job title, but the salary and full description are only available by clicking the job link.
**How it works:**
1. The spider navigates to the `start_url`.
2. It uses the **Link Selector** to find all the detail page URLs.
3. It `yields` a follow request for each link.
4. Once on the detail page, it applies the **Item Selectors** to extract the data.

---

## 2. Setting Selectors Visually

The **Chrome Extension** is the primary way you build these configurations without touching code. When you point and click, the extension determines the best selector.

The backend spider dynamically handles the syntax you provide:
- **CSS Selectors:** If you provide standard classes or IDs (e.g. `.price-label`), the spider uses `response.css()`. It also auto-appends `::text` if not specified.
- **XPath Selectors:** If you provide deep structured paths (e.g. `//div[@class='main']/span[1]`), the spider detects the leading `/` and uses `response.xpath()`. It will auto-append `/text()` if not present.

*Note: The extension handles generating these efficiently, but you can manually tweak the synced output JSON if you need highly advanced logical XPath queries.*

---

## 3. Pagination Methods

A single page rarely has enough data for Machine Learning. The spider supports two pagination methods to continuously fetch data until `max_pages` is hit.

| Method | How it works | When to use it |
|--------|--------------|----------------|
| **Numeric** | Modifies the URL parameters by incrementing a page counter (e.g., `?page=1` -> `?page=2`) | On sites where the URL structure is predictable and relies on standard query parameters. |
| **Selector** | Follows the `href` attribute of a specific "Next Page" button identified by a CSS/XPath selector. | On sites with obfuscated URLs or JavaScript-injected links where predicting the next URL structure is impossible. |

---

## 4. Advanced Routing Strategy

Behind the scenes in `spiders.py`, the Universal Spider doesn't just treat every URL the same. Complex modern websites actively block bots or use heavy JavaScript frameworks (React/Vue) that a standard HTTP request cannot read.

To counter this, the `start_requests()` method implements a smart routing fallback based on the domain being scraped:

### A. The Playwright Route (`using_playwright=True`)
* **When it activates:** Triggered when the domain is listed in the `playwright_sites` config in the database.
* **What it does:** Boots up a fully headless Chromium browser. It waits specifically for your `container_selector` to render on the page before evaluating the DOM. 
* **Strengths:** Defeats Single Page Applications (SPAs) and sites that heavily rely on client-side rendering.

### B. The Hybrid Route (`using_hybrid=True`)
* **When it activates:** Triggered for sites in the `hybrid_sites` list.
* **What it does:** Sends the request through the **ScraperAPI** proxy network (to rotate IP addresses), but also passes a `wait_for_selector` instruction to ScraperAPI's headless browsers.
* **Strengths:** Essential for highly aggressive sites that use *both* IP blocking and JavaScript rendering.

### C. The ScraperAPI Route (`using_scraperapi=True`)
* **When it activates:** Triggered for sites in the `tough_sites` list (e.g., `amazon.com`, `walmart.com`).
* **What it does:** Routes the standard HTTP request through ScraperAPI to utilize residential IPs, circumventing IP bans or basic CAPTCHAs.
* **Strengths:** High reliability for standard e-commerce crawling.

### D. The Standard Scrapy Route
* **When it activates:** All other websites.
* **What it does:** Fast, raw HTTP `GET` requests managed entirely by Scrapy's core engine.
* **Strengths:** Maximum speed and minimum resource cost. Perfect for wikis, blogs, and older server-rendered sites.

---

## Summary

The power of this scraping module lies in the separation of concerns. The **Chrome Extension** abstracts away the complexity of building robust selectors and dictating the *shape* of the data. The **Universal Spider** (`spiders.py`) abstracts away the complexity of handling the chaotic web (JavaScript rendering, pagination, IP rotation), allowing everything to execute seamlessly from a single unified configuration.
