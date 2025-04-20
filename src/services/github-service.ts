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

export interface FileCodeReviewComment {
  startLine: number;
  endLine: number;
  comment: string;
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

      // Get the timestamp of the last review
      const lastReviewTimestamp = await this.getLastReviewTimestamp(prNumber);
      core.info(`Last review was performed at: ${lastReviewTimestamp ? new Date(lastReviewTimestamp).toISOString() : 'Never'}`);

      // Filter out files that haven't changed since the last review
      let filesToReview = response.data;
      if (lastReviewTimestamp) {
        // Get commit dates for files 
        const fileCommitDates = await this.getFileCommitDates(prNumber);
        
        // Only include files modified after the last review
        filesToReview = response.data.filter(file => {
          const lastModified = fileCommitDates[file.filename];
          const isModifiedAfterLastReview = !lastModified || lastModified > lastReviewTimestamp;
          
          if (!isModifiedAfterLastReview) {
            core.info(`Skipping file ${file.filename} - not modified since last review`);
          }
          
          return isModifiedAfterLastReview;
        });
        
        core.info(`After filtering by last review time: ${filesToReview.length} of ${response.data.length} files will be reviewed.`);
      }

      // Filter out excluded files
      const filteredFiles = this.filterExcludedFiles(filesToReview);
      core.info(`After applying excludeFiles filter: ${filteredFiles.length} of ${filesToReview.length} files will be reviewed.`);

      const filesWithContent = await Promise.all(
        filteredFiles.map(async (file) => {
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
   * Gets the timestamp of the last code review for a pull request
   * @param prNumber Pull request number
   * @returns Timestamp of the last review or undefined if no previous review
   */
  private async getLastReviewTimestamp(prNumber: number): Promise<number | undefined> {
    try {
      const { owner, repo } = this.context.repo;
      
      // Get all review comments for the PR
      const reviewCommentsResponse = await this.octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      
      // Find all comments made by the GitHub Actions bot (our review comments)
      const botReviewComments = reviewCommentsResponse.data.filter(comment => 
        comment.user?.login === 'github-actions[bot]' &&
        comment.body.includes('AI Code Review')
      );
      
      if (botReviewComments.length === 0) {
        return undefined;
      }
      
      // Get the timestamp of the most recent review comment
      const lastReviewComment = botReviewComments.reduce((latest, comment) => {
        const commentDate = new Date(comment.created_at).getTime();
        return commentDate > latest ? commentDate : latest;
      }, 0);
      
      return lastReviewComment;
    } catch (error) {
      core.warning(`Error getting last review timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined; // If we can't determine the last review time, review all files
    }
  }
  
  /**
   * Gets the last commit date for each file in the PR
   * @param prNumber Pull request number
   * @returns Map of filenames to timestamp of last commit
   */
  private async getFileCommitDates(prNumber: number): Promise<Record<string, number>> {
    try {
      const { owner, repo } = this.context.repo;
      const fileCommitDates: Record<string, number> = {};
      
      // Get all commits in the PR
      const commitsResponse = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      
      // Process commits from newest to oldest
      for (const commit of commitsResponse.data.reverse()) {
        const commitDate = new Date(commit.commit.committer?.date || commit.commit.author?.date || '').getTime();
        
        // Get the files changed in this commit
        const commitFilesResponse = await this.octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });
        
        // Update the last modified date for each file
        for (const file of commitFilesResponse.data.files || []) {
          // Only update if this is the most recent change to the file
          if (!fileCommitDates[file.filename] || commitDate > fileCommitDates[file.filename]) {
            fileCommitDates[file.filename] = commitDate;
          }
        }
      }
      
      return fileCommitDates;
    } catch (error) {
      core.warning(`Error getting file commit dates: ${error instanceof Error ? error.message : String(error)}`);
      return {}; // If we can't determine the file commit dates, review all files
    }
  }

  /**
   * Filter files based on exclude patterns
   * @param files The files to filter
   * @returns Filtered list of files
   */
  private filterExcludedFiles(files: PullRequestFile[]): PullRequestFile[] {
    if (!this.config.excludeFiles || this.config.excludeFiles.length === 0) {
      return files;
    }

    return files.filter(file => {
      // Check if the file matches any exclude pattern
      const isExcluded = this.config.excludeFiles.some(pattern => {
        // Clean pattern: trim whitespace and remove YAML list marker if present
        const cleanPattern = pattern.trim().replace(/^-\s*/, '');
        
        // Set up minimatch options to handle dotfiles and ensure consistent matching
        const options = {
          dot: true,          // Match dotfiles (files starting with .)
          nocase: false,      // Case sensitive matching
          matchBase: true,    // Match basename of file if pattern has no slashes
          noglobstar: false,  // Support ** for matching across directories
        };
        
        // For debugging
        core.info(`Checking if file ${file.filename} matches pattern: ${cleanPattern}`);
        
        const matches = minimatch(file.filename, cleanPattern, options);
        if (matches) {
          core.info(`Match found: ${file.filename} matches ${cleanPattern}`);
        }
        
        return matches;
      });
      
      if (isExcluded) {
        core.info(`Excluding file from review: ${file.filename}`);
      }
      
      return !isExcluded;
    });
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
        core.info('No comments to add - no issues found that meet the confidence threshold.');
        return;
      }

      // Get file data with patches
      const filesResponse = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber
      });
      
      const fileDataMap = new Map(
        filesResponse.data.map(fileData => [fileData.filename, fileData])
      );

      // Process comments to add position information
      const reviewComments = [];
      const reviewTimestamp = new Date().toISOString();
      
      for (const comment of filteredComments) {
        const fileData = fileDataMap.get(comment.path);
        
        // Skip if file data or patch is missing, or comment has no line number
        if (!fileData?.patch || !comment.line) {
          core.warning(`Skipping comment for ${comment.path}: ${!fileData?.patch ? 'No patch data' : 'No line number'}`);
          continue;
        }
        
        // Calculate position in the diff
        const position = this.calculatePositionFromLine(fileData.patch, comment.line);
        
        if (position === undefined) {
          core.warning(`Skipping comment for ${comment.path}: Could not determine position for line ${comment.line}`);
          continue;
        }
        
        reviewComments.push({
          path: comment.path,
          position,
          body: comment.body
        });
      }
      
      // Prepare output for GitHub Action
      const jsonReviewResults = {
        comments: filteredComments.map(comment => ({
          startLine: comment.line || null,
          endLine: comment.line || null,
          comment: comment.body
        }))
      };
      
      // Set as GitHub Action output
      core.setOutput('review-results', JSON.stringify(jsonReviewResults));
      
      // Submit the review with all comments
      if (reviewComments.length > 0) {
        core.info(`Submitting review with ${reviewComments.length} comments...`);
        
        await this.octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          comments: reviewComments,
          event: 'COMMENT'
        });
        
        // Create a summary comment on the PR with token usage
        await this.createSummaryComment(prNumber, reviewComments.length);
        
        core.info(`Added ${reviewComments.length} review comments to PR #${prNumber}`);
      } else {
        core.warning('No valid comments with positions to submit');
      }
      
    } catch (error) {
      core.error(`Error adding review comments: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Creates a summary comment on the PR with the review statistics
   * @param prNumber Pull request number
   * @param commentCount Number of comments added
   */
  private async createSummaryComment(prNumber: number, commentCount: number): Promise<void> {
    try {
      const { owner, repo } = this.context.repo;
      
      // Get token usage statistics
      const totalInputTokens = this.openaiService.getInputTokenCount();
      const totalOutputTokens = this.openaiService.getOutputTokenCount();
      const totalTokens = totalInputTokens + totalOutputTokens;
      
      // Create the summary message
      const summaryBody = `
## AI Code Review Summary

- **Total Comments**: ${commentCount}
- **Token Usage**:
  - Input tokens: ${totalInputTokens}
  - Output tokens: ${totalOutputTokens}
  - **Total tokens**: ${totalTokens}

_AI Code Review ${new Date().toISOString()}_
      `.trim();
      
      // Add the summary comment to the PR
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: summaryBody
      });
      
      core.info(`Added summary comment to PR #${prNumber}`);
    } catch (error) {
      core.warning(`Error creating summary comment: ${error instanceof Error ? error.message : String(error)}`);
      // Don't fail the whole process if just the summary comment fails
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