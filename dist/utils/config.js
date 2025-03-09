"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const fs = __importStar(require("fs"));
const core = __importStar(require("@actions/core"));
const yaml = __importStar(require("js-yaml"));
const default_config_1 = require("../config/default-config");
/**
 * Loads and merges the configuration from the config file.
 * If the file doesn't exist, it returns the default config.
 */
async function loadConfig() {
    try {
        const configPath = core.getInput('config-path') || '.github/code-review-config.yml';
        // Check if the file exists
        if (!fs.existsSync(configPath)) {
            core.info(`Config file not found at ${configPath}, using default configuration.`);
            return {
                ...default_config_1.defaultConfig
            };
        }
        // Read and parse the YAML file
        const configContent = fs.readFileSync(configPath, 'utf8');
        const userConfig = yaml.load(configContent);
        // Merge with default config
        const mergedConfig = {
            ...default_config_1.defaultConfig,
            ...userConfig,
            // Ensure rules from both configurations are merged properly
            rules: [
                ...(userConfig.rules || []),
                // Include default rules that don't overlap with user rules
                ...(default_config_1.defaultConfig.rules.filter(defaultRule => !(userConfig.rules || []).some(userRule => JSON.stringify(userRule.include.sort()) === JSON.stringify(defaultRule.include.sort()))))
            ],
            // Include all exclude filters from both configs
            excludeFiles: [
                ...(userConfig.excludeFiles || []),
                ...default_config_1.defaultConfig.excludeFiles.filter(pattern => !(userConfig.excludeFiles || []).includes(pattern))
            ]
        };
        return mergedConfig;
    }
    catch (error) {
        core.warning(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
        return default_config_1.defaultConfig;
    }
}
