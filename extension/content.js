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

  // Optional: Send preview of selector to popup immediately?
  // usually better to wait for click to confirm selection
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
  const selector = generateSelector(element);
  const xpath = generateXPath(element);

  console.log("Selected:", selector);

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
      selector: selector,
      xpath: xpath,
      text: element.innerText.substring(0, 50) + (element.innerText.length > 50 ? "..." : ""),
      attributes: getAttributes(element)
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Message sending failed (popup closed?), but background should handle it:", chrome.runtime.lastError.message);
    }
    // Show on-page notification
    showToast("Element selected! Re-open extension to view.");
  });

  // Turn off picker after selection? Or keep it on? 
  // Let's keep it on for now, or let user toggle it off in popup.
  // isPicking = false; 
  // removeHighlight();
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

// --- Selector Generation Logic ---

function generateSelector(el) {
  if (el.tagName.toLowerCase() === "html") return "html";
  if (el.tagName.toLowerCase() === "body") return "body";

  // 1. ID
  if (el.id && isUsefulId(el.id)) {
    // Check if ID is unique
    if (document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
  }

  // 2. Class (try combinations)
  const className = el.className;
  if (className && typeof className === 'string') {
    const classes = className.split(/\s+/).filter(c => c.length > 0 && !c.startsWith('ac-selector'));
    if (classes.length > 0) {
      // Try single class
      for (const cls of classes) {
        const sel = `.${CSS.escape(cls)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      // Try all classes
      const allSel = "." + classes.map(c => CSS.escape(c)).join(".");
      if (document.querySelectorAll(allSel).length === 1) return allSel;
    }
  }

  // 3. Fallback: Tag + nth-of-type + Parent
  let path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.tagName.toLowerCase();

    if (el.id && isUsefulId(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      path.unshift(`#${CSS.escape(el.id)}`);
      break;
    } else {
      let sibling = el;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.tagName.toLowerCase() === selector) nth++;
      }
      if (nth > 1) selector += `:nth-of-type(${nth})`;
    }

    path.unshift(selector);
    el = el.parentNode;
  }

  return path.join(" > ");
}

function isUsefulId(id) {
  // ID contains a number and is long? Likely dynamic (e.g., "ember123", "CardInstance...")
  if (id.length > 15 && /\d/.test(id)) return false;
  // Amazon specific: "CardInstance..."
  if (/^CardInstance/.test(id)) return false;
  return true;
}

function generateXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;

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

    // Check next siblings too to see if index is needed
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
