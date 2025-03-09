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
exports.GitHubService = void 0;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const minimatch_1 = require("minimatch");
class GitHubService {
    octokit;
    config;
    context;
    openaiService;
    constructor(config, openaiService) {
        const token = core.getInput('github-token');
        if (!token) {
            throw new Error('GitHub token is required');
        }
        this.octokit = github.getOctokit(token);
        this.config = this.validateConfig(config);
        this.context = github.context;
        this.openaiService = openaiService;
    }
    /**
     * Validates and ensures config has required properties
     * @param config Input configuration
     * @returns Validated configuration
     */
    validateConfig(config) {
        const validatedConfig = { ...config };
        // Ensure rules array exists
        if (!Array.isArray(validatedConfig.rules)) {
            core.warning('No rules found in configuration. Using empty rules array.');
            validatedConfig.rules = [];
        }
        // Ensure excludeFiles array exists
        if (!Array.isArray(validatedConfig.excludeFiles)) {
            core.warning('No excludeFiles found in configuration. Using empty excludeFiles array.');
            validatedConfig.excludeFiles = [];
        }
        return validatedConfig;
    }
    /**
     * Gets the PR number from the GitHub context
     * @returns The PR number or undefined if not in a PR context
     */
    getPRNumber() {
        const pullRequest = this.context.payload.pull_request;
        if (!pullRequest) {
            core.warning('This action is not running in a pull request context.');
            return undefined;
        }
        return pullRequest.number;
    }
    /**
     * Gets the files changed in the PR with enhanced information
     * @param prNumber Pull request number
     * @returns List of enhanced files changed in the PR
     */
    async getChangedFiles(prNumber) {
        try {
            const { owner, repo } = this.context.repo;
            const response = await this.octokit.pulls.listFiles({
                owner,
                repo,
                pull_number: prNumber,
            });
            const files = response.data;
            // Filter files based on rules and exclude patterns
            const filteredFiles = files.filter((file) => {
                // First check if file matches any exclude patterns
                const excluded = this.config.excludeFiles.some((pattern) => (0, minimatch_1.minimatch)(file.filename, pattern));
                if (excluded) {
                    return false;
                }
                // Then check if file matches any rule's include patterns
                const included = this.config.rules.some(rule => rule.include.some((pattern) => (0, minimatch_1.minimatch)(file.filename, pattern)));
                return included;
            });
            // Enhance filtered files with additional context
            const enhancedFiles = [];
            for (const file of filteredFiles) {
                try {
                    // Get the full file content for context
                    file.fullContent = await this.getFileContent(file.filename);
                    // Extract just the changed content based on patch
                    if (file.patch) {
                        const { changedContent, changeMap } = this.extractChangedContent(file.patch, file.fullContent);
                        file.changedContent = changedContent;
                        file.changeMap = changeMap;
                    }
                    enhancedFiles.push(file);
                }
                catch (error) {
                    core.warning(`Could not enhance file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
                    // Still include the file even if we couldn't enhance it
                    enhancedFiles.push(file);
                }
            }
            return enhancedFiles;
        }
        catch (error) {
            core.error(`Error getting changed files: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Extract the changed content from a patch
     * @param patch The git patch
     * @param fullContent The full file content
     * @returns The changed content and a map of line numbers
     */
    extractChangedContent(patch, fullContent) {
        const changeMap = {
            additions: [],
            deletions: []
        };
        // Extract only the added/changed lines (starting with +)
        // Remove the first line which is just the file path info and hunk headers
        const changedLines = patch
            .split('\n')
            .filter(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                // This is an added line, extract the line number if possible
                const match = line.match(/^.*@@ -\d+,\d+ \+(\d+),\d+ @@/);
                if (match && match[1]) {
                    changeMap.additions.push(parseInt(match[1], 10));
                }
                return true;
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                // This is a deleted line, extract the line number if possible
                const match = line.match(/^.*@@ -(\d+),\d+ \+\d+,\d+ @@/);
                if (match && match[1]) {
                    changeMap.deletions.push(parseInt(match[1], 10));
                }
                return false; // Don't include deletions in the content
            }
            else if (line.startsWith('@@')) {
                // This is a hunk header, keep it for context
                return true;
            }
            return false; // Skip other lines (context lines)
        })
            .map(line => {
            // Remove the leading + from added lines
            if (line.startsWith('+') && !line.startsWith('+++')) {
                return line.substring(1);
            }
            return line;
        })
            .join('\n');
        return {
            changedContent: changedLines,
            changeMap
        };
    }
    /**
     * Gets the file content for a specific file
     * @param path Path to the file
     * @returns Content of the file
     */
    async getFileContent(path) {
        try {
            const { owner, repo } = this.context.repo;
            const response = await this.octokit.repos.getContent({
                owner,
                repo,
                path,
                ref: this.context.payload.pull_request?.head.sha,
            });
            // Check if we got a file (not a directory)
            if ('content' in response.data && 'encoding' in response.data) {
                const content = Buffer.from(response.data.content, response.data.encoding).toString();
                return content;
            }
            else {
                throw new Error(`Could not get content for ${path}`);
            }
        }
        catch (error) {
            core.error(`Error getting file content: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Creates a check run to indicate the code review is in progress
     * @returns The check run ID
     */
    async createInProgressCheckRun() {
        try {
            const { owner, repo } = this.context.repo;
            const response = await this.octokit.checks.create({
                owner,
                repo,
                name: 'AI Code Review',
                head_sha: this.context.payload.pull_request?.head.sha || this.context.sha,
                status: 'in_progress',
                started_at: new Date().toISOString(),
            });
            return response.data.id;
        }
        catch (error) {
            core.error(`Error creating check run: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Updates the check run with the review results
     * @param checkRunId Check run ID
     * @param conclusion The conclusion of the review (success, failure, etc.)
     * @param summary Summary of the review
     */
    async completeCheckRun(checkRunId, conclusion, summary) {
        try {
            const { owner, repo } = this.context.repo;
            await this.octokit.checks.update({
                owner,
                repo,
                check_run_id: checkRunId,
                status: 'completed',
                conclusion,
                completed_at: new Date().toISOString(),
                output: {
                    title: 'AI Code Review Results',
                    summary,
                },
            });
        }
        catch (error) {
            core.error(`Error completing check run: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Adds comments to the PR based on the AI review
     * @param prNumber Pull request number
     * @param comments Comments to add
     */
    async addReviewComments(prNumber, comments) {
        try {
            const { owner, repo } = this.context.repo;
            // Filter comments based on confidence threshold
            const filteredComments = comments.filter(comment => comment.confidence >= this.openaiService.getCommentThreshold());
            if (filteredComments.length === 0) {
                core.info('No comments to add based on confidence threshold.');
                return;
            }
            // Create review with comments
            await this.octokit.pulls.createReview({
                owner,
                repo,
                pull_number: prNumber,
                commit_id: this.context.payload.pull_request?.head.sha || '',
                event: 'COMMENT',
                comments: filteredComments.map(comment => ({
                    path: comment.path,
                    line: comment.line,
                    body: comment.body,
                })),
            });
            core.info(`Added ${filteredComments.length} review comments to PR #${prNumber}`);
        }
        catch (error) {
            core.error(`Error adding review comments: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
exports.GitHubService = GitHubService;
