# Setup Guide - Web Scraper Configuration Tool

## Quick Start (5 minutes)

### 1. Install Extension

```bash
# Option A: Load in Chrome directly
1. Open Chrome
2. Go to chrome://extensions/
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the /extension folder

# Option B: Package as .crx (optional)
1. Go to chrome://extensions/
2. Click "Pack extension"
3. Select the /extension folder
4. Share the .crx file
```

### 2. Test on a Simple Site

**Recommended test site**: https://books.toscrape.com/

#### Step-by-Step Test:

1. **Navigate** to https://books.toscrape.com/
2. **Click extension icon** in Chrome toolbar
3. **Step 1 (Setup)**:
   - Enter dataset name: "books_toscrape"
   - Click "Continue to Container Setup"

4. **Step 2 (Container)**:
   - Click "Pick Container Element"
   - Click on ONE book item (the article element)
   - Should highlight all 20 books
   - Click "Continue to Fields"

5. **Step 3 (Fields)**:
   - Click "Pick Field Element"
   - Click on book title → Name it "title"
   - Click "Pick Field Element"
   - Click on price → Name it "price"
   - Click "Pick Field Element"
   - Click on rating stars → Name it "rating"
   - Click "Preview Data" to verify
   - Click "Continue"

6. **Step 4 (Advanced)**:
   - Click "Pick Next Button"
   - Click the "next" button at bottom
   - Enter max pages: 3
   - Click "Continue to Export"

7. **Step 5 (Export)**:
   - Click "Test All Selectors"
   - Verify all pass
   - Click "Export Configuration"
   - Config copied to clipboard!

### 3. Use Configuration in Scrapy

```python
import json

# Paste exported config
config = json.loads("""
{
  "job_id": "...",
  "dataset_name": "books_toscrape",
  "start_url": "https://books.toscrape.com/",
  "crawl_type": "flat",
  "container_selector": "article.product_pod",
  "item_selectors": {
    "title": "h3 a",
    "price": ".price_color",
    "rating": ".star-rating"
  },
  "pagination": {
    "selector": ".next a",
    "max_pages": 3,
    "method": "selector"
  }
}
""")

# Run with UniversalSpider
from scrapy.crawler import CrawlerProcess
from crawler.spiders.spiders import UniversalSpider

process = CrawlerProcess()
process.crawl(UniversalSpider, config=json.dumps(config))
process.start()
```

## Advanced Testing

### Test Case 1: E-Commerce (Complex)

**Site**: https://www.ebay.com/sch/i.html?_nkw=laptop

**Configuration**:
- Container: `.s-item` (each product listing)
- Fields:
  - `title`: `.s-item__title`
  - `price`: `.s-item__price`
  - `condition`: `.SECONDARY_INFO`
  - `link`: `.s-item__link::attr(href)`

**Challenges**:
- Dynamic IDs (avoided automatically)
- Nested structure
- Variable content

### Test Case 2: News Site

**Site**: https://news.ycombinator.com/

**Configuration**:
- Container: `.athing` (each story)
- Fields:
  - `title`: `.titleline > a`
  - `points`: `.score`
  - `author`: `.hnuser`
  - `link`: `.titleline > a::attr(href)`

**Challenges**:
- Table-based layout
- Minimal classes
- Pagination via "More" link

### Test Case 3: Real Estate

**Site**: https://www.zillow.com/homes/for_sale/

**Configuration**:
- Container: `article[data-test="property-card"]`
- Fields:
  - `address`: `address`
  - `price`: `span[data-test="property-card-price"]`
  - `beds`: Data attribute selectors
  - `link`: Relative selector to link

**Challenges**:
- Heavy JavaScript rendering
- May need Playwright validation
- Data attributes throughout

## Troubleshooting

### Issue: "Please refresh the page first"

**Cause**: Content script not injected yet  
**Solution**: Refresh target page, reopen extension

### Issue: "Selector valid but found 0 matches"

**Cause**: Selector syntax correct but doesn't match elements  
**Solution**: 
1. Inspect the element manually
2. Try alternative selector from dropdown
3. Edit selector manually
4. Check if content is JavaScript-loaded

### Issue: Container not detected

**Cause**: Elements not similar enough structurally  
**Solution**:
1. Pick an element further up the DOM tree
2. Ensure items have consistent structure
3. Check if items share common parent

### Issue: Selectors work in extension but fail in Scrapy

**Cause**: Content is JavaScript-rendered  
**Solution**:
1. Use Playwright validation endpoint
2. Or use Scrapy with Playwright middleware:
   ```python
   # settings.py
   DOWNLOAD_HANDLERS = {
       "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
       "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
   }
   ```

### Issue: Pagination not working

**Cause**: "Next" link selector incorrect  
**Solution**:
1. Inspect "Next" button manually
2. Use data attributes if available
3. Try XPath: `//a[contains(text(), 'Next')]`
4. Set max_pages to prevent infinite loops

### Issue: Data preview shows null values

**Cause**: Selectors not finding elements  
**Solution**:
1. Test each selector individually
2. Check if container selector is too specific
3. Verify elements are in DOM (not JavaScript-loaded)

## Development Setup

### For Extension Development

```bash
# 1. Clone/download extension files
cd /path/to/extension

# 2. Make changes to files
# Edit content.js, popup.js, etc.

# 3. Reload in Chrome
# Go to chrome://extensions/
# Click reload icon on your extension

# 4. Test changes
# Open a website and test picker functionality
```

### For Backend Integration

```bash
# 1. Ensure backend is running
cd /path/to/backend
python -m uvicorn main:app --reload --port 8000

# 2. Test validation endpoint (optional, not required for v2.0)
curl -X POST http://localhost:8000/api/config/validate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "selector": ".title"}'

# 3. Test crawl submission
curl -X POST http://localhost:8000/api/crawl \
  -H "Content-Type: application/json" \
  -d @exported_config.json
```

### File Structure

```
extension/
├── manifest.json          # Chrome extension config
├── background.js          # Message routing
├── content.js            # DOM interaction & selector generation
├── popup.html            # UI markup
├── popup.js              # UI logic & wizard controller
├── config-manager.js     # Config state management
├── styles.css            # Highlight styles
├── README.md             # Full documentation
├── CHANGELOG.md          # Version history
└── SETUP.md             # This file

Optional:
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
```

## Testing Checklist

- [ ] Extension loads without errors
- [ ] Can pick container on list page
- [ ] Container highlights all similar items
- [ ] Can pick field elements
- [ ] Selectors show match counts
- [ ] Can edit selectors inline
- [ ] Match counts update when editing
- [ ] Data preview shows correct data
- [ ] Pagination selector works
- [ ] Link selector (list-detail) works
- [ ] Test all selectors passes
- [ ] Export copies to clipboard
- [ ] Exported config is valid JSON
- [ ] Config works with UniversalSpider
- [ ] No console errors

## Next Steps

1. ✅ Complete setup
2. ✅ Test on simple site (books.toscrape.com)
3. ✅ Test on real target site
4. ✅ Export configuration
5. ✅ Test with Scrapy spider
6. ✅ Iterate on selectors if needed
7. ✅ Configure pagination/list-detail
8. ✅ Final export and deploy

## Support

### Common Questions

**Q: Can I use XPath selectors?**  
A: Yes! XPath is offered as an alternative. Scrapy supports both CSS and XPath.

**Q: What if my site requires login?**  
A: Configure scraping on logged-in page. Scrapy will need login middleware.

**Q: Can I scrape multiple pages at once?**  
A: Use pagination feature for sequential pages. For parallel, export multiple configs.

**Q: What about dynamic content (AJAX)?**  
A: May need Playwright. Test using backend validation endpoint first.

**Q: Can I save configurations?**  
A: Extension auto-saves to chrome.storage. Export to save externally.

**Q: Does this work with Selenium/Playwright?**  
A: Selectors work with any tool. Generated for Scrapy but universal.

### Resources

- **Scrapy Docs**: https://docs.scrapy.org/
- **CSS Selectors**: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors
- **XPath Tutorial**: https://www.w3schools.com/xml/xpath_intro.asp
- **Chrome Extensions**: https://developer.chrome.com/docs/extensions/

---

**Ready to scrape!** 🚀

If you encounter issues not covered here, check the README.md for detailed documentation or CHANGELOG.md for known issues.
