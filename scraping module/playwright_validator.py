# playwright_validator.py
# Add this to your tasks.py or create as a separate module

from celery import Task
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
import json


def validate_selector_with_playwright(url: str, selector: str) -> dict:
    """
    Validate a CSS selector using Playwright (real browser).
    This bypasses most bot detection including Amazon's WAF.
    
    Args:
        url: Target URL to validate against
        selector: CSS selector to test
    
    Returns:
        dict with validation results
    """
    with sync_playwright() as p:
        # Launch browser (headless for production, headless=False for debugging)
        browser = p.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',  # Hide automation
                '--disable-dev-shm-usage',  # Docker compatibility
                '--no-sandbox',  # Docker compatibility
            ]
        )
        
        # Create context with realistic settings
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='en-US',
            timezone_id='America/New_York',
        )
        
        # Override navigator.webdriver to hide automation
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
        
        page = context.new_page()
        
        try:
            # Navigate to page
            print(f"Navigating to {url}")
            response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # Wait for page to be ready
            # Note: Amazon and similar sites may never reach "networkidle" due to constant background requests
            # So we try but don't fail if it times out
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except PlaywrightTimeout:
                # If networkidle times out, that's okay - just wait a bit and continue
                print("Network idle timeout - continuing anyway (normal for heavy sites like Amazon)")
                pass
            
            # Additional wait for dynamic content (especially important for Amazon)
            page.wait_for_timeout(3000)
            
            # Check if we got blocked
            page_title = page.title()
            page_content = page.content()
            
            # Detect bot challenges
            is_blocked = _detect_blocking(page_content, page_title)
            
            if is_blocked:
                return {
                    "count": 0,
                    "valid": False,
                    "blocked": True,
                    "blocking_type": is_blocked,
                    "debug_info": {
                        "title": page_title,
                        "url": page.url,
                        "status": response.status if response else None,
                        "html_snippet": page_content[:2000],
                    }
                }
            
            # Test the selector
            try:
                # Wait for selector to appear (with timeout)
                try:
                    page.wait_for_selector(selector, timeout=5000)
                except PlaywrightTimeout:
                    pass  # Selector might not exist, continue anyway
                
                # Query all matching elements
                elements = page.query_selector_all(selector)
                
                # Extract text from matches
                matches_preview = []
                for i, element in enumerate(elements[:5]):  # Limit to first 5
                    try:
                        text = element.inner_text()[:100]
                        matches_preview.append(text)
                    except:
                        matches_preview.append("[Could not extract text]")
                
                # Take a screenshot for debugging (optional)
                # screenshot = page.screenshot(full_page=False)
                
                result = {
                    "count": len(elements),
                    "all_matches_preview": matches_preview,
                    "valid": True,
                    "selector_found": len(elements) > 0,
                    "blocked": False,
                    "debug_info": {
                        "title": page_title,
                        "url": page.url,
                        "status": response.status if response else None,
                        "html_snippet": page_content[:2000],
                    }
                }
                
                # Add suggestions if no matches found
                if len(elements) == 0:
                    result["debug_info"]["suggestions"] = _find_similar_selectors_playwright(page, selector)
                
                return result
                
            except Exception as e:
                return {
                    "count": 0,
                    "valid": False,
                    "error": f"Selector error: {str(e)}",
                    "selector_found": False,
                    "blocked": False,
                    "debug_info": {
                        "title": page_title,
                        "url": page.url,
                        "html_snippet": page_content[:2000],
                    }
                }
        
        except Exception as e:
            return {
                "count": 0,
                "valid": False,
                "error": f"Page load error: {str(e)}",
                "selector_found": False,
                "blocked": False,
            }
        
        finally:
            browser.close()


def _detect_blocking(html: str, title: str) -> str | None:
    """Detect if page is a bot challenge"""
    html_lower = html.lower()
    title_lower = title.lower()
    
    if 'gokuprops' in html_lower or 'aws-waf' in html_lower:
        return "Amazon WAF"
    elif 'captcha' in html_lower or 'recaptcha' in html_lower:
        return "CAPTCHA"
    elif 'cloudflare' in html_lower and 'checking' in html_lower:
        return "Cloudflare Challenge"
    elif 'access denied' in title_lower or 'robot' in title_lower:
        return "Access Denied"
    
    return None


def _find_similar_selectors_playwright(page, original_selector: str) -> list:
    """Find similar selectors when exact match fails"""
    suggestions = []
    
    try:
        # If it's an ID selector
        if original_selector.startswith('#'):
            id_part = original_selector.split(' ')[0].replace('#', '')
            
            # Check if ID exists
            element = page.query_selector(f'#{id_part}')
            if not element:
                # Get all IDs on page
                all_ids = page.evaluate("""
                    () => Array.from(document.querySelectorAll('[id]')).map(el => el.id)
                """)
                
                # Find similar
                similar = [id for id in all_ids if id_part.lower() in id.lower()][:5]
                
                if similar:
                    suggestions.append({
                        "type": "similar_ids",
                        "message": f"ID '{id_part}' not found. Similar IDs:",
                        "values": similar
                    })
            else:
                suggestions.append({
                    "type": "partial_match",
                    "message": f"ID '{id_part}' exists but full selector chain doesn't match",
                    "html": element.inner_html()[:500] if element else None
                })
        
        # If it's a class selector
        elif original_selector.startswith('.'):
            class_part = original_selector.split(' ')[0]
            elements = page.query_selector_all(class_part)
            
            if not elements:
                suggestions.append({
                    "type": "class_not_found",
                    "message": f"Class '{class_part}' not found on page"
                })
        
        # Check parent selector
        if '>' in original_selector:
            parent_selector = original_selector.split('>')[0].strip()
            parent_elements = page.query_selector_all(parent_selector)
            
            if parent_elements:
                suggestions.append({
                    "type": "parent_exists",
                    "message": f"Parent '{parent_selector}' exists ({len(parent_elements)} matches), children don't",
                    "parent_html": parent_elements[0].inner_html()[:500] if parent_elements else None
                })
            else:
                suggestions.append({
                    "type": "parent_missing",
                    "message": f"Parent selector '{parent_selector}' not found"
                })
    
    except Exception as e:
        suggestions.append({
            "type": "error",
            "message": f"Could not analyze: {str(e)}"
        })
    
    return suggestions


# ============================================================================
# Celery Task Integration
# ============================================================================

# Add this to your tasks.py:

"""
from celery import shared_task
from .playwright_validator import validate_selector_with_playwright

@shared_task(bind=True, name='tasks.validate_selector_playwright')
def validate_selector_playwright_task(self, url: str, selector: str):
    '''
    Celery task wrapper for Playwright validation
    '''
    try:
        result = validate_selector_with_playwright(url, selector)
        return result
    except Exception as e:
        return {
            "count": 0,
            "valid": False,
            "error": str(e),
            "selector_found": False,
            "blocked": False,
        }
"""


# ============================================================================
# Direct Usage (for testing without Celery)
# ============================================================================

if __name__ == "__main__":
    # Test it directly
    result = validate_selector_with_playwright(
        url="https://www.amazon.com/",
        selector="h2.a-color-base"
    )
    
    print(json.dumps(result, indent=2))
    print(f"\nFound {result['count']} matches")
    if result.get('all_matches_preview'):
        print("\nMatch previews:")
        for i, preview in enumerate(result['all_matches_preview'], 1):
            print(f"{i}. {preview}")