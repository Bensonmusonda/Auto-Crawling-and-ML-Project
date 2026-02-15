// Initialize Config Manager
const configManager = new ConfigManager();
let currentSelection = null;
let isPicking = false;
let currentStep = 'setup';

// DOM Elements
const steps = {
  setup: document.getElementById('step-setup'),
  container: document.getElementById('step-container'),
  fields: document.getElementById('step-fields'),
  advanced: document.getElementById('step-advanced'),
  export: document.getElementById('step-export')
};

const elements = {
  // Header
  currentUrl: document.getElementById('currentUrl'),
  
  // Setup step
  datasetName: document.getElementById('datasetName'),
  summaryUrl: document.getElementById('summaryUrl'),
  crawlMode: document.getElementById('crawlMode'),
  fieldCount: document.getElementById('fieldCount'),
  btnNextToContainer: document.getElementById('btnNextToContainer'),
  
  // Container step
  containerStatus: document.getElementById('containerStatus'),
  containerSelectorDisplay: document.getElementById('containerSelectorDisplay'),
  containerCountDisplay: document.getElementById('containerCountDisplay'),
  btnPickContainer: document.getElementById('btnPickContainer'),
  btnClearContainer: document.getElementById('btnClearContainer'),
  btnSkipContainer: document.getElementById('btnSkipContainer'),
  btnNextToFields: document.getElementById('btnNextToFields'),
  
  // Fields step
  fieldSelectionPanel: document.getElementById('fieldSelectionPanel'),
  fieldNameInput: document.getElementById('fieldNameInput'),
  textPreview: document.getElementById('textPreview'),
  selectorOptions: document.getElementById('selectorOptions'),
  btnAddField: document.getElementById('btnAddField'),
  btnCancelField: document.getElementById('btnCancelField'),
  fieldList: document.getElementById('fieldList'),
  emptyFieldsState: document.getElementById('emptyFieldsState'),
  btnPickField: document.getElementById('btnPickField'),
  btnBackToContainer: document.getElementById('btnBackToContainer'),
  btnPreviewData: document.getElementById('btnPreviewData'),
  btnNextToAdvanced: document.getElementById('btnNextToAdvanced'),
  dataPreviewSection: document.getElementById('dataPreviewSection'),
  dataPreviewContent: document.getElementById('dataPreviewContent'),
  btnClosePreview: document.getElementById('btnClosePreview'),
  
  // Advanced step
  paginationStatus: document.getElementById('paginationStatus'),
  paginationSelectorDisplay: document.getElementById('paginationSelectorDisplay'),
  maxPagesDisplay: document.getElementById('maxPagesDisplay'),
  btnPickPagination: document.getElementById('btnPickPagination'),
  btnClearPagination: document.getElementById('btnClearPagination'),
  linkStatus: document.getElementById('linkStatus'),
  linkSelectorDisplay: document.getElementById('linkSelectorDisplay'),
  linkCountDisplay: document.getElementById('linkCountDisplay'),
  btnPickLink: document.getElementById('btnPickLink'),
  btnClearLink: document.getElementById('btnClearLink'),
  btnBackToFields: document.getElementById('btnBackToFields'),
  btnNextToExport: document.getElementById('btnNextToExport'),
  
  // Export step
  exportSummary: document.getElementById('exportSummary'),
  btnTestAll: document.getElementById('btnTestAll'),
  btnExport: document.getElementById('btnExport'),
  btnClearAll: document.getElementById('btnClearAll'),
  btnBackToAdvanced: document.getElementById('btnBackToAdvanced'),
  
  // Global
  statusMessage: document.getElementById('statusMessage')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load configuration from storage
  await configManager.loadFromStorage();
  
  // Restore wizard step (or default to 'setup' if first time)
  const stored = await chrome.storage.local.get(['currentStep', 'lastSelection', 'selectionType']);
  const startStep = stored.currentStep || 'setup';
  
  // Process any pending selection from when popup was closed
  if (stored.lastSelection && stored.selectionType) {
    if (stored.selectionType === 'containerSelected') {
      handleContainerSelected(stored.lastSelection);
    } else if (stored.selectionType === 'fieldSelected') {
      handleFieldSelected(stored.lastSelection);
    }
    // Clear it so we don't process it again
    chrome.storage.local.remove(['lastSelection', 'selectionType']);
  }
  
  // Get current tab URL
  const tab = await getCurrentTab();
  if (tab) {
    configManager.setStartUrl(tab.url);
    elements.currentUrl.textContent = new URL(tab.url).hostname;
    elements.summaryUrl.textContent = new URL(tab.url).hostname;
  }
  
  // Update UI
  updateSummary();
  renderFieldList();
  updateAdvancedStatus();
  
  // Setup event listeners
  setupEventListeners();
  
  // Navigate to saved step (do this AFTER setting up listeners)
  navigateToStep(startStep);
});

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Wizard navigation
  document.querySelectorAll('.wizard-step').forEach(step => {
    step.addEventListener('click', () => {
      const stepName = step.dataset.step;
      navigateToStep(stepName);
    });
  });
  
  // Setup step
  elements.btnNextToContainer.addEventListener('click', () => navigateToStep('container'));
  
  // Container step
  elements.btnPickContainer.addEventListener('click', () => startPicker('container'));
  elements.btnClearContainer.addEventListener('click', clearContainer);
  elements.btnSkipContainer.addEventListener('click', () => navigateToStep('fields'));
  elements.btnNextToFields.addEventListener('click', () => navigateToStep('fields'));
  
  // Fields step
  elements.btnPickField.addEventListener('click', () => startPicker('field'));
  elements.btnAddField.addEventListener('click', addField);
  elements.btnCancelField.addEventListener('click', cancelFieldSelection);
  elements.btnBackToContainer.addEventListener('click', () => navigateToStep('container'));
  elements.btnPreviewData.addEventListener('click', previewData);
  elements.btnClosePreview.addEventListener('click', closePreview);
  elements.btnNextToAdvanced.addEventListener('click', () => navigateToStep('advanced'));
  
  // Advanced step
  elements.btnPickPagination.addEventListener('click', () => startPicker('pagination'));
  elements.btnClearPagination.addEventListener('click', clearPagination);
  elements.btnPickLink.addEventListener('click', () => startPicker('link'));
  elements.btnClearLink.addEventListener('click', clearLink);
  elements.btnBackToFields.addEventListener('click', () => navigateToStep('fields'));
  elements.btnNextToExport.addEventListener('click', () => navigateToStep('export'));
  
  // Export step
  elements.btnTestAll.addEventListener('click', testAllSelectors);
  elements.btnExport.addEventListener('click', exportConfiguration);
  elements.btnClearAll.addEventListener('click', clearAll);
  elements.btnBackToAdvanced.addEventListener('click', () => navigateToStep('advanced'));
  
  // Dataset name
  elements.datasetName.addEventListener('change', (e) => {
    configManager.setDatasetName(e.target.value);
    configManager.saveToStorage();
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'containerSelected') {
    handleContainerSelected(request.data);
  } else if (request.action === 'fieldSelected') {
    handleFieldSelected(request.data);
  } else if (request.action === 'paginationSelected') {
    handlePaginationSelected(request.data);
  } else if (request.action === 'linkSelected') {
    handleLinkSelected(request.data);
  }
});

// ============================================================================
// WIZARD NAVIGATION
// ============================================================================

function navigateToStep(stepName) {
  // Hide all steps
  Object.keys(steps).forEach(key => {
    steps[key].classList.add('hidden');
  });
  
  // Show target step
  steps[stepName].classList.remove('hidden');
  
  // Update wizard nav
  document.querySelectorAll('.wizard-step').forEach(step => {
    step.classList.remove('active');
    if (step.dataset.step === stepName) {
      step.classList.add('active');
    }
  });
  
  currentStep = stepName;
  
  // Save current step to storage so we remember it when popup reopens
  chrome.storage.local.set({ currentStep: stepName });
  
  // Update export summary if navigating to export
  if (stepName === 'export') {
    updateExportSummary();
  }
}

// ============================================================================
// PICKER CONTROL
// ============================================================================

async function startPicker(mode) {
  isPicking = true;
  const tab = await getCurrentTab();
  
  const containerSelector = configManager.config.container_selector;
  
  chrome.tabs.sendMessage(tab.id, {
    action: 'togglePicker',
    state: true,
    mode: mode,
    container: containerSelector
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Please refresh the page first', 'error');
      isPicking = false;
    } else {
      // Update button states
      updatePickerButtons(mode, true);
      showStatus(`Click on an element on the page to select it`, 'info');
    }
  });
}

async function stopPicker() {
  isPicking = false;
  const tab = await getCurrentTab();
  
  chrome.tabs.sendMessage(tab.id, {
    action: 'togglePicker',
    state: false
  });
  
  updatePickerButtons(null, false);
}

function updatePickerButtons(mode, active) {
  const buttons = {
    container: elements.btnPickContainer,
    field: elements.btnPickField,
    pagination: elements.btnPickPagination,
    link: elements.btnPickLink
  };
  
  Object.keys(buttons).forEach(key => {
    if (key === mode && active) {
      buttons[key].textContent = 'Stop Picking';
      buttons[key].classList.remove('btn-primary');
      buttons[key].classList.add('btn-danger');
    } else {
      buttons[key].textContent = getButtonText(key);
      buttons[key].classList.remove('btn-danger');
      buttons[key].classList.add('btn-primary');
    }
  });
}

function getButtonText(mode) {
  const texts = {
    container: 'Pick Container Element',
    field: 'Pick Field Element',
    pagination: 'Pick Next Button',
    link: 'Pick Detail Link'
  };
  return texts[mode];
}

// ============================================================================
// CONTAINER HANDLING
// ============================================================================

function handleContainerSelected(data) {
  stopPicker();
  
  configManager.setContainerSelector(data.selector);
  configManager.saveToStorage();
  
  elements.containerSelectorDisplay.textContent = data.selector;
  elements.containerCountDisplay.textContent = data.count;
  elements.containerStatus.classList.remove('hidden');
  
  updateSummary();
  showStatus(`Container configured: ${data.count} items found`, 'success');
  
  // Auto-advance to fields step
  navigateToStep('fields');
}

function clearContainer() {
  configManager.clearContainerSelector();
  configManager.saveToStorage();
  
  elements.containerStatus.classList.add('hidden');
  updateSummary();
  showStatus('Container cleared', 'info');
}

// ============================================================================
// FIELD HANDLING
// ============================================================================

function handleFieldSelected(data) {
  stopPicker();
  currentSelection = data;
  
  // Show selection panel
  elements.fieldSelectionPanel.classList.remove('hidden');
  
  // Clear previous input
  elements.fieldNameInput.value = '';
  
  // Display text preview
  elements.textPreview.textContent = data.text || 'No text content';
  
  // Display selector options
  displaySelectorOptions(data);
  
  // Scroll to selection panel
  elements.fieldSelectionPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displaySelectorOptions(data) {
  elements.selectorOptions.innerHTML = '';
  
  // Add context info if in container
  if (data.isInContainer) {
    const info = document.createElement('div');
    info.className = 'info-box info';
    info.style.marginBottom = '10px';
    info.innerHTML = '<strong>Container-Relative Mode:</strong> Selectors are relative to each container item';
    elements.selectorOptions.appendChild(info);
  }
  
  const selectors = [
    { name: 'Primary', key: 'primary', selector: data.selectors.primary },
    { name: 'Simple Class', key: 'simpleClass', selector: data.selectors.simpleClass },
    { name: 'Tag + Class', key: 'tagClass', selector: data.selectors.tagClass },
    { name: 'CSS Path', key: 'cssPath', selector: data.selectors.cssPath },
    { name: 'Descendant', key: 'descendant', selector: data.selectors.descendant },
    { name: 'Data Attribute', key: 'dataAttr', selector: data.selectors.dataAttr },
    { name: 'XPath', key: 'xpath', selector: data.selectors.xpath }
  ];
  
  let hasOptions = false;
  
  selectors.forEach((item, index) => {
    if (!item.selector || item.selector === 'null') return;
    
    const matchCount = data.matchCounts[item.key] || 0;
    const option = createSelectorOption(item, matchCount, index === 0 && !hasOptions, data.containerSelector);
    
    elements.selectorOptions.appendChild(option);
    hasOptions = true;
  });
  
  if (!hasOptions) {
    elements.selectorOptions.innerHTML = '<p style="color: #999; font-size: 12px; text-align: center; padding: 20px;">No selectors available</p>';
  }
}

function createSelectorOption(item, matchCount, isSelected, containerSelector) {
  const div = document.createElement('div');
  div.className = 'selector-option' + (isSelected ? ' selected' : '');
  
  let matchClass = 'none';
  let matchText = '0';
  if (matchCount === 1) {
    matchClass = 'unique';
    matchText = '1';
  } else if (matchCount > 1) {
    matchClass = 'multiple';
    matchText = matchCount.toString();
  }
  
  div.innerHTML = `
    <input type="radio" name="selector" value="${item.key}" ${isSelected ? 'checked' : ''}>
    <div class="selector-info">
      <div class="selector-name">${item.name}</div>
      <div class="selector-text">${escapeHtml(item.selector)}</div>
      <input type="text" class="editable-selector" value="${escapeHtml(item.selector)}" data-key="${item.key}">
    </div>
    <span class="match-count ${matchClass}" title="${matchCount} match(es)">${matchText}</span>
  `;
  
  // Click handler for the option
  div.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') {
      const radio = div.querySelector('input[type="radio"]');
      radio.checked = true;
      document.querySelectorAll('.selector-option').forEach(opt => opt.classList.remove('selected'));
      div.classList.add('selected');
    }
  });
  
  // Live validation on edit
  const editableInput = div.querySelector('.editable-selector');
  const matchBadge = div.querySelector('.match-count');
  
  editableInput.addEventListener('input', async (e) => {
    const newSelector = e.target.value;
    
    // Test selector on page
    const tab = await getCurrentTab();
    chrome.tabs.sendMessage(tab.id, {
      action: 'testSelector',
      selector: newSelector,
      containerSelector: containerSelector
    }, (result) => {
      if (result && result.valid) {
        const count = result.count;
        matchBadge.textContent = count;
        
        if (count === 1) {
          matchBadge.className = 'match-count unique';
        } else if (count > 1) {
          matchBadge.className = 'match-count multiple';
        } else {
          matchBadge.className = 'match-count none';
        }
      } else {
        matchBadge.textContent = 'ERR';
        matchBadge.className = 'match-count none';
      }
    });
  });
  
  return div;
}

async function addField() {
  const fieldName = elements.fieldNameInput.value.trim();
  
  if (!fieldName) {
    showStatus('Please enter a field name', 'error');
    return;
  }
  
  // Validate field name
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
    showStatus('Field name must start with a letter and contain only letters, numbers, and underscores', 'error');
    return;
  }
  
  // Get selected selector
  const selectedOption = elements.selectorOptions.querySelector('.selector-option.selected');
  if (!selectedOption) {
    showStatus('Please select a selector', 'error');
    return;
  }
  
  // Get the (possibly edited) selector value
  const selectorInput = selectedOption.querySelector('.editable-selector');
  const selector = selectorInput.value.trim();
  
  if (!selector) {
    showStatus('Selector cannot be empty', 'error');
    return;
  }
  
  // Add field to config
  try {
    configManager.addField(fieldName, selector);
    configManager.saveToStorage();
    
    showStatus(`Field "${fieldName}" added successfully`, 'success');
    renderFieldList();
    updateSummary();
    
    // Clear selection
    cancelFieldSelection();
    
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function cancelFieldSelection() {
  elements.fieldSelectionPanel.classList.add('hidden');
  currentSelection = null;
}

function renderFieldList() {
  const fields = configManager.getFields();
  const fieldKeys = Object.keys(fields);
  
  if (fieldKeys.length === 0) {
    elements.emptyFieldsState.classList.remove('hidden');
    elements.fieldList.querySelectorAll('.field-item').forEach(item => item.remove());
    return;
  }
  
  elements.emptyFieldsState.classList.add('hidden');
  elements.fieldList.innerHTML = '';
  
  fieldKeys.forEach(fieldName => {
    const selector = fields[fieldName];
    const fieldItem = createFieldItem(fieldName, selector);
    elements.fieldList.appendChild(fieldItem);
  });
}

function createFieldItem(fieldName, selector) {
  const div = document.createElement('div');
  div.className = 'field-item';
  
  div.innerHTML = `
    <div class="field-info">
      <div class="field-name">${escapeHtml(fieldName)}</div>
      <div class="field-selector" title="${escapeHtml(selector)}">${escapeHtml(selector)}</div>
    </div>
    <div class="field-actions">
      <button class="icon-btn" data-action="test" title="Test selector">Test</button>
      <button class="icon-btn" data-action="delete" title="Delete field">Delete</button>
    </div>
  `;
  
  div.querySelector('[data-action="test"]').addEventListener('click', () => testField(fieldName, selector));
  div.querySelector('[data-action="delete"]').addEventListener('click', () => deleteField(fieldName));
  
  return div;
}

async function testField(fieldName, selector) {
  showStatus(`Testing ${fieldName}...`, 'info');
  
  const tab = await getCurrentTab();
  const containerSelector = configManager.config.container_selector;
  
  chrome.tabs.sendMessage(tab.id, {
    action: 'testSelector',
    selector: selector,
    containerSelector: containerSelector
  }, (result) => {
    if (result && result.valid) {
      if (result.count > 0) {
        showStatus(`✓ ${fieldName}: Found ${result.count} match(es)`, 'success');
      } else {
        showStatus(`⚠ ${fieldName}: Selector valid but found 0 matches`, 'warning');
      }
    } else {
      showStatus(`✗ ${fieldName}: ${result.error || 'Invalid selector'}`, 'error');
    }
  });
}

function deleteField(fieldName) {
  if (confirm(`Delete field "${fieldName}"?`)) {
    configManager.removeField(fieldName);
    configManager.saveToStorage();
    renderFieldList();
    updateSummary();
    showStatus(`Field "${fieldName}" deleted`, 'info');
  }
}

async function previewData() {
  const fields = configManager.getFields();
  const fieldKeys = Object.keys(fields);
  
  if (fieldKeys.length === 0) {
    showStatus('No fields to preview', 'error');
    return;
  }
  
  showStatus('Generating preview...', 'info');
  
  const tab = await getCurrentTab();
  const containerSelector = configManager.config.container_selector;
  
  chrome.tabs.sendMessage(tab.id, {
    action: 'previewData',
    fields: fields,
    containerSelector: containerSelector
  }, (result) => {
    if (result && result.success) {
      displayPreview(result.preview, result.totalContainers);
    } else {
      showStatus(`Preview failed: ${result.error}`, 'error');
    }
  });
}

function displayPreview(data, totalContainers) {
  elements.dataPreviewSection.classList.remove('hidden');
  
  if (data.length === 0) {
    elements.dataPreviewContent.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No data extracted</p>';
    return;
  }
  
  // Create table
  const fields = Object.keys(data[0]).filter(k => k !== '_containerIndex');
  
  let html = `<div style="margin-bottom: 8px; font-size: 11px; color: #666;">Showing ${data.length} of ${totalContainers} items</div>`;
  html += '<table class="preview-table"><thead><tr>';
  
  fields.forEach(field => {
    html += `<th>${escapeHtml(field)}</th>`;
  });
  
  html += '</tr></thead><tbody>';
  
  data.forEach(item => {
    html += '<tr>';
    fields.forEach(field => {
      const value = item[field];
      const displayValue = value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '-';
      html += `<td title="${escapeHtml(value || '')}">${escapeHtml(displayValue)}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  
  elements.dataPreviewContent.innerHTML = html;
  elements.dataPreviewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  showStatus('Preview generated successfully', 'success');
}

function closePreview() {
  elements.dataPreviewSection.classList.add('hidden');
}

// ============================================================================
// ADVANCED OPTIONS
// ============================================================================

function handlePaginationSelected(data) {
  stopPicker();
  
  const maxPages = prompt('Maximum pages to crawl:', '5');
  if (!maxPages) return;
  
  configManager.setPagination(data.selector, parseInt(maxPages) || 5, 'selector');
  configManager.saveToStorage();
  
  updateAdvancedStatus();
  showStatus('Pagination configured', 'success');
}

function clearPagination() {
  configManager.clearPagination();
  configManager.saveToStorage();
  updateAdvancedStatus();
  showStatus('Pagination cleared', 'info');
}

function handleLinkSelected(data) {
  stopPicker();
  
  configManager.setLinkSelector(data.selector);
  configManager.saveToStorage();
  
  updateAdvancedStatus();
  updateSummary();
  showStatus(`Link selector configured: ${data.count} links found`, 'success');
}

function clearLink() {
  configManager.clearLinkSelector();
  configManager.saveToStorage();
  updateAdvancedStatus();
  updateSummary();
  showStatus('Link selector cleared', 'info');
}

function updateAdvancedStatus() {
  // Pagination
  if (configManager.config.pagination) {
    elements.paginationSelectorDisplay.textContent = configManager.config.pagination.selector;
    elements.maxPagesDisplay.textContent = configManager.config.pagination.max_pages;
    elements.paginationStatus.classList.remove('hidden');
  } else {
    elements.paginationStatus.classList.add('hidden');
  }
  
  // Link selector
  if (configManager.config.link_selector) {
    elements.linkSelectorDisplay.textContent = configManager.config.link_selector;
    elements.linkStatus.classList.remove('hidden');
    
    // Count links (async)
    getCurrentTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'testSelector',
        selector: configManager.config.link_selector,
        containerSelector: configManager.config.container_selector
      }, (result) => {
        if (result && result.valid) {
          elements.linkCountDisplay.textContent = result.count;
        }
      });
    });
  } else {
    elements.linkStatus.classList.add('hidden');
  }
}

// ============================================================================
// EXPORT
// ============================================================================

function updateExportSummary() {
  const config = configManager.config;
  const fields = Object.keys(config.item_selectors);
  
  let html = '<div class="row"><span class="label">Dataset:</span><span class="value">' + 
    (config.dataset_name || 'Unnamed') + '</span></div>';
  
  html += '<div class="row"><span class="label">Start URL:</span><span class="value">' + 
    (config.start_url ? new URL(config.start_url).hostname : '-') + '</span></div>';
  
  html += '<div class="row"><span class="label">Crawl Type:</span><span class="value">' + 
    config.crawl_type + '</span></div>';
  
  html += '<div class="row"><span class="label">Fields:</span><span class="value">' + 
    fields.length + '</span></div>';
  
  if (config.container_selector) {
    html += '<div class="row"><span class="label">Container:</span><span class="value">Yes</span></div>';
  }
  
  if (config.pagination) {
    html += '<div class="row"><span class="label">Pagination:</span><span class="value">Yes (' + 
      config.pagination.max_pages + ' pages)</span></div>';
  }
  
  if (config.link_selector) {
    html += '<div class="row"><span class="label">List-Detail:</span><span class="value">Yes</span></div>';
  }
  
  elements.exportSummary.innerHTML = html;
}

async function testAllSelectors() {
  const fields = configManager.getFields();
  const fieldKeys = Object.keys(fields);
  
  if (fieldKeys.length === 0) {
    showStatus('No fields to test', 'error');
    return;
  }
  
  showStatus(`Testing ${fieldKeys.length} fields...`, 'info');
  
  const tab = await getCurrentTab();
  const containerSelector = configManager.config.container_selector;
  let passedCount = 0;
  let results = [];
  
  for (const fieldName of fieldKeys) {
    const selector = fields[fieldName];
    
    await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'testSelector',
        selector: selector,
        containerSelector: containerSelector
      }, (result) => {
        if (result && result.valid && result.count > 0) {
          passedCount++;
          results.push(`✓ ${fieldName}: ${result.count}`);
        } else {
          results.push(`✗ ${fieldName}: 0`);
        }
        resolve();
      });
    });
  }
  
  const status = passedCount === fieldKeys.length ? 'success' : 'warning';
  showStatus(`Test complete: ${passedCount}/${fieldKeys.length} passed`, status);
  
  console.log('Test results:', results);
}

function exportConfiguration() {
  try {
    const config = configManager.exportConfig();
    const jsonStr = JSON.stringify(config, null, 2);
    
    navigator.clipboard.writeText(jsonStr).then(() => {
      showStatus('✓ Configuration copied to clipboard!', 'success');
      console.log('Exported config:', config);
    }).catch(err => {
      showStatus('Failed to copy to clipboard', 'error');
      console.error('Export error:', err);
    });
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function clearAll() {
  if (confirm('Clear all configuration? This cannot be undone.')) {
    configManager.reset();
    configManager.saveToStorage();
    
    renderFieldList();
    updateSummary();
    updateAdvancedStatus();
    
    elements.containerStatus.classList.add('hidden');
    elements.dataPreviewSection.classList.add('hidden');
    
    navigateToStep('setup');
    showStatus('Configuration cleared', 'info');
  }
}

// ============================================================================
// UI HELPERS
// ============================================================================

function updateSummary() {
  const summary = configManager.getSummary();
  
  elements.fieldCount.textContent = summary.fieldCount;
  elements.crawlMode.textContent = summary.mode;
  
  if (elements.datasetName.value === '') {
    elements.datasetName.value = summary.datasetName === 'Unnamed' ? '' : summary.datasetName;
  }
}

function showStatus(message, type = 'info') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message show info-box ${type}`;
  
  setTimeout(() => {
    elements.statusMessage.classList.remove('show');
  }, 5000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
