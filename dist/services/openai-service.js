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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIService = void 0;
const core = __importStar(require("@actions/core"));
const openai_1 = __importDefault(require("openai"));
const minimatch_1 = require("minimatch");
class OpenAIService {
    openai;
    config;
    model;
    commentThreshold;
    maxTokens;
    temperature;
    constructor(config) {
        const apiKey = core.getInput('openai-api-key');
        if (!apiKey) {
            throw new Error('OpenAI API key is required');
        }
        this.openai = new openai_1.default({
            apiKey: apiKey
        });
        this.config = config;
        // Use inputs from GitHub Action or default values
        this.model = core.getInput('model') || 'gpt-4-turbo';
        this.commentThreshold = parseInt(core.getInput('comment-threshold') || '50', 10);
        this.maxTokens = 4096;
        this.temperature = 0.7;
        // For backward compatibility - check if config has legacy model properties
        this.migrateLegacyConfig(config);
    }
    /**
     * Migrates legacy configuration if present
     * @param config The configuration object
     */
    migrateLegacyConfig(config) {
        // Check if the config has legacy model properties
        if ('model' in config && typeof config.model === 'string') {
            core.info('Detected legacy model configuration. Using model from config file.');
            this.model = config.model;
        }
        if ('commentThreshold' in config && typeof config.commentThreshold === 'number') {
            core.info('Detected legacy commentThreshold configuration. Using threshold from config file.');
            this.commentThreshold = config.commentThreshold;
        }
        if ('maxTokens' in config && typeof config.maxTokens === 'number') {
            this.maxTokens = config.maxTokens;
        }
        if ('temperature' in config && typeof config.temperature === 'number') {
            this.temperature = config.temperature;
        }
        // Check for legacy promptRules
        if ('promptRules' in config && typeof config.promptRules === 'object') {
            core.warning('Detected legacy promptRules configuration. Please update your config file to use the new rules format.');
        }
    }
    /**
     * Get the comment threshold for filtering comments
     */
    getCommentThreshold() {
        return this.commentThreshold;
    }
    /**
     * Find the appropriate review rule for a file
     * @param filename The filename to match against rules
     * @returns The matched rule or undefined if no rule matches
     */
    findMatchingRule(filename) {
        return this.config.rules.find(rule => {
            return rule.include.some(pattern => (0, minimatch_1.minimatch)(filename, pattern));
        });
    }
    /**
     * Analyzes code changes using the OpenAI API with context
     * @param file The enhanced PR file with changes and context
     * @returns Analysis results from the AI
     */
    async analyzeCodeChanges(file) {
        try {
            // Find the matching rule for this file
            const matchingRule = this.findMatchingRule(file.filename);
            if (!matchingRule) {
                core.warning(`No matching review rule found for ${file.filename}. Using generic prompt.`);
                return this.analyzeWithGenericPrompt(file);
            }
            const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
                'Focus specifically on the changes in this pull request, not the entire file. ' +
                'Analyze the code changes and provide constructive feedback. ' +
                'Be specific and actionable in your feedback, explaining why a change is recommended. ' +
                'For each issue, rate its severity (low, medium, high) and provide a suggested fix if possible.';
            let userPrompt = `${matchingRule.prompt}\n\n`;
            // Add the changed content focus
            userPrompt += `FOCUS ON THESE SPECIFIC CHANGES in file ${file.filename}:\n\n`;
            userPrompt += file.changedContent ? `\`\`\`\n${file.changedContent}\n\`\`\`\n\n` :
                (file.patch ? `\`\`\`\n${file.patch}\n\`\`\`\n\n` : '');
            // Add the full file context
            if (file.fullContent) {
                userPrompt += `FULL FILE CONTEXT (for reference only, focus your review on the changes above):\n\n`;
                userPrompt += `\`\`\`\n${file.fullContent}\n\`\`\`\n\n`;
            }
            userPrompt += 'Please provide specific, actionable feedback with reasoning focused only on the changed code. ' +
                'For each issue, include a severity rating and a suggested fix if possible.';
            core.debug(`Using model: ${this.model}`);
            core.debug(`Using rule prompt for file type: ${file.filename}`);
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: this.maxTokens,
                temperature: this.temperature,
            });
            return response.choices[0]?.message.content || 'No feedback provided.';
        }
        catch (error) {
            core.error(`Error calling OpenAI API: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Analyzes with a generic prompt when no specific rule matches
     * @param file The enhanced PR file
     * @returns Analysis results from the AI
     */
    async analyzeWithGenericPrompt(file) {
        const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
            'Focus specifically on the changes in this pull request, not the entire file. ' +
            'Analyze the code changes and provide constructive feedback. ' +
            'Focus on code quality, potential bugs, security issues, performance concerns, and best practices. ' +
            'Be specific and actionable in your feedback, explaining why a change is recommended. ' +
            'For each issue, rate its severity (low, medium, high) and provide a suggested fix if possible.';
        let userPrompt = `Please review the following code changes in file ${file.filename}:\n\n`;
        // Add the changed content focus
        userPrompt += `FOCUS ON THESE SPECIFIC CHANGES:\n\n`;
        userPrompt += file.changedContent ? `\`\`\`\n${file.changedContent}\n\`\`\`\n\n` :
            (file.patch ? `\`\`\`\n${file.patch}\n\`\`\`\n\n` : '');
        // Add the full file context
        if (file.fullContent) {
            userPrompt += `FULL FILE CONTEXT (for reference only, focus your review on the changes above):\n\n`;
            userPrompt += `\`\`\`\n${file.fullContent}\n\`\`\`\n\n`;
        }
        userPrompt += 'Provide specific, actionable feedback with reasoning focused only on the changed code. ' +
            'For each issue, include a severity rating and a suggested fix if possible.';
        const response = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: this.maxTokens,
            temperature: this.temperature,
        });
        return response.choices[0]?.message.content || 'No feedback provided.';
    }
    /**
     * Makes follow-up inquiries for agentic review mode, focusing on changes
     * @param initialAnalysis Initial analysis from the AI
     * @param file The enhanced PR file
     * @param conversation Previous conversation history
     * @returns Follow-up analysis
     */
    async makeFollowUpInquiry(initialAnalysis, file, conversation) {
        try {
            // Find the matching rule for this file
            const matchingRule = this.findMatchingRule(file.filename);
            const systemPrompt = 'You are an expert code reviewer with extensive experience in software development. ' +
                'Focus specifically on the changes in this pull request, not the entire file. ' +
                'Analyze the code changes and provide constructive feedback. ' +
                'Be specific and actionable in your feedback, explaining why a change is recommended.';
            // Build the conversation history
            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversation,
                {
                    role: 'user',
                    content: matchingRule
                        ? `Based on your initial analysis of the changes to ${file.filename} and the specific review focus (${matchingRule.prompt.substring(0, 100)}...), do you need any clarification or would you like to examine any specific part of the changed code more deeply?`
                        : `Based on your initial analysis of the changes to ${file.filename}, do you need any clarification or would you like to examine any specific part of the changed code more deeply?`
                }
            ];
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: messages,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
            });
            return response.choices[0]?.message.content || 'No further inquiries.';
        }
        catch (error) {
            core.error(`Error making follow-up inquiry: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    // Keep the old methods for backward compatibility until we fully update all code
    async analyzeCode(codeChanges, filename, context) {
        core.warning('analyzeCode method is deprecated, use analyzeCodeChanges instead');
        const mockFile = {
            filename: filename,
            status: 'modified',
            additions: 0,
            deletions: 0,
            changes: 0,
            patch: codeChanges,
            blob_url: '',
            raw_url: '',
            contents_url: '',
            fullContent: context
        };
        return this.analyzeCodeChanges(mockFile);
    }
}
exports.OpenAIService = OpenAIService;
