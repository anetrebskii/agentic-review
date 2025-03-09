import * as core from '@actions/core';
import * as github from '@actions/github';
import { CodeReviewConfig } from '../config/default-config';
import { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';
import { OpenAIService } from './openai-service';

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url: string;
  raw_url: string;
  contents_url: string;
}

export interface CodeReviewComment {
  path: string;
  line?: number;
  position?: number;
  body: string;
  confidence: number;
}

/**
 * Enhanced version of PullRequestFile with contextual information
 */
export interface EnhancedPRFile extends PullRequestFile {
  fullContent?: string;     // The full file content for context
  changedContent?: string;  // Only the changed lines
  changeMap?: {            // Map of line numbers to indicate additions/deletions
    additions: number[];
    deletions: number[];
  };
}

type GitHubOctokit = ReturnType<typeof github.getOctokit>;

export class GitHubService {
  private octokit: GitHubOctokit;
  private config: CodeReviewConfig;
  private context: typeof github.context;
  private openaiService: OpenAIService;
  
  constructor(config: CodeReviewConfig, openaiService: OpenAIService) {
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
  private validateConfig(config: any): CodeReviewConfig {
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
    
    return validatedConfig as CodeReviewConfig;
  }

  /**
   * Gets the PR number from the GitHub context
   * @returns The PR number or undefined if not in a PR context
   */
  getPRNumber(): number | undefined {
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
  async getChangedFiles(prNumber: number): Promise<EnhancedPRFile[]> {
    try {
      const { owner, repo } = this.context.repo;
      const response = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const filesWithContent = await Promise.all(
        response.data.map(async (file) => {
          const enhancedFile: EnhancedPRFile = {
            ...file,
          };

          if (file.patch) {
            try {
              // Get full content for context if available
              if (file.status !== 'removed') {
                enhancedFile.fullContent = await this.getFileContent(file.filename);
              }
              
              const { changedContent, changeMap } = this.extractChangedContent(file.patch, enhancedFile.fullContent);
              enhancedFile.changedContent = changedContent;
              enhancedFile.changeMap = changeMap;
            } catch (error) {
              core.warning(`Error processing file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          return enhancedFile;
        })
      );

      return filesWithContent;
    } catch (error) {
      core.error(`Error fetching PR files: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Extract the changed content from a patch
   * @param patch The git patch
   * @param fullContent The full file content
   * @returns The changed content and a map of line numbers
   */
  private extractChangedContent(patch: string, fullContent?: string): { changedContent: string, changeMap: { additions: number[], deletions: number[] } } {
    const changeMap = {
      additions: [] as number[],
      deletions: [] as number[]
    };

    // Parse the patch to extract hunk information
    const hunks: { startLine: number; content: string[] }[] = [];
    let currentHunk: { startLine: number; content: string[] } | null = null;
    let currentLineNumber = 0;

    const patchLines = patch.split('\n');
    
    for (let i = 0; i < patchLines.length; i++) {
      const line = patchLines[i];
      
      if (line.startsWith('@@')) {
        // Parse the hunk header: @@ -origStart,origLines +newStart,newLines @@
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          // Start a new hunk
          currentLineNumber = parseInt(match[1], 10);
          
          if (currentHunk) {
            hunks.push(currentHunk);
          }
          
          currentHunk = {
            startLine: currentLineNumber,
            content: [line] // Include the hunk header
          };
        }
      } else if (currentHunk) {
        // Handle content lines
        if (line.startsWith('+') && !line.startsWith('+++')) {
          // This is an added/modified line
          changeMap.additions.push(currentLineNumber);
          // Store the line without the leading + but with the line number
          currentHunk.content.push(`${currentLineNumber}: ${line.substring(1)}`);
          currentLineNumber++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          // This is a deleted line - track it but don't include in content
          changeMap.deletions.push(currentLineNumber);
        } else if (!line.startsWith('---') && !line.startsWith('+++')) {
          // This is a context line (not added or deleted)
          // We still increment the line number but don't include it in the content
          currentLineNumber++;
        }
      }
    }
    
    // Add the last hunk if it exists
    if (currentHunk) {
      hunks.push(currentHunk);
    }
    
    // Combine all hunks into the final changed content, preserving line structure
    const changedContent = hunks.map(hunk => {
      return `@@ Starting at line ${hunk.startLine} @@\n${hunk.content.slice(1).join('\n')}`;
    }).join('\n\n');

    return { 
      changedContent,
      changeMap
    };
  }

  /**
   * Calculate the position in the diff for a given line number in a file
   * @param patch The git patch
   * @param lineNumber The line number in the file
   * @returns The position in the diff or undefined if not found
   */
  private calculatePositionFromLine(patch: string, lineNumber: number): number | undefined {
    if (!patch) return undefined;

    // Handle empty files or very simple patches
    if (patch.trim() === '') return undefined;

    const lines = patch.split('\n');
    let currentLineNumber = 0;
    let diffPosition = 1; // GitHub positions start at 1 for the first line in the diff

    // Process each line in the patch
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Process hunk headers
      if (line.startsWith('@@')) {
        // Parse the hunk header to get starting line numbers
        // Format: @@ -oldStart,oldLines +newStart,newLines @@
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          currentLineNumber = parseInt(match[1], 10); // New file's line number
        }
        diffPosition++; // Increment position for the hunk header line
        continue;
      }
      
      // Skip file metadata lines
      if (line.startsWith('+++') || line.startsWith('---')) {
        diffPosition++;
        continue;
      }
      
      // Process content lines
      if (line.startsWith('+')) {
        // Added line in new file
        if (currentLineNumber === lineNumber) {
          // This is the line we're looking for!
          core.info(`Found exact match for line ${lineNumber} at diff position ${diffPosition}`);
          return diffPosition;
        }
        currentLineNumber++;
        diffPosition++;
      } else if (line.startsWith('-')) {
        // Deleted line from old file - just increment diff position
        diffPosition++;
      } else {
        // Context line - exists in both old and new
        if (currentLineNumber === lineNumber) {
          // This is the line we're looking for!
          core.info(`Found exact match for line ${lineNumber} at diff position ${diffPosition}`);
          return diffPosition;
        }
        currentLineNumber++;
        diffPosition++;
      }
    }

    // If we can't find an exact match, try to find the closest hunk
    // and return a position within that hunk
    currentLineNumber = 0;
    diffPosition = 1;
    let lastHunkStart = 0;
    let lastHunkPosition = 0;
    let bestHunkStart = 0;
    let bestHunkPosition = 0;
    let bestDistanceToLine = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          lastHunkStart = parseInt(match[1], 10);
          lastHunkPosition = diffPosition;
          
          // Check if this hunk is closer to our target line
          const distance = Math.abs(lastHunkStart - lineNumber);
          if (distance < bestDistanceToLine) {
            bestDistanceToLine = distance;
            bestHunkStart = lastHunkStart;
            bestHunkPosition = lastHunkPosition;
          }
        }
      }
      diffPosition++;
    }
    
    if (bestHunkPosition > 0) {
      // Return the best matching hunk position + 1 (to get into the content)
      core.warning(`Couldn't find exact position for line ${lineNumber}, using nearest hunk at position ${bestHunkPosition + 1}`);
      return bestHunkPosition + 1;
    }

    // Line was not found in the diff
    return undefined;
  }

  /**
   * Gets the file content for a specific file
   * @param path Path to the file
   * @returns Content of the file
   */
  async getFileContent(path: string): Promise<string> {
    try {
      const { owner, repo } = this.context.repo;
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: this.context.payload.pull_request?.head.sha || this.context.sha,
      });

      if ('content' in response.data) {
        // Decode base64 content
        const content = Buffer.from(response.data.content, 'base64').toString();
        return content;
      } else {
        throw new Error(`Unexpected content format for ${path}`);
      }
    } catch (error) {
      core.error(`Error getting file content: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Determines if a file can be commented on
   * @param file The file to check
   * @returns True if the file can be commented on
   */
  private isFileCommentable(file: PullRequestFile): boolean {
    // GitHub doesn't allow comments on deleted files
    if (file.status === 'removed') return false;

    // Some file types (binary files, very large files) don't have patches
    // But we can still comment on them in some cases
    if (!file.patch) {
      // Check file extension for common binary types that can't be commented
      const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.exe'];
      const isLikelyBinary = binaryExtensions.some(ext => 
        file.filename.toLowerCase().endsWith(ext)
      );
      
      return !isLikelyBinary;
    }
    
    return true;
  }

  /**
   * Special handling for certain file types that need extra care for commenting
   * @param file The PR file
   * @param lineNumber The line number to comment on
   * @returns A position value suitable for use in GitHub API
   */
  private getSpecialFilePosition(file: PullRequestFile, lineNumber?: number): number | undefined {
    // Configuration and YAML files often need special handling
    const isConfigFile = file.filename.endsWith('.yml') || 
                         file.filename.endsWith('.yaml') || 
                         file.filename.includes('config') ||
                         file.filename.includes('.github/');
    
    // Special handling for GitHub workflow and config files
    const isGitHubFile = file.filename.startsWith('.github/');
    
    if (isConfigFile) {
      // For new config files, use the line number directly
      if (file.status === 'added') {
        return lineNumber || 1;
      }
      
      // For GitHub workflow files in particular, the first position is often safest
      if (isGitHubFile) {
        core.info(`Using first position for GitHub config file: ${file.filename}`);
        return 1;
      }
      
      // For modified config files with patches, we'll make a best effort
      if (file.patch) {
        // Look for the line in the patch
        const lines = file.patch.split('\n');
        
        // For YAML files, find the first '+' line that might match our context
        if (file.filename.endsWith('.yml') || file.filename.endsWith('.yaml')) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Look for any added lines (starting with +)
            if (line.startsWith('+') && !line.startsWith('+++')) {
              return i + 1;
            }
          }
        }
        
        // First try to find the exact line if we can
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('+') && line.includes(`line ${lineNumber}`)) {
            return i + 1;
          }
        }
        
        // If we can't find the exact line, use the first available position in a hunk
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('@@')) {
            // Return position right after the hunk header
            return i + 1;
          }
        }
      }
    }
    
    return undefined;
  }

  /**
   * Adds comments to the PR based on the AI review
   * @param prNumber Pull request number
   * @param comments Comments to add
   */
  async addReviewComments(prNumber: number, comments: CodeReviewComment[]): Promise<void> {
    try {
      const { owner, repo } = this.context.repo;
      
      // Filter comments based on confidence threshold
      const filteredComments = comments.filter(
        comment => comment.confidence >= this.openaiService.getCommentThreshold()
      );
      
      if (filteredComments.length === 0) {
        core.info('No comments to add - no issues with valid positions were found.');
        return;
      }

      // First, get all the file data to have the patches available
      const fileDataMap = new Map();
      const filesResponse = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber
      });
      
      for (const fileData of filesResponse.data) {
        fileDataMap.set(fileData.filename, fileData);
      }

      // Process comments to add position information
      const processedComments = [];
      
      for (const comment of filteredComments) {
        try {
          const fileData = fileDataMap.get(comment.path);
          
          if (!fileData || !fileData.patch) {
            core.warning(`Could not find patch data for ${comment.path}. Skipping comment.`);
            continue;
          }
          
          if (!comment.line) {
            core.warning(`Comment on ${comment.path} has no line number. Skipping.`);
            continue;
          }
          
          // Calculate position in the diff
          const position = this.calculatePositionFromLine(fileData.patch, comment.line);
          
          if (position === undefined) {
            core.warning(`Could not determine position for line ${comment.line} in ${comment.path}. Skipping comment.`);
            continue;
          }
          
          // Process the comment body to ensure severity formatting is preserved
          // GitHub comments support markdown, so we can keep the formatting as-is
          
          processedComments.push({
            ...comment,
            position
          });
        } catch (error) {
          core.warning(`Error processing comment for ${comment.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Prepare JSON output for code review results
      const jsonReviewResults = processedComments.map(comment => ({
        comment: comment.body,
        filePath: comment.path,
        line: comment.line || null,
        position: comment.position || null,
        // Extract severity level for potential sorting/filtering by other tools
        severityLevel: this.extractSeverityLevel(comment.body)
      }));
      
      // Set as GitHub Action output
      core.setOutput('review-results', JSON.stringify(jsonReviewResults));
      core.info('Review results set as action output "review-results"');
      
      // Log the processed comments for debugging
      core.info(`Processed comments with calculated positions: ${JSON.stringify(processedComments, null, 2)}`);
      
      // Write JSON results to a file in the repo (if we have write access)
      try {
        const fs = require('fs');
        const path = require('path');
        const reviewResultsDir = path.join(process.cwd(), '.github', 'code-review-results');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(reviewResultsDir)) {
          fs.mkdirSync(reviewResultsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const jsonFilePath = path.join(reviewResultsDir, `review-${prNumber}-${timestamp}.json`);
        
        // Write JSON file
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonReviewResults, null, 2));
        core.info(`Review results saved as JSON to ${jsonFilePath}`);
      } catch (error) {
        core.warning(`Error writing JSON results file: ${error instanceof Error ? error.message : String(error)}`);
        core.warning('Continuing with PR comments only.');
      }
      
      // Create individual review comments for each issue
      // Start a new review
      const reviewComments = [];
      
      for (const comment of processedComments) {
        try {
          if (comment.position !== undefined && comment.position !== null) {
            reviewComments.push({
              path: comment.path,
              position: comment.position,
              body: comment.body
            });
          } else {
            core.warning(`Skipping comment for ${comment.path} with invalid position`);
          }
        } catch (error) {
          core.warning(`Error processing comment for ${comment.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Submit the review with all the collected comments
      if (reviewComments.length > 0) {
        core.info(`Submitting review with ${reviewComments.length} comments...`);
        core.debug(`Review comments: ${JSON.stringify(reviewComments, null, 2)}`);
        
        await this.octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          comments: reviewComments,
          event: 'COMMENT' // Could be 'APPROVE' or 'REQUEST_CHANGES' based on severity
        });
        
        core.info(`Added ${reviewComments.length} individual review comments to PR #${prNumber}`);
      } else {
        core.warning('No valid comments with positions to submit');
      }
      
    } catch (error) {
      core.error(`Error adding review comments: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Extracts the severity level from a comment body
   * @param commentBody The comment body text
   * @returns The severity level (high, medium, low) or undefined if not found
   */
  private extractSeverityLevel(commentBody: string): string | undefined {
    // Check for emoji + severity format
    if (commentBody.includes('🔴 **High**')) {
      return 'high';
    } else if (commentBody.includes('🟠 **Medium**')) {
      return 'medium';
    } else if (commentBody.includes('🟡 **Low**')) {
      return 'low';
    }
    
    // Check for text-only format as fallback
    const severityMatch = commentBody.match(/\b(high|medium|low)\b/i);
    if (severityMatch) {
      return severityMatch[1].toLowerCase();
    }
    
    return undefined;
  }
} 