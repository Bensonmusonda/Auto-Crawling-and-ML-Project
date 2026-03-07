# Web Scraper Configuration Tool

A Chrome extension designed to simplify the configuration of automated web scrapers. It provides a visual, point-and-click interface for users to select exactly which data points they want to extract from a web page.

## Features

- **Visual Element Selection**: Click any element on a page to automatically generate its CSS/XPath selector.
- **Configuration Dashboard**: Manage and preview your scraping targets before sending them to the backend.
- **Live Validation**: Connects to the platform's backend to verify if a selected element is reachable and extractable.
- **Direct Integration**: Submit configurations directly to the Data Acquisition Platform with a single click.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the `extension` directory of this project.

## Usage

1. Click the extension icon in your toolbar while on a target website.
2. Use the "Inspector" tool to highlight and select data elements.
3. Assign labels to your selections (e.g., "Price", "Product Name").
4. Click "Sync to Backend" to save your configuration for future crawls.

## Technical Details

- **Manifest V3**: Compliant with the latest Chrome extension standards.
- **Content Scripts**: Injects logic for highlighting and capturing element metadata.
- **Background Service Worker**: Manages state and communication with the platform API.
