# Web Scraper Configuration Tool - Chrome Extension

A professional point-and-click configuration tool for creating Scrapy spider configurations without writing code.

## 🎯 Key Features

### ✅ Fixed Issues from Previous Version

1. **Container-Relative Selectors**: Generated selectors now match Scrapy's execution context
   - Selectors for fields are relative to containers, not the page root
   - This matches how `UniversalSpider` applies selectors: `container.css(selector)`

2. **Aggressive ID Avoidance**: IDs are NEVER used in selector generation
   - Modern SPAs use dynamic IDs (React, Vue, Angular)
   - Selectors rely on stable classes, data attributes, and semantic HTML

3. **Client-Side Validation**: Instant feedback on selector quality
   - Real-time match counting as you edit selectors
   - No need to call backend for validation during configuration
   - Backend validation still available for final testing

4. **Professional Monochrome UI**: Clean, tech-focused design
   - No emojis in production UI
   - Grayscale + semantic state colors (green=success, red=error, blue=info, yellow=warning)
   - Wizard-style workflow guides users through configuration

### 🚀 New Features

- **Wizard Workflow**: 5-step process with clear navigation
- **Editable Selectors**: Tech-savvy users can modify auto-generated selectors
- **Live Data Preview**: See extracted data before exporting configuration
- **Pattern Detection**: Automatically identifies repeating elements
- **Multiple Selector Strategies**: Offers 6+ selector types per element
- **Hover Tooltips**: See element info while hovering during picking

## 📋 Wizard Steps

### Step 1: Setup
- Configure dataset name
- View current page URL and basic stats

### Step 2: Container Selection (Optional)
- For list/repeating items (product cards, articles, etc.)
- Highlights all matching containers on selection
- Skip if scraping single-page data

### Step 3: Field Mapping (Core)
- Pick elements and assign field names
- Choose from multiple selector strategies
- Edit selectors inline with live validation
- Preview extracted data from all containers

### Step 4: Advanced Options
- **Pagination**: Configure "Next" button for multi-page crawling
- **List-Detail Mode**: Enable clicking into detail pages

### Step 5: Export
- Review configuration summary
- Test all selectors
- Export JSON config for Scrapy

## 🔧 Technical Architecture

### Selector Generation Strategy

#### For Container-Relative Fields:
```javascript
// Generated selectors work INSIDE each container
// Example: ".product-title" instead of "#main > div.product > h2.title"

// Scrapy execution:
for container in response.css(container_selector):
    title = container.css(".product-title").get()  // ✅ Works!
```

#### Selector Priority (No IDs Ever):
1. Data attributes (`[data-testid="..."]`)
2. Stable class combinations (`.product.card`)
3. Semantic attributes (`[role="article"]`)
4. Tag + class paths (`div.card > h3.title`)
5. Robust descendant paths (avoiding nth-child where possible)
6. XPath (as alternative)

### Client-Side Validation

```javascript
// Test selector immediately in browser context
chrome.tabs.sendMessage(tab.id, {
  action: 'testSelector',
  selector: '.product-title',
  containerSelector: '.product-card'
}, (result) => {
  console.log(`Found ${result.count} matches`);
  console.log('Sample data:', result.matches);
});
```

### Files Structure

```
extension/
├── manifest.json           # Chrome extension manifest
├── background.js           # Service worker for message routing
├── content.js              # Injected script for DOM interaction
├── popup.html              # Extension popup UI
├── popup.js                # Popup logic and wizard controller
├── config-manager.js       # Configuration state management
└── styles.css              # Highlight styles for selected elements
```

## 📖 Usage Guide

### Basic Workflow: Scraping Product Listings

1. **Navigate** to target website (e.g., e-commerce product listing)
2. **Open extension** and enter dataset name
3. **Step 2**: Click "Pick Container Element"
   - Click on ONE product card
   - Extension highlights ALL similar cards
   - Confirms container detected

4. **Step 3**: Add fields:
   - Click "Pick Field Element"
   - Click on product title → Select selector → Name it "title"
   - Repeat for price, description, etc.
   - Click "Preview Data" to verify extraction

5. **Step 4** (Optional):
   - Pick "Next" button for pagination
   - Set max pages (e.g., 5)

6. **Step 5**: Export configuration
   - Test all selectors
   - Copy JSON to clipboard
   - Use with your Scrapy spider

### Advanced: List-Detail Crawling

For sites where you need to:
1. Scrape listing page (get product links)
2. Visit each product detail page
3. Extract detailed info from detail pages

**Configuration:**
- Step 2: Pick container (product card)
- Step 3: Add basic fields from listing (name, price)
- Step 4: Enable List-Detail mode
  - Pick the product link element
  - Add fields you want from detail pages

**Result**: Spider will:
1. Extract basic fields from listing
2. Follow links to detail pages
3. Extract detailed fields from each page

## 🧪 Testing

### Test Individual Selector
Click "Test" button next to any field in the list.

### Test All Selectors
In Step 5, click "Test All Selectors" for batch validation.

### Preview Data
In Step 3, click "Preview Data" to see extraction results from first 3 containers.

## 🔌 Integration with Backend

### Configuration Export Format

```json
{
  "job_id": "uuid-here",
  "dataset_name": "my_products",
  "start_url": "https://example.com/products",
  "crawl_type": "flat",
  "container_selector": ".product-card",
  "item_selectors": {
    "title": ".product-title",
    "price": ".price",
    "description": ".description"
  },
  "pagination": {
    "selector": "a.next-page",
    "max_pages": 5,
    "method": "selector"
  },
  "link_selector": null
}
```

### Using with UniversalSpider

```python
# Your spider will receive this config
config = {
    "container_selector": ".product-card",
    "item_selectors": {
        "title": ".product-title",
        "price": ".price"
    }
}

# Spider execution:
for container in response.css(config['container_selector']):
    item = {}
    for field, selector in config['item_selectors'].items():
        item[field] = container.css(selector).get()
    yield item
```

## 🎨 Design Philosophy

### For Tech-Savvy Users
- Assumes basic HTML/CSS knowledge
- Allows manual selector editing
- Shows technical details (match counts, selector syntax)
- Provides multiple selector strategies to choose from

### Professional Aesthetic
- Monochrome base (grays)
- State colors for feedback:
  - Green: Success, valid selectors
  - Red: Errors, invalid selectors
  - Blue: Info, neutral status
  - Yellow: Warnings, edge cases
- No emojis in UI (professional context)
- Clean typography, generous spacing

## 🚨 Common Issues & Solutions

### "Selector valid but found 0 matches"
- **Cause**: Selector syntax is correct but doesn't match any elements
- **Solution**: Try alternative selector from dropdown or edit manually

### "Selected element is outside the container"
- **Cause**: You picked a container, but then selected an element not inside it
- **Solution**: Either clear container or pick elements within the container

### "Please refresh the page first"
- **Cause**: Content script not injected yet
- **Solution**: Refresh the target page and reopen extension

### Dynamic Content Not Detected
- **Cause**: Page uses JavaScript to load content after initial load
- **Solution**: Wait for content to load, then use the extension

### Selectors Work in Extension But Fail in Scrapy
- **Cause**: Selector relies on browser-rendered content or JavaScript
- **Solution**: Use backend validation with Playwright for JavaScript-heavy sites

## 🔬 Technical Notes

### Why No IDs?

```javascript
// BAD - Dynamic ID (will break)
#react-product-12345

// GOOD - Stable class
.product-card

// BEST - Data attribute
[data-testid="product-card"]
```

Modern web frameworks (React, Vue, Angular) generate dynamic IDs that change:
- On each page load
- Between deployments
- Based on component rendering order

### Container-Relative vs Absolute Selectors

```javascript
// ABSOLUTE (from page root) - Used for containers
"#main > div.products > div.product-card"

// RELATIVE (from container) - Used for fields
".product-title"  // Applied as: container.css(".product-title")
```

This matches Scrapy's execution model where selectors are applied to Selector objects, not the entire document.

### Selector Stability Hierarchy

1. **Data attributes** (best): Explicitly added for testing/automation
2. **Semantic HTML + ARIA**: `<article role="article">`
3. **Stable classes**: `.product`, `.title` (NOT `.css-12xyz`)
4. **Tag + class combos**: `h3.product-title`
5. **Structural paths**: `div.card > h3` (use sparingly)

## 📝 Development Notes

### File Changes from Previous Version

**Major Refactor:**
- `content.js`: Complete rewrite with relative selector generation
- `popup.html`: New wizard UI with monochrome theme
- `popup.js`: New wizard controller with client-side validation
- `styles.css`: Updated highlight colors

**Unchanged:**
- `config-manager.js`: Backend schema still compatible
- `manifest.json`: Minor updates (name, version)
- `background.js`: Minor updates for new message types

### Future Enhancements

- [ ] Regex-based field extraction (e.g., extract price from "$19.99")
- [ ] Selector templates for common site patterns
- [ ] Multi-attribute extraction (href + text from same element)
- [ ] Export to YAML format
- [ ] Import existing configurations
- [ ] Selector performance scoring
- [ ] Screenshot captures of selected elements

## 🤝 Contributing

When extending this tool:

1. **Maintain selector stability**: Never reintroduce ID-based selectors
2. **Test with real sites**: Amazon, eBay, news sites with varied HTML
3. **Keep UI professional**: Monochrome base, semantic state colors
4. **Document selector strategies**: Explain WHY a selector is generated

## 📄 License

[Your License Here]

## 🙏 Acknowledgments

Built for tech-savvy users who understand HTML/CSS but want to avoid manual selector writing for every scraping project.

---

**Version**: 2.0  
**Last Updated**: February 2026  
**Maintainer**: [Your Name]
