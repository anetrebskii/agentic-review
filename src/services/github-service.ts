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
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          // This is a deleted line, extract the line number if possible
          const match = line.match(/^.*@@ -(\d+),\d+ \+\d+,\d+ @@/);
          if (match && match[1]) {
            changeMap.deletions.push(parseInt(match[1], 10));
          }
          return false; // Don't include deletions in the content
        } else if (line.startsWith('@@')) {
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
   * Calculate the position in the diff for a given line number in a file
   * @param patch The git patch
   * @param lineNumber The line number in the file
   * @returns The position in the diff or undefined if not found
   */
  private calculatePositionFromLine(patch: string, lineNumber: number): number | undefined {
    if (!patch) return undefined;

    // Handle empty files or very simple patches
    if (patch.trim() === '') return 1;

    const lines = patch.split('\n');
    let currentLineNumber = 0;
    let positionInDiff = 0;
    let foundHunk = false;
    let lastHunkPosition = 0;

    // First, check if this is a new file with only additions
    const isNewFile = lines.some(line => line.startsWith('new file mode'));
    if (isNewFile) {
      // For new files, we can often use the line number directly
      // Find the appropriate hunk that contains our line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('@@')) {
          const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match && match[1]) {
            const hunkStart = parseInt(match[1], 10);
            // If our target line is in this hunk's range, calculate its position
            if (lineNumber >= hunkStart) {
              // lineNumber - hunkStart + hunkHeader position + 1
              const headerPosition = i + 1; // Position of the line after the hunk header
              return headerPosition + (lineNumber - hunkStart);
            }
          }
        }
      }
    }

    // Standard diff position calculation for modified files
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Handle hunk headers
      if (line.startsWith('@@')) {
        foundHunk = true;
        lastHunkPosition = i;
        // Parse the hunk header to get starting line numbers
        // Format: @@ -oldStart,oldLines +newStart,newLines @@
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match && match[1]) {
          currentLineNumber = parseInt(match[1], 10); // Line numbers in patches are 1-indexed
        }
      } 
      
      if (foundHunk) {
        positionInDiff = i - lastHunkPosition; // Position relative to current hunk
        
        // Skip deletion lines as they don't affect file line numbers
        if (!line.startsWith('-') || line.startsWith('---')) {
          // If it's an addition or context line, it exists in the new file
          if ((line.startsWith('+') && !line.startsWith('+++')) || 
              (!line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@'))) {
            // If this is the line we're looking for, return the position
            if (currentLineNumber === lineNumber) {
              return positionInDiff;
            }
            currentLineNumber++;
          }
        }
      }
    }

    // If we can't determine position precisely, as a last resort for non-empty patches:
    // Fall back to the first position in the last hunk
    if (foundHunk) {
      core.warning(`Couldn't find exact position for line ${lineNumber}, falling back to approximate position`);
      return 1; // Default to position 1 (right after the first hunk header)
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
        ref: this.context.payload.pull_request?.head.sha,
      });

      // Check if we got a file (not a directory)
      if ('content' in response.data && 'encoding' in response.data) {
        const content = Buffer.from(response.data.content, response.data.encoding as BufferEncoding).toString();
        return content;
      } else {
        throw new Error(`Could not get content for ${path}`);
      }
    } catch (error) {
      core.error(`Error getting file content: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Creates a check run to indicate the code review is in progress
   * @returns The check run ID
   */
  async createInProgressCheckRun(): Promise<number> {
    try {
      const { owner, repo } = this.context.repo;
      const response = await this.octokit.rest.checks.create({
        owner,
        repo,
        name: 'AI Code Review',
        head_sha: this.context.payload.pull_request?.head.sha || this.context.sha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });

      return response.data.id;
    } catch (error) {
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
  async completeCheckRun(
    checkRunId: number, 
    conclusion: 'success' | 'failure' | 'neutral', 
    summary: string
  ): Promise<void> {
    try {
      const { owner, repo } = this.context.repo;
      await this.octokit.rest.checks.update({
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
    } catch (error) {
      core.error(`Error completing check run: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Determine if a file can be commented on in a PR
   * @param file The pull request file
   * @returns Boolean indicating if comments are possible
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
        core.info('No comments to add based on confidence threshold.');
        return;
      }

      // Consolidate all comments into one single PR comment
      let combinedBody = '# AI Code Review Summary\n\n';
      
      // Group comments by file for better organization
      const commentsByFile: Record<string, CodeReviewComment[]> = {};
      
      filteredComments.forEach(comment => {
        if (!commentsByFile[comment.path]) {
          commentsByFile[comment.path] = [];
        }
        commentsByFile[comment.path].push(comment);
      });
      
      // Add file-specific comments to the combined body
      Object.entries(commentsByFile).forEach(([filename, fileComments]) => {
        combinedBody += `## File: ${filename}\n\n`;
        
        fileComments.forEach(comment => {
          combinedBody += comment.body + '\n\n';
        });
      });
      
      // Create a single issue comment instead of a review with multiple comments
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: combinedBody
      });
      
      core.info(`Added a single combined review comment to PR #${prNumber} with feedback for ${Object.keys(commentsByFile).length} files`);
    } catch (error) {
      core.error(`Error adding review comment: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 