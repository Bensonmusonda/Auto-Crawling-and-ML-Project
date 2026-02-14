/**
 * ConfigManager - Manages crawling configurations matching backend CrawlRequest schema
 */
class ConfigManager {
    constructor() {
        this.config = {
            job_id: null,
            dataset_name: "",
            start_url: "",
            crawl_type: "flat", // "flat" or "list-detail"
            item_selectors: {},
            container_selector: null,
            link_selector: null,
            pagination: null
        };
    }

    // Add field to item_selectors
    addField(fieldName, selector) {
        if (!fieldName || !selector) {
            throw new Error("Field name and selector are required");
        }
        if (this.config.item_selectors[fieldName]) {
            throw new Error(`Field "${fieldName}" already exists`);
        }
        this.config.item_selectors[fieldName] = selector;
        return true;
    }

    // Remove field from item_selectors
    removeField(fieldName) {
        if (this.config.item_selectors[fieldName]) {
            delete this.config.item_selectors[fieldName];
            return true;
        }
        return false;
    }

    // Update existing field
    updateField(fieldName, newSelector) {
        if (!this.config.item_selectors[fieldName]) {
            throw new Error(`Field "${fieldName}" does not exist`);
        }
        this.config.item_selectors[fieldName] = newSelector;
        return true;
    }

    // Get all fields
    getFields() {
        return { ...this.config.item_selectors };
    }

    // Set container selector for flat mode with repeating items
    setContainerSelector(selector) {
        this.config.container_selector = selector;
        this.config.crawl_type = "flat";
    }

    // Clear container selector
    clearContainerSelector() {
        this.config.container_selector = null;
    }

    // Set link selector for list-detail mode
    setLinkSelector(selector) {
        this.config.link_selector = selector;
        this.config.crawl_type = "list-detail";
    }

    // Clear link selector
    clearLinkSelector() {
        this.config.link_selector = null;
        // Revert to flat mode if no link selector
        if (this.config.crawl_type === "list-detail") {
            this.config.crawl_type = "flat";
        }
    }

    // Set pagination config
    setPagination(selector, maxPages = 5, method = "selector") {
        this.config.pagination = {
            selector: selector,
            max_pages: maxPages,
            method: method // "selector" or "numeric"
        };
    }

    // Clear pagination
    clearPagination() {
        this.config.pagination = null;
    }

    // Set dataset name
    setDatasetName(name) {
        this.config.dataset_name = name;
    }

    // Set start URL
    setStartUrl(url) {
        this.config.start_url = url;
    }

    // Export to backend-compatible JSON
    exportConfig() {
        const validation = this.validate();
        if (!validation.valid) {
            throw new Error(`Invalid configuration: ${validation.errors.join(", ")}`);
        }

        return {
            job_id: this.config.job_id || this.generateJobId(),
            dataset_name: this.config.dataset_name || `dataset_${Date.now()}`,
            start_url: this.config.start_url,
            crawl_type: this.config.crawl_type,
            item_selectors: this.config.item_selectors,
            container_selector: this.config.container_selector,
            link_selector: this.config.link_selector,
            pagination: this.config.pagination
        };
    }

    // Generate UUID for job_id
    generateJobId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Import from JSON
    importConfig(jsonData) {
        if (typeof jsonData === 'string') {
            jsonData = JSON.parse(jsonData);
        }

        // Validate required fields
        if (!jsonData.start_url || !jsonData.item_selectors) {
            throw new Error("Invalid configuration: missing required fields");
        }

        this.config = {
            job_id: jsonData.job_id || null,
            dataset_name: jsonData.dataset_name || "",
            start_url: jsonData.start_url,
            crawl_type: jsonData.crawl_type || "flat",
            item_selectors: jsonData.item_selectors || {},
            container_selector: jsonData.container_selector || null,
            link_selector: jsonData.link_selector || null,
            pagination: jsonData.pagination || null
        };
    }

    // Reset to empty config
    reset() {
        this.config = {
            job_id: null,
            dataset_name: "",
            start_url: "",
            crawl_type: "flat",
            item_selectors: {},
            container_selector: null,
            link_selector: null,
            pagination: null
        };
    }

    // Save to chrome storage
    async saveToStorage() {
        try {
            await chrome.storage.local.set({
                currentConfig: this.config,
                lastUpdated: new Date().toISOString()
            });
            return true;
        } catch (error) {
            console.error("Failed to save config:", error);
            return false;
        }
    }

    // Load from chrome storage
    async loadFromStorage() {
        try {
            const result = await chrome.storage.local.get(['currentConfig']);
            if (result.currentConfig) {
                this.config = result.currentConfig;
                return true;
            }
            return false;
        } catch (error) {
            console.error("Failed to load config:", error);
            return false;
        }
    }

    // Validate configuration
    validate() {
        const errors = [];

        if (!this.config.start_url) {
            errors.push("start_url is required");
        }

        if (Object.keys(this.config.item_selectors).length === 0) {
            errors.push("At least one field in item_selectors is required");
        }

        if (this.config.crawl_type === "list-detail" && !this.config.link_selector) {
            errors.push("link_selector is required for list-detail crawl type");
        }

        // Validate field names (should be valid identifiers)
        for (const fieldName of Object.keys(this.config.item_selectors)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
                errors.push(`Invalid field name: "${fieldName}". Use only letters, numbers, and underscores, starting with a letter.`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Get config summary for display
    getSummary() {
        const fieldCount = Object.keys(this.config.item_selectors).length;
        const mode = this.config.crawl_type;
        const hasContainer = !!this.config.container_selector;
        const hasPagination = !!this.config.pagination;

        return {
            fieldCount,
            mode,
            hasContainer,
            hasPagination,
            datasetName: this.config.dataset_name || "Unnamed",
            url: this.config.start_url
        };
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigManager;
}
