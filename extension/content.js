let isPicking = false;
let pickingMode = 'field'; // 'container', 'field', 'pagination', 'link'
let hoveredElement = null;
let currentContainer = null;

// VERSION CHECK - Updated 2026-02-14 18:50 - FIXED SYNTAX
const CONTENT_SCRIPT_VERSION = "2.1.1-fixed";
const LOAD_TIMESTAMP = new Date().toISOString();
console.log(`🔧 Content Script Loaded - Version: ${CONTENT_SCRIPT_VERSION} at ${LOAD_TIMESTAMP}`);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "togglePicker") {
    isPicking = request.state;
    pickingMode = request.mode || 'field';
    currentContainer = request.container || null;
    
    if (!isPicking) {
      removeHighlight();
      clearAllHighlights();
    }
    sendResponse({ status: isPicking ? "picking_started" : "picking_stopped" });
  } else if (request.action === "clearHighlights") {
    clearAllHighlights();
    sendResponse({ status: "highlights_cleared" });
  } else if (request.action === "testSelector") {
    const result = testSelectorOnPage(request.selector, request.containerSelector);
    sendResponse(result);
  } else if (request.action === "previewData") {
    const preview = previewDataExtraction(request.fields, request.containerSelector);
    sendResponse(preview);
  }
  
  return true; // Keep channel open for async response
});

// Mouse Over: Highlight element
document.addEventListener("mouseover", (event) => {
  if (!isPicking) return;

  if (hoveredElement && hoveredElement !== event.target) {
    removeHighlight();
  }

  hoveredElement = event.target;
  hoveredElement.classList.add("ac-selector-highlight");
  
  // Show tooltip with element info
  showHoverTooltip(hoveredElement);
}, true);

// Mouse Out: Remove highlight
document.addEventListener("mouseout", (event) => {
  if (!isPicking) return;
  event.target.classList.remove("ac-selector-highlight");
  hideHoverTooltip();
}, true);

// Keyboard Navigation: Allow expanding selection to parent/child
document.addEventListener("keydown", (event) => {
  if (!isPicking || !hoveredElement) return;
  
  if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
    event.preventDefault();
    const parent = hoveredElement.parentElement;
    if (parent && parent.tagName !== 'HTML' && parent.tagName !== 'BODY') {
      removeHighlight();
      hoveredElement = parent;
      hoveredElement.classList.add("ac-selector-highlight");
      showHoverTooltip(hoveredElement);
    }
  } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
    event.preventDefault();
    const child = hoveredElement.firstElementChild;
    if (child) {
      removeHighlight();
      hoveredElement = child;
      hoveredElement.classList.add("ac-selector-highlight");
      showHoverTooltip(hoveredElement);
    }
  }
}, true);

// Click: Select element
document.addEventListener("click", (event) => {
  if (!isPicking) return;

  event.preventDefault();
  event.stopPropagation();

  // Use hoveredElement so keyboard navigation works, fallback to event.target
  const element = hoveredElement || event.target;
  
  if (pickingMode === 'container') {
    handleContainerSelection(element);
  } else if (pickingMode === 'field') {
    handleFieldSelection(element);
  } else if (pickingMode === 'pagination') {
    handlePaginationSelection(element);
  } else if (pickingMode === 'link') {
    handleLinkSelection(element);
  }
}, true);

// ============================================================================
// SELECTION HANDLERS
// ============================================================================

function handleContainerSelection(element) {
  let patternInfo = detectRepeatingPattern(element);
  let container = element;
  
  // If no pattern found, walk up the DOM to find a repeating parent
  if (!patternInfo.isRepeating) {
    console.log('[Container Selection] No pattern at clicked element, searching parents...');
    
    let current = element.parentElement;
    let levelsChecked = 0;
    const maxLevels = 20; // Allow deeply nested clicks to find the repeating parent
    
    while (current && levelsChecked < maxLevels && current.tagName !== 'BODY') {
      const parentPattern = detectRepeatingPattern(current);
      
      if (parentPattern.isRepeating) {
        console.log(`[Container Selection] ✓ Found repeating pattern ${levelsChecked + 1} levels up:`, current);
        container = current;
        patternInfo = parentPattern;
        break;
      }
      
      current = current.parentElement;
      levelsChecked++;
    }
  }
  
  if (!patternInfo.isRepeating) {
    showToast("⚠ This element doesn't appear to be part of a repeating pattern", "warning");
    return;
  }
  
  console.log('=== CONTAINER SELECTION DEBUG ===');
  console.log('Clicked element:', element);
  console.log('Container:', container);
  console.log('Container tag:', container.tagName);
  console.log('Container classes:', container.className);
  
  // Use special container selector that matches ALL similar elements (no nth-of-type)
  const containerSelector = generateContainerSelector(container, patternInfo.similarElements);
  
  console.log('Generated selector:', containerSelector);
  
  // Validate it finds multiple items
  const matches = document.querySelectorAll(containerSelector);
  
  console.log('Match count:', matches.length);
  console.log('Matches:', matches);
  
  if (matches.length < 2) {
    showToast("⚠ Container selector only matches one element", "warning");
    return;
  }
  
  console.log('✓ Validation passed! Showing toast and sending message...');
  
  // Flash confirmation on all containers
  matches.forEach(el => {
    el.classList.add("ac-container-highlight");
    setTimeout(() => el.classList.remove("ac-container-highlight"), 2000);
  });
  
  showToast(`✓ Container selected! Found ${matches.length} items`, "success");
  console.log('Toast shown');
  
  // Send to popup
  const message = {
    action: "containerSelected",
    data: {
      selector: containerSelector,
      count: matches.length,
      tagName: container.tagName,
      sampleHtml: container.innerHTML.substring(0, 500)
    }
  };
  
  console.log('Sending message to popup:', message);
  
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to send message:', chrome.runtime.lastError);
    } else {
      console.log('Message sent successfully, response:', response);
    }
  });
}

function handleFieldSelection(element) {
  let containerElement = null;
  let containerSelector = currentContainer;
  
  // If we have a container, find which container this element belongs to
  if (currentContainer) {
    const containers = document.querySelectorAll(currentContainer);
    for (let container of containers) {
      if (container.contains(element)) {
        containerElement = container;
        break;
      }
    }
    
    if (!containerElement) {
      showToast("⚠ Selected element is outside the container", "warning");
      return;
    }
  }
  
  // Generate selectors
  const selectors = containerElement 
    ? generateRelativeSelectors(element, containerElement)
    : generateAbsoluteSelectors(element);
  
  // Test all selectors and count matches
  const matchCounts = {};
  for (const [key, selector] of Object.entries(selectors)) {
    if (selector && selector !== 'null') {
      matchCounts[key] = testSelectorOnPage(selector, containerSelector).count;
    }
  }
  
  // Get pattern info
  const patternInfo = detectRepeatingPattern(element);
  
  // Flash confirmation
  element.classList.add("ac-selector-selected");
  setTimeout(() => element.classList.remove("ac-selector-selected"), 500);
  
  // Visualize pattern if detected
  if (patternInfo.isRepeating && patternInfo.similarElements.length > 0) {
    visualizePattern(patternInfo.similarElements);
  }
  
  showToast("✓ Element selected! Configure in popup", "success");
  
  // Send to popup
  chrome.runtime.sendMessage({
    action: "fieldSelected",
    data: {
      tagName: element.tagName,
      text: element.innerText?.substring(0, 100) || element.textContent?.substring(0, 100) || '',
      selectors: selectors,
      matchCounts: matchCounts,
      pattern: patternInfo,
      isInContainer: !!containerElement,
      containerSelector: containerSelector
    }
  });
}

function handlePaginationSelection(element) {
  // Must be a link
  const linkEl = element.tagName === 'A' ? element : element.closest('a');
  
  if (!linkEl) {
    showToast("⚠ Please select a link element for pagination", "warning");
    return;
  }
  
  const selector = generateAbsoluteSelector(linkEl);
  const href = linkEl.getAttribute('href');
  
  // Find similar pagination links
  const allLinks = Array.from(document.querySelectorAll('a[href]'));
  const similarLinks = allLinks.filter(link => 
    areElementsSimilar(linkEl, link) && link.getAttribute('href') !== href
  );
  
  // Flash confirmation
  linkEl.classList.add("ac-selector-selected");
  setTimeout(() => linkEl.classList.remove("ac-selector-selected"), 500);
  
  showToast(`✓ Pagination link selected`, "success");
  
  chrome.runtime.sendMessage({
    action: "paginationSelected",
    data: {
      selector: selector,
      href: href,
      text: linkEl.innerText?.trim() || '',
      similarCount: similarLinks.length
    }
  });
}

function handleLinkSelection(element) {
  const linkEl = element.tagName === 'A' ? element : element.closest('a');
  
  if (!linkEl) {
    showToast("⚠ Please select a link element", "warning");
    return;
  }
  
  let containerElement = null;
  let containerSelector = currentContainer;
  
  // If we have a container, find which container this element belongs to
  if (currentContainer) {
    const containers = document.querySelectorAll(currentContainer);
    for (let container of containers) {
      if (container.contains(linkEl)) {
        containerElement = container;
        break;
      }
    }
  }
  
  // Generate selector (relative if in container)
  const selector = containerElement
    ? generateRelativeSelectors(linkEl, containerElement).primary
    : generateAbsoluteSelector(linkEl);
  
  const href = linkEl.getAttribute('href');
  
  // Find all similar links
  const testResult = testSelectorOnPage(selector, containerSelector);
  
  // Flash confirmation
  linkEl.classList.add("ac-selector-selected");
  setTimeout(() => linkEl.classList.remove("ac-selector-selected"), 500);
  
  showToast(`✓ Link selector created (${testResult.count} matches)`, "success");
  
  chrome.runtime.sendMessage({
    action: "linkSelected",
    data: {
      selector: selector,
      href: href,
      text: linkEl.innerText?.trim() || '',
      count: testResult.count,
      sampleUrls: testResult.matches.slice(0, 5)
    }
  });
}

// ============================================================================
// SELECTOR GENERATION - RELATIVE (for use within containers)
// ============================================================================

function generateRelativeSelectors(element, container) {
  // Get path from container to element
  const path = getRelativePath(element, container);
  
  if (path.length === 0) {
    // Element IS the container
    return {
      primary: element.tagName.toLowerCase(),
      cssPath: element.tagName.toLowerCase(),
      xpath: `./${element.tagName.toLowerCase()}`,
      dataAttr: generateDataAttributeSelector(element),
      class: generateSimpleClassSelector(element)
    };
  }
  
  // Strategy 1: Simple class selector (preferred for Scrapy)
  const stableClasses = getStableClasses(element);
  const simpleClass = stableClasses.length > 0 
    ? `.${stableClasses[0]}` 
    : null;
  
  // Strategy 2: Tag + class
  const tagClass = stableClasses.length > 0
    ? `${element.tagName.toLowerCase()}.${stableClasses[0]}`
    : null;
  
  // Strategy 3: CSS path from container (e.g., "div.card > h3 > a")
  const cssPath = path.map(node => {
    const tag = node.tagName.toLowerCase();
    const classes = getStableClasses(node);
    return classes.length > 0 ? `${tag}.${classes[0]}` : tag;
  }).join(' > ');
  
  // Strategy 4: Descendant selector (less strict)
  const descendant = path.map(node => {
    const tag = node.tagName.toLowerCase();
    const classes = getStableClasses(node);
    return classes.length > 0 ? `${tag}.${classes[0]}` : tag;
  }).join(' ');
  
  // Strategy 5: XPath relative to container
  const xpathParts = path.map(node => {
    const tag = node.tagName.toLowerCase();
    const classes = getStableClasses(node);
    if (classes.length > 0) {
      return `${tag}[contains(@class, '${classes[0]}')]`;
    }
    return tag;
  });
  const xpath = './' + xpathParts.join('/');
  
  // Strategy 6: Data attribute
  const dataAttr = generateDataAttributeSelector(element);
  
  // Strategy 7: Label-Aware XPath (Smart Selector)
  const labelXPath = generateLabelAwareXPath(element, container, path);
  
  // Choose best primary selector
  let primary = simpleClass || tagClass || cssPath;
  
  // If data attribute exists and is unique within container, prefer it
  if (dataAttr) {
    const testMatches = container.querySelectorAll(dataAttr);
    if (testMatches.length === 1) {
      primary = dataAttr;
    }
  }
  
  return {
    primary: primary,
    simpleClass: simpleClass,
    tagClass: tagClass,
    cssPath: cssPath,
    descendant: descendant,
    xpath: xpath,
    labelXPath: labelXPath,
    dataAttr: dataAttr
  };
}

function generateLabelAwareXPath(element, container, path) {
  if (!path || path.length === 0) return null;
  
  let labelNode = null;
  let labelText = '';
  
  let current = element;
  while (current && current !== container) {
    let prev = current.previousElementSibling;
    while (prev) {
      const text = prev.innerText?.trim() || prev.textContent?.trim();
      if (text && text.length > 0 && text.length < 30 && !/^[\d.,]+$/.test(text)) {
        labelNode = prev;
        labelText = text;
        break;
      }
      prev = prev.previousElementSibling;
    }
    if (labelNode) break;
    
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      for (let sib of siblings) {
        if (sib === current) continue;
        if (sib.tagName === 'TH' || sib.tagName === 'DT' || sib.tagName === 'LABEL' || /label|lbl|title|name|key/i.test(sib.className || '')) {
          const text = sib.innerText?.trim() || sib.textContent?.trim();
          if (text && text.length > 0 && text.length < 30 && !/^[\d.,]+$/.test(text)) {
            labelNode = sib;
            labelText = text;
            break;
          }
        }
      }
    }
    if (labelNode) break;
    
    current = current.parentElement;
  }
  
  if (!labelNode) return null;
  
  labelText = labelText.replace(/[:"\n\t\r]/g, '').trim();
  if (!labelText || labelText.length > 30 || labelText.includes("'")) return null;
  
  let lca = element.parentElement;
  while (lca && lca !== container) {
    if (lca.contains(labelNode)) break;
    lca = lca.parentElement;
  }
  
  if (!lca || lca === container) return null;
  
  const xpathParts = path.map(node => {
    const tag = node.tagName.toLowerCase();
    const classes = getStableClasses(node);
    let part = tag;
    
    let conditions = [];
    if (classes.length > 0) {
      conditions.push(`contains(@class, '${classes[0]}')`);
    }
    
    if (node === lca) {
      conditions.push(`contains(., '${labelText}')`);
    }
    
    if (conditions.length > 0) {
      part += `[${conditions.join(' and ')}]`;
    }
    
    return part;
  });
  
  return './' + xpathParts.join('/');
}

// ============================================================================
// SELECTOR GENERATION - ABSOLUTE (for single items or containers)
// ============================================================================

function generateAbsoluteSelectors(element) {
  // Strategy 1: Data attributes (most stable)
  const dataAttr = generateDataAttributeSelector(element);
  if (dataAttr && isUnique(dataAttr)) {
    return {
      primary: dataAttr,
      dataAttr: dataAttr,
      class: generateSimpleClassSelector(element),
      xpath: generateXPath(element),
      cssPath: generateRobustPath(element)
    };
  }
  
  // Strategy 2: Stable class combinations
  const stableClassSelector = generateStableClassSelector(element);
  if (stableClassSelector && isUnique(stableClassSelector)) {
    return {
      primary: stableClassSelector,
      class: stableClassSelector,
      dataAttr: dataAttr,
      xpath: generateXPath(element),
      cssPath: generateRobustPath(element)
    };
  }
  
  // Strategy 3: Attribute selector
  const attrSelector = generateAttributeSelector(element);
  if (attrSelector && isUnique(attrSelector)) {
    return {
      primary: attrSelector,
      attribute: attrSelector,
      class: generateSimpleClassSelector(element),
      dataAttr: dataAttr,
      xpath: generateXPath(element),
      cssPath: generateRobustPath(element)
    };
  }
  
  // Fallback: Robust path (avoiding IDs)
  const robustPath = generateRobustPath(element);
  
  return {
    primary: robustPath,
    cssPath: robustPath,
    class: generateSimpleClassSelector(element),
    dataAttr: dataAttr,
    xpath: generateXPath(element)
  };
}

function generateAbsoluteSelector(element) {
  const selectors = generateAbsoluteSelectors(element);
  return selectors.primary;
}

// Generate selector for containers - matches ALL similar elements (no nth-of-type)
function generateContainerSelector(element, similarElements = null) {
  const tag = element.tagName.toLowerCase();
  
  // If we have info about similar elements, find shared classes
  if (similarElements && similarElements.length >= 2) {
    const sharedClasses = findSharedClasses(similarElements);
    console.log('[Container Selector] Shared classes among similar elements:', sharedClasses);
    
    if (sharedClasses.length > 0) {
      // Try each shared class to see which gives the right count
      for (const className of sharedClasses) {
        const selector = `${tag}.${className}`;
        const matches = document.querySelectorAll(selector);
        console.log(`[Container Selector] Trying shared class: ${selector} (${matches.length} matches)`);
        
        if (matches.length >= similarElements.length) {
          return selector;
        }
      }
      
      // If single class didn't work, try combining first two
      if (sharedClasses.length >= 2) {
        const selector = `${tag}.${sharedClasses[0]}.${sharedClasses[1]}`;
        const matches = document.querySelectorAll(selector);
        console.log(`[Container Selector] Trying combined classes: ${selector} (${matches.length} matches)`);
        
        if (matches.length >= 2) {
          return selector;
        }
      }
    }
  }
  
  // Fallback to original logic
  const stableClasses = getStableClasses(element);
  
  if (stableClasses.length > 0) {
    const simpleSelector = `${tag}.${stableClasses[0]}`;
    const matches = document.querySelectorAll(simpleSelector);
    
    console.log(`Trying simple selector: ${simpleSelector} (${matches.length} matches)`);
    
    if (matches.length >= 2) {
      return simpleSelector;
    }
  }
  
  // If simple doesn't work, try with parent context
  const parent = element.parentElement;
  if (parent && parent.tagName !== 'BODY') {
    const parentTag = parent.tagName.toLowerCase();
    const parentClasses = getStableClasses(parent);
    const childTag = element.tagName.toLowerCase();
    const childClasses = getStableClasses(element);
    
    let parentSel = parentTag;
    if (parentClasses.length > 0) {
      parentSel += `.${parentClasses[0]}`;
    }
    
    let childSel = childTag;
    if (childClasses.length > 0) {
      childSel += `.${childClasses[0]}`;
    }
    
    const contextSelector = `${parentSel} > ${childSel}`;
    const matches = document.querySelectorAll(contextSelector);
    
    console.log(`Trying parent > child: ${contextSelector} (${matches.length} matches)`);
    
    if (matches.length >= 2) {
      return contextSelector;
    }
  }
  
  // Fallback: build full path but limit to 3 levels
  const path = [];
  let current = element;
  
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 3) {
    let selector = current.tagName.toLowerCase();
    
    const dataAttr = generateDataAttributeSelector(current);
    if (dataAttr) {
      path.unshift(dataAttr);
      break;
    }
    
    const stableClasses = getStableClasses(current);
    if (stableClasses.length > 0) {
      selector += `.${stableClasses[0]}`; // Use only FIRST stable class
    }
    
    path.unshift(selector);
    current = current.parentElement;
    
    if (current?.tagName.toLowerCase() === 'body') {
      break;
    }
  }
  
  return path.join(' > ');
}

// Find classes that are shared by all elements in the array
function findSharedClasses(elements) {
  if (elements.length === 0) return [];
  
  // Get all classes from first element
  const firstClasses = getStableClasses(elements[0]);
  
  // Filter to only classes present in ALL elements
  const sharedClasses = firstClasses.filter(className => {
    return elements.every(el => {
      const elClasses = getStableClasses(el);
      return elClasses.includes(className);
    });
  });
  
  return sharedClasses;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getRelativePath(element, container) {
  const path = [];
  let current = element;
  
  while (current && current !== container && current.parentElement) {
    path.unshift(current);
    current = current.parentElement;
    
    if (path.length > 10) break; // Safety
  }
  
  return path;
}

function generateDataAttributeSelector(el) {
  const dataAttrs = ['data-testid', 'data-test', 'data-id', 'data-component', 'data-cy', 'data-qa'];
  
  for (const attr of dataAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      return `[${attr}="${CSS.escape(value)}"]`;
    }
  }
  
  // Check for other stable data attributes
  for (let i = 0; i < el.attributes.length; i++) {
    const attrName = el.attributes[i].name;
    if (attrName.startsWith('data-') && !attrName.match(/(dynamic|random|index|key|uid)/i)) {
      const value = el.attributes[i].value;
      if (value && value.length < 50 && !value.match(/\d{10,}/)) {
        return `[${attrName}="${CSS.escape(value)}"]`;
      }
    }
  }
  
  return null;
}

function generateAttributeSelector(el) {
  const stableAttrs = ['role', 'aria-label', 'name', 'type', 'placeholder', 'title', 'rel'];
  
  for (const attr of stableAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      const selector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
      if (isUnique(selector)) {
        return selector;
      }
    }
  }
  
  return null;
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
    .filter(c => !c.startsWith('ac-selector')) // Ignore our classes
    .filter(c => !c.match(/^(hover|active|focus|selected|disabled|open|closed)$/i)) // State classes
    .filter(c => !c.match(/\d{5,}/)) // Long numbers (likely dynamic)
    .filter(c => !c.match(/^[a-z0-9]{20,}$/i)) // Very long random strings
    .filter(c => !c.match(/-\d{4,}$/)) // Ends with long number
    .map(c => CSS.escape(c));
}

function generateRobustPath(el) {
  const path = [];
  let current = el;
  
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    
    // NEVER use IDs - they're too unstable
    
    // Try data attributes
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
    
    // Add nth-of-type if needed for disambiguation
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
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

function generateXPath(el) {
  // Never use IDs in XPath
  const parts = [];
  let current = el;
  
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let count = 1;
    let sibling = current.previousSibling;
    
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
        count++;
      }
      sibling = sibling.previousSibling;
    }
    
    const tagName = current.nodeName.toLowerCase();
    const index = count > 1 || hasFollowingSiblingWithSameTag(current) ? `[${count}]` : '';
    parts.unshift(`${tagName}${index}`);
    
    current = current.parentNode;
    
    if (current?.nodeName === 'BODY') break;
  }
  
  return '/' + parts.join('/');
}

function hasFollowingSiblingWithSameTag(el) {
  let sibling = el.nextSibling;
  while (sibling) {
    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName) {
      return true;
    }
    sibling = sibling.nextSibling;
  }
  return false;
}

function isUnique(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// PATTERN DETECTION
// ============================================================================

function detectRepeatingPattern(element) {
  const parent = element.parentElement;
  if (!parent) {
    return { isRepeating: false, count: 1, similarElements: [] };
  }
  
  const siblings = Array.from(parent.children).filter(
    child => child.tagName === element.tagName
  );
  
  console.log(`[Pattern Detection] Tag: ${element.tagName}, Siblings with same tag: ${siblings.length}`);
  
  if (siblings.length < 2) {
    console.log('[Pattern Detection] Not enough siblings');
    return { isRepeating: false, count: 1, similarElements: [] };
  }
  
  const similarElements = siblings.filter(sibling => {
    const similar = areElementsSimilar(element, sibling);
    if (!similar && sibling !== element) {
      console.log('[Pattern Detection] Sibling NOT similar:', sibling);
    }
    return similar;
  });
  
  console.log(`[Pattern Detection] Similar elements: ${similarElements.length} / ${siblings.length}`);
  
  const isRepeating = similarElements.length >= 2;
  
  return {
    isRepeating,
    count: similarElements.length,
    totalSiblings: siblings.length,
    similarElements,
    parentTag: parent.tagName
  };
}

function areElementsSimilar(el1, el2) {
  if (el1 === el2) return true;
  if (el1.tagName !== el2.tagName) return false;
  
  // Compare class names
  const classes1 = (el1.className || '').split(/\s+/).filter(c => c && !c.startsWith('ac-'));
  const classes2 = (el2.className || '').split(/\s+/).filter(c => c && !c.startsWith('ac-'));
  const commonClasses = classes1.filter(c => classes2.includes(c));
  const classSimiliarity = commonClasses.length / Math.max(classes1.length, classes2.length, 1);
  
  // Compare child structure
  const children1 = Array.from(el1.children).map(c => c.tagName);
  const children2 = Array.from(el2.children).map(c => c.tagName);
  const childrenMatch = children1.length === children2.length &&
    children1.every((tag, i) => tag === children2[i]);
  
  const similar = classSimiliarity > 0.5 || childrenMatch;
  
  if (!similar) {
    console.log(`[Similarity Check] FAILED - classSimiliarity: ${classSimiliarity.toFixed(2)}, childrenMatch: ${childrenMatch}`);
    console.log(`  Classes1 (${classes1.length}):`, classes1.slice(0, 3));
    console.log(`  Classes2 (${classes2.length}):`, classes2.slice(0, 3));
    console.log(`  Children1 (${children1.length}):`, children1);
    console.log(`  Children2 (${children2.length}):`, children2);
  }
  
  return similar;
}

// ============================================================================
// CLIENT-SIDE TESTING
// ============================================================================

function testSelectorOnPage(selector, containerSelector = null) {
  try {
    let matches = [];
    
    if (containerSelector) {
      // Test within each container
      const containers = document.querySelectorAll(containerSelector);
      containers.forEach(container => {
        // Handle both CSS and XPath
        if (selector.startsWith('/') || selector.startsWith('./')) {
          const result = document.evaluate(
            selector,
            container,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          for (let i = 0; i < result.snapshotLength; i++) {
            matches.push(result.snapshotItem(i));
          }
        } else {
          const found = container.querySelectorAll(selector);
          matches.push(...found);
        }
      });
    } else {
      // Test on entire page
      if (selector.startsWith('/') || selector.startsWith('./')) {
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        for (let i = 0; i < result.snapshotLength; i++) {
          matches.push(result.snapshotItem(i));
        }
      } else {
        matches = Array.from(document.querySelectorAll(selector));
      }
    }
    
    // Extract text/content from matches
    const extractedData = matches.map(el => {
      const text = (el.innerText || el.textContent || '').trim();
      const href = el.getAttribute?.('href');
      return {
        text: text.substring(0, 100),
        href: href,
        tag: el.tagName
      };
    });
    
    return {
      valid: true,
      count: matches.length,
      matches: extractedData
    };
  } catch (error) {
    return {
      valid: false,
      count: 0,
      error: error.message,
      matches: []
    };
  }
}

function previewDataExtraction(fields, containerSelector) {
  try {
    const containers = containerSelector 
      ? Array.from(document.querySelectorAll(containerSelector))
      : [document];
    
    const results = [];
    
    containers.slice(0, 3).forEach((container, idx) => { // Preview first 3 containers
      const item = { _containerIndex: idx };
      
      for (const [fieldName, selector] of Object.entries(fields)) {
        try {
          let matches = [];
          
          if (selector.startsWith('/') || selector.startsWith('./')) {
            const result = document.evaluate(
              selector,
              container,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            for (let i = 0; i < result.snapshotLength; i++) {
              matches.push(result.snapshotItem(i));
            }
          } else {
            matches = Array.from(container.querySelectorAll(selector));
          }
          
          if (matches.length > 0) {
            const texts = matches.map(el => 
              (el.innerText || el.textContent || '').trim()
            ).filter(t => t);
            item[fieldName] = texts.join(' ');
          } else {
            item[fieldName] = null;
          }
        } catch (error) {
          item[fieldName] = `ERROR: ${error.message}`;
        }
      }
      
      results.push(item);
    });
    
    return {
      success: true,
      preview: results,
      totalContainers: containers.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// UI HELPERS
// ============================================================================

function removeHighlight() {
  if (hoveredElement) {
    hoveredElement.classList.remove("ac-selector-highlight");
    hoveredElement = null;
  }
}

function clearAllHighlights() {
  document.querySelectorAll('.ac-selector-highlight, .ac-selector-selected, .ac-container-highlight, .ac-pattern-highlight').forEach(el => {
    el.classList.remove('ac-selector-highlight', 'ac-selector-selected', 'ac-container-highlight', 'ac-pattern-highlight');
  });
}

function visualizePattern(elements, duration = 2000) {
  elements.forEach(el => {
    el.classList.add('ac-pattern-highlight');
  });
  
  setTimeout(() => {
    elements.forEach(el => {
      el.classList.remove('ac-pattern-highlight');
    });
  }, duration);
}

function showToast(message, type = "info") {
  let toast = document.getElementById("ac-selector-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ac-selector-toast";
    document.body.appendChild(toast);
  }
  
  // Set style based on type
  const colors = {
    success: { bg: '#10b981', text: '#fff' },
    warning: { bg: '#f59e0b', text: '#fff' },
    error: { bg: '#ef4444', text: '#fff' },
    info: { bg: '#3b82f6', text: '#fff' }
  };
  
  const color = colors[type] || colors.info;
  
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${color.bg};
    color: ${color.text};
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 10000;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: opacity 0.3s;
    max-width: 300px;
  `;
  
  toast.textContent = message;
  toast.style.opacity = "1";
  
  setTimeout(() => {
    toast.style.opacity = "0";
  }, 3000);
}

function showHoverTooltip(element) {
  let tooltip = document.getElementById("ac-hover-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "ac-hover-tooltip";
    tooltip.style.cssText = `
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      z-index: 10001;
      pointer-events: none;
      white-space: nowrap;
    `;
    document.body.appendChild(tooltip);
  }
  
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const classes = getStableClasses(element).slice(0, 2).join('.');
  const text = (element.innerText || element.textContent || '').substring(0, 30);
  
  let instructions = "";
  if (pickingMode === 'container') {
      instructions = " [Press W/S or ↑/↓ to navigate parents/children]";
  }
  
  tooltip.textContent = `${tag}${classes ? '.' + classes : ''} ${text ? '| ' + text : ''}${instructions}`;
  tooltip.style.top = `${rect.top - 30}px`;
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.display = 'block';
}

function hideHoverTooltip() {
  const tooltip = document.getElementById("ac-hover-tooltip");
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}
