let isPicking = false;
let hoveredElement = null;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "togglePicker") {
    isPicking = request.state;
    if (!isPicking) {
      removeHighlight();
    }
    sendResponse({ status: isPicking ? "picking_started" : "picking_stopped" });
  } else if (request.action === "clearHighlights") {
    // Remove all highlights and reset state
    removeHighlight();
    document.querySelectorAll('.ac-selector-highlight, .ac-selector-selected').forEach(el => {
      el.classList.remove('ac-selector-highlight', 'ac-selector-selected');
    });
    sendResponse({ status: "highlights_cleared" });
  }
});

// Mouse Over: Highlight element
document.addEventListener("mouseover", (event) => {
  if (!isPicking) return;

  if (hoveredElement && hoveredElement !== event.target) {
    removeHighlight();
  }

  hoveredElement = event.target;
  hoveredElement.classList.add("ac-selector-highlight");
}, true);

// Mouse Out: Remove highlight
document.addEventListener("mouseout", (event) => {
  if (!isPicking) return;
  event.target.classList.remove("ac-selector-highlight");
}, true);

// Click: Select element
document.addEventListener("click", (event) => {
  if (!isPicking) return;

  event.preventDefault();
  event.stopPropagation();

  const element = event.target;

  // Generate multiple selector strategies
  const selectorStrategies = generateAllSelectors(element);

  console.log("Selected element:", element);
  console.log("All selector strategies:", selectorStrategies);

  // Flash confirmation
  element.classList.add("ac-selector-selected");
  setTimeout(() => element.classList.remove("ac-selector-selected"), 500);

  // Send to popup
  chrome.runtime.sendMessage({
    action: "elementSelected",
    data: {
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      // Primary selectors
      selector: selectorStrategies.primary,
      xpath: selectorStrategies.xpath,
      // Alternative selectors
      alternatives: {
        data_attributes: selectorStrategies.dataAttributes,
        semantic: selectorStrategies.semantic,
        text_based: selectorStrategies.textBased,
        robust_path: selectorStrategies.robustPath,
        simple_class: selectorStrategies.simpleClass
      },
      text: element.innerText.substring(0, 50) + (element.innerText.length > 50 ? "..." : ""),
      attributes: getAttributes(element),
      context: getElementContext(element)
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Message sending failed (popup closed?), but background should handle it:", chrome.runtime.lastError.message);
    }
    showToast("Element selected! Re-open extension to view.");
  });
}, true);

function removeHighlight() {
  if (hoveredElement) {
    hoveredElement.classList.remove("ac-selector-highlight");
    hoveredElement = null;
  }
}

function getAttributes(el) {
  const attrs = {};
  for (let i = 0; i < el.attributes.length; i++) {
    attrs[el.attributes[i].name] = el.attributes[i].value;
  }
  return attrs;
}

function getElementContext(el) {
  // Get context about the element's position and surroundings
  return {
    parentTag: el.parentElement?.tagName,
    parentId: el.parentElement?.id,
    parentClass: el.parentElement?.className,
    siblingCount: el.parentElement?.children.length,
    indexInParent: Array.from(el.parentElement?.children || []).indexOf(el),
    depth: getElementDepth(el)
  };
}

function getElementDepth(el) {
  let depth = 0;
  let current = el;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function showToast(message) {
  let toast = document.getElementById("ac-selector-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ac-selector-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #333;
      color: #fff;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 10000;
      font-family: sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      transition: opacity 0.5s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  setTimeout(() => {
    toast.style.opacity = "0";
  }, 3000);
}

// --- IMPROVED SELECTOR GENERATION ---

function generateAllSelectors(el) {
  return {
    primary: generateBestSelector(el),
    xpath: generateXPath(el),
    dataAttributes: generateDataAttributeSelector(el),
    semantic: generateSemanticSelector(el),
    textBased: generateTextBasedSelector(el),
    robustPath: generateRobustPath(el),
    simpleClass: generateSimpleClassSelector(el)
  };
}

function generateBestSelector(el) {
  // Strategy 1: Data attributes (most stable for SPAs)
  const dataAttrSelector = generateDataAttributeSelector(el);
  if (dataAttrSelector && isUnique(dataAttrSelector)) {
    return dataAttrSelector;
  }

  // Strategy 2: Unique stable ID
  if (el.id && isStableId(el.id) && isUnique(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  // Strategy 3: Unique combination of stable attributes
  const attrSelector = generateAttributeSelector(el);
  if (attrSelector && isUnique(attrSelector)) {
    return attrSelector;
  }

  // Strategy 4: Text-based for unique text elements
  const textSelector = generateTextBasedSelector(el);
  if (textSelector && isUnique(textSelector)) {
    return textSelector;
  }

  // Strategy 5: Stable class combinations
  const stableClassSelector = generateStableClassSelector(el);
  if (stableClassSelector && isUnique(stableClassSelector)) {
    return stableClassSelector;
  }

  // Strategy 6: Fallback to robust path
  return generateRobustPath(el);
}

function generateDataAttributeSelector(el) {
  // Look for data-* attributes (common in modern frameworks)
  const dataAttrs = ['data-testid', 'data-test', 'data-id', 'data-component', 'data-cy', 'data-qa'];

  for (const attr of dataAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      return `[${attr}="${value}"]`;
    }
  }

  // Check for other stable data attributes
  for (let i = 0; i < el.attributes.length; i++) {
    const attrName = el.attributes[i].name;
    if (attrName.startsWith('data-') && !attrName.includes('dynamic') && !attrName.includes('random')) {
      const value = el.attributes[i].value;
      if (value && value.length < 50 && !value.match(/\d{10,}/)) { // Avoid long IDs or timestamps
        return `[${attrName}="${value}"]`;
      }
    }
  }

  return null;
}

function generateAttributeSelector(el) {
  // Use stable attributes like role, aria-label, name, type, etc.
  const stableAttrs = ['role', 'aria-label', 'aria-labelledby', 'name', 'type', 'placeholder', 'title'];

  for (const attr of stableAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      const selector = `${el.tagName.toLowerCase()}[${attr}="${value}"]`;
      if (isUnique(selector)) {
        return selector;
      }
    }
  }

  return null;
}

function generateSemanticSelector(el) {
  // Use semantic HTML and ARIA roles
  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');

  if (role && ariaLabel) {
    return `[role="${role}"][aria-label="${ariaLabel}"]`;
  }

  if (role) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[role="${role}"]`;
  }

  return null;
}

function generateTextBasedSelector(el) {
  // For elements with unique text content
  const text = el.innerText?.trim();
  if (!text || text.length > 50 || text.length < 3) return null;

  const tag = el.tagName.toLowerCase();

  // Use :contains-like approach (though CSS doesn't support it, XPath does)
  // For CSS, we can suggest this as an alternative
  return `${tag}:has-text("${text.substring(0, 30)}")`;
}

function generateSimpleClassSelector(el) {
  const classes = getStableClasses(el);
  if (classes.length === 0) return null;

  const tag = el.tagName.toLowerCase();
  return `${tag}.${classes.join('.')}`;
}

function generateStableClassSelector(el) {
  const classes = getStableClasses(el);
  if (classes.length === 0) return null;

  // Try different combinations
  for (let i = 1; i <= Math.min(classes.length, 3); i++) {
    const selector = `.${classes.slice(0, i).join('.')}`;
    if (isUnique(selector)) {
      return selector;
    }
  }

  return null;
}

function getStableClasses(el) {
  if (!el.className || typeof el.className !== 'string') return [];

  return el.className.split(/\s+/)
    .filter(c => c.length > 0)
    .filter(c => !c.startsWith('ac-selector')) // Ignore our own classes
    .filter(c => !c.match(/^(hover|active|focus|selected|disabled)$/)) // Ignore state classes
    .filter(c => !c.match(/\d{5,}/)) // Ignore classes with long numbers (likely dynamic)
    .filter(c => !c.match(/^[a-z0-9]{20,}$/i)) // Ignore very long random-looking classes
    .map(c => CSS.escape(c));
}

function generateRobustPath(el) {
  // Build a path using stable attributes when possible
  const path = [];
  let current = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();

    // Try to find a stable anchor point
    if (current.id && isStableId(current.id)) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Use data attributes if available
    const dataAttr = generateDataAttributeSelector(current);
    if (dataAttr) {
      path.unshift(dataAttr);
      break;
    }

    // Use stable classes
    const stableClasses = getStableClasses(current);
    if (stableClasses.length > 0) {
      selector += `.${stableClasses[0]}`;
    }

    // Add nth-of-type only if necessary
    let sibling = current;
    let nth = 1;
    while (sibling = sibling.previousElementSibling) {
      if (sibling.tagName.toLowerCase() === current.tagName.toLowerCase()) nth++;
    }

    // Check if there are siblings with same tag
    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        child => child.tagName.toLowerCase() === current.tagName.toLowerCase()
      );
      if (sameTagSiblings.length > 1) {
        selector += `:nth-of-type(${nth})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Stop at body or after 5 levels
    if (path.length >= 5 || current?.tagName.toLowerCase() === 'body') {
      break;
    }
  }

  return path.join(' > ');
}

function isStableId(id) {
  // Check if ID looks stable (not dynamically generated)
  if (!id) return false;

  // Too long with numbers = likely dynamic
  if (id.length > 20 && /\d/.test(id)) return false;

  // Known dynamic patterns
  const dynamicPatterns = [
    /^(ember|react|vue|angular)\d+/i,
    /^[a-z0-9]{20,}$/i, // Long random strings
    /\d{10,}/, // Timestamps
    /^CardInstance/,
    /^uid-/,
    /^id-\d+/,
    /-\d{5,}$/
  ];

  return !dynamicPatterns.some(pattern => pattern.test(id));
}

function isUnique(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (e) {
    return false;
  }
}

function generateXPath(el) {
  if (el.id && isStableId(el.id)) {
    return `//*[@id="${el.id}"]`;
  }

  const parts = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let nb = 0;
    let hasSameTagSibling = false;
    let sibling = el.previousSibling;

    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName) {
        nb++;
        hasSameTagSibling = true;
      }
      sibling = sibling.previousSibling;
    }

    if (!hasSameTagSibling) {
      sibling = el.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName) {
          hasSameTagSibling = true;
          break;
        }
        sibling = sibling.nextSibling;
      }
    }

    const tagName = el.nodeName.toLowerCase();
    const index = hasSameTagSibling ? `[${nb + 1}]` : '';
    parts.unshift(`${tagName}${index}`);
    el = el.parentNode;
  }
  return parts.length ? '/' + parts.join('/') : null;
}