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
exports.CodeReviewService = void 0;
const core = __importStar(require("@actions/core"));
const github_service_1 = require("./github-service");
const openai_service_1 = require("./openai-service");
class CodeReviewService {
    config;
    githubService;
    openaiService;
    constructor(config) {
        // Ensure we have a valid config object
        this.config = this.validateConfig(config);
        this.openaiService = new openai_service_1.OpenAIService(this.config);
        this.githubService = new github_service_1.GitHubService(this.config, this.openaiService);
    }
    /**
     * Validates and ensures config has required properties
     * @param config Input configuration
     * @returns Validated configuration
     */
    validateConfig(config) {
        const validatedConfig = { ...config };
        // Ensure we have default values for required properties
        if (!Array.isArray(validatedConfig.rules)) {
            validatedConfig.rules = [];
        }
        if (!Array.isArray(validatedConfig.excludeFiles)) {
            validatedConfig.excludeFiles = [];
        }
        return validatedConfig;
    }
    /**
     * Runs the code review process
     */
    async runCodeReview() {
        try {
            const prNumber = this.githubService.getPRNumber();
            if (!prNumber) {
                core.setFailed('This action must be run in a pull request context.');
                return;
            }
            // Create in-progress check run
            const checkRunId = await this.githubService.createInProgressCheckRun();
            core.info(`Created check run with ID: ${checkRunId}`);
            // Get changed files with context
            const changedFiles = await this.githubService.getChangedFiles(prNumber);
            core.info(`Found ${changedFiles.length} changed files to review.`);
            if (changedFiles.length === 0) {
                await this.githubService.completeCheckRun(checkRunId, 'success', 'No files to review based on configuration filters.');
                return;
            }
            // Review each file
            const allComments = [];
            for (const file of changedFiles) {
                core.info(`Reviewing file: ${file.filename}`);
                // Skip files without changes to review
                if (!file.patch && !file.changedContent) {
                    core.info(`Skipping file ${file.filename} - no changes to review.`);
                    continue;
                }
                const comments = await this.reviewEnhancedFile(file);
                allComments.push(...comments);
            }
            // Add review comments to PR
            await this.githubService.addReviewComments(prNumber, allComments);
            // Complete check run
            await this.githubService.completeCheckRun(checkRunId, 'success', `Completed AI code review with ${allComments.length} comments.`);
        }
        catch (error) {
            core.error(`Error running code review: ${error instanceof Error ? error.message : String(error)}`);
            core.setFailed(`Code review failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Reviews an enhanced file with changes and context
     * @param file The enhanced file to review
     * @returns Comments for the file
     */
    async reviewEnhancedFile(file) {
        try {
            // Initial analysis using the enhanced file
            core.info(`Analyzing changes in file ${file.filename}...`);
            const initialAnalysis = await this.openaiService.analyzeCodeChanges(file);
            // Start conversation for agentic review
            const conversation = [
                { role: 'user', content: `Please review the changes to ${file.filename}` },
                { role: 'assistant', content: initialAnalysis }
            ];
            // Make follow-up inquiries (agentic mode)
            core.info(`Making follow-up inquiries for ${file.filename}...`);
            const followUpAnalysis = await this.openaiService.makeFollowUpInquiry(initialAnalysis, file, conversation);
            // Parse comments and feedback
            core.info(`Parsing review results for ${file.filename}...`);
            const comments = this.parseReviewFeedback(file, initialAnalysis, followUpAnalysis);
            return comments;
        }
        catch (error) {
            core.error(`Error reviewing file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    // For backward compatibility
    async reviewFile(file) {
        return this.reviewEnhancedFile(file);
    }
    /**
     * Detects the programming language from a filename
     * @param filename The filename
     * @returns The detected language
     */
    detectLanguage(filename) {
        const extension = filename.split('.').pop()?.toLowerCase();
        const languageMap = {
            ts: 'TypeScript',
            js: 'JavaScript',
            tsx: 'TypeScript React',
            jsx: 'JavaScript React',
            py: 'Python',
            go: 'Go',
            java: 'Java',
            rb: 'Ruby',
            php: 'PHP',
            cs: 'C#',
            c: 'C',
            cpp: 'C++',
            h: 'C/C++ Header',
            hpp: 'C++ Header',
            sh: 'Shell',
            md: 'Markdown',
            yml: 'YAML',
            yaml: 'YAML',
            json: 'JSON',
            css: 'CSS',
            html: 'HTML',
        };
        return extension ? (languageMap[extension] || 'Unknown') : 'Unknown';
    }
    /**
     * Parses review feedback and extracts comments
     * @param file The file being reviewed
     * @param initialAnalysis Initial analysis from the AI
     * @param followUpAnalysis Follow-up analysis from the AI
     * @returns Extracted comments
     */
    parseReviewFeedback(file, initialAnalysis, followUpAnalysis) {
        const comments = [];
        // For now, we'll create a single comment with the combined analysis
        // In a more advanced implementation, we could parse the AI response more granularly
        // and map comments to specific line numbers in the changed content
        comments.push({
            path: file.filename,
            body: `## AI Code Review Feedback\n\n${initialAnalysis}\n\n### Follow-up Analysis\n\n${followUpAnalysis}`,
            confidence: 100 // High confidence for the overall analysis
        });
        return comments;
    }
}
exports.CodeReviewService = CodeReviewService;
