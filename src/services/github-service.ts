import * as core from '@actions/core';
import * as github from '@actions/github';
import { CodeReviewConfig } from '../config/default-config';
import { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';

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
  body: string;
  confidence: number;
}

type GitHubOctokit = ReturnType<typeof github.getOctokit>;

export class GitHubService {
  private octokit: GitHubOctokit;
  private config: CodeReviewConfig;
  private context: typeof github.context;
  
  constructor(config: CodeReviewConfig) {
    const token = core.getInput('github-token');
    if (!token) {
      throw new Error('GitHub token is required');
    }
    
    this.octokit = github.getOctokit(token);
    this.config = config;
    this.context = github.context;
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
   * Gets the files changed in the PR
   * @param prNumber Pull request number
   * @returns List of files changed in the PR
   */
  async getChangedFiles(prNumber: number): Promise<PullRequestFile[]> {
    try {
      const { owner, repo } = this.context.repo;
      const response = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const files = response.data;
      
      // Filter files based on include/exclude patterns
      return files.filter((file: PullRequestFile) => {
        // Check if file matches include patterns
        const included = this.config.includeFiles.some(pattern => 
          minimatch(file.filename, pattern)
        );
        
        // Check if file matches exclude patterns
        const excluded = this.config.excludeFiles.some(pattern => 
          minimatch(file.filename, pattern)
        );
        
        return included && !excluded;
      });
    } catch (error) {
      core.error(`Error getting changed files: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Gets the file content for a specific file
   * @param path Path to the file
   * @returns Content of the file
   */
  async getFileContent(path: string): Promise<string> {
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
      const response = await this.octokit.checks.create({
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
    } catch (error) {
      core.error(`Error completing check run: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
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
        comment => comment.confidence >= this.config.commentThreshold
      );
      
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
    } catch (error) {
      core.error(`Error adding review comments: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 