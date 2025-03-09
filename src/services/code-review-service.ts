import * as core from '@actions/core';
import { CodeReviewConfig } from '../config/default-config';
import { GitHubService, PullRequestFile, CodeReviewComment } from './github-service';
import { OpenAIService } from './openai-service';

export class CodeReviewService {
  private config: CodeReviewConfig;
  private githubService: GitHubService;
  private openaiService: OpenAIService;
  
  constructor(config: CodeReviewConfig) {
    this.config = config;
    this.openaiService = new OpenAIService(config);
    this.githubService = new GitHubService(config, this.openaiService);
  }
  
  /**
   * Runs the code review process
   */
  async runCodeReview(): Promise<void> {
    try {
      const prNumber = this.githubService.getPRNumber();
      if (!prNumber) {
        core.setFailed('This action must be run in a pull request context.');
        return;
      }
      
      // Create in-progress check run
      const checkRunId = await this.githubService.createInProgressCheckRun();
      core.info(`Created check run with ID: ${checkRunId}`);
      
      // Get changed files
      const changedFiles = await this.githubService.getChangedFiles(prNumber);
      core.info(`Found ${changedFiles.length} changed files to review.`);
      
      if (changedFiles.length === 0) {
        await this.githubService.completeCheckRun(
          checkRunId, 
          'success', 
          'No files to review based on configuration filters.'
        );
        return;
      }
      
      // Review each file
      const allComments: CodeReviewComment[] = [];
      for (const file of changedFiles) {
        core.info(`Reviewing file: ${file.filename}`);
        const comments = await this.reviewFile(file);
        allComments.push(...comments);
      }
      
      // Add review comments to PR
      await this.githubService.addReviewComments(prNumber, allComments);
      
      // Complete check run
      await this.githubService.completeCheckRun(
        checkRunId,
        'success',
        `Completed AI code review with ${allComments.length} comments.`
      );
      
    } catch (error) {
      core.error(`Error running code review: ${error instanceof Error ? error.message : String(error)}`);
      core.setFailed(`Code review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Reviews a single file
   * @param file The file to review
   * @returns Comments for the file
   */
  private async reviewFile(file: PullRequestFile): Promise<CodeReviewComment[]> {
    try {
      // Skip files without patches (binary files, etc.)
      if (!file.patch) {
        core.info(`Skipping file ${file.filename} - no patch available.`);
        return [];
      }
      
      // Get file content for context
      let fileContent: string;
      try {
        fileContent = await this.githubService.getFileContent(file.filename);
      } catch (error) {
        core.warning(`Could not get full file content for ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
        fileContent = '';
      }
      
      // Prepare context for the AI
      const reviewContext = {
        filename: file.filename,
        language: this.detectLanguage(file.filename),
        additions: file.additions,
        deletions: file.deletions,
        totalChanges: file.changes
      };
      
      // Initial analysis
      core.info(`Analyzing file ${file.filename}...`);
      const initialAnalysis = await this.openaiService.analyzeCode(
        file.patch,
        file.filename,
        fileContent ? `Full file context:\n${fileContent}` : undefined
      );
      
      // Start conversation for agentic review
      const conversation = [
        { role: 'user' as const, content: `Please review the changes to ${file.filename}:\n\n${file.patch}` },
        { role: 'assistant' as const, content: initialAnalysis }
      ];
      
      // Make follow-up inquiries (agentic mode)
      core.info(`Making follow-up inquiries for ${file.filename}...`);
      const followUpAnalysis = await this.openaiService.makeFollowUpInquiry(
        initialAnalysis,
        file.patch,
        file.filename,
        conversation
      );
      
      // Parse comments and feedback
      core.info(`Parsing review results for ${file.filename}...`);
      const comments = this.parseReviewFeedback(file.filename, initialAnalysis, followUpAnalysis);
      
      return comments;
    } catch (error) {
      core.error(`Error reviewing file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Detects the programming language from a filename
   * @param filename The filename
   * @returns The detected language
   */
  private detectLanguage(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
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
   * @param filename The filename
   * @param initialAnalysis Initial analysis from the AI
   * @param followUpAnalysis Follow-up analysis from the AI
   * @returns Extracted comments
   */
  private parseReviewFeedback(
    filename: string, 
    initialAnalysis: string, 
    followUpAnalysis: string
  ): CodeReviewComment[] {
    const comments: CodeReviewComment[] = [];
    
    // For now, we'll create a single comment with the combined analysis
    // In a more advanced implementation, we could parse the AI response more granularly
    comments.push({
      path: filename,
      body: `## AI Code Review Feedback\n\n${initialAnalysis}\n\n### Follow-up Analysis\n\n${followUpAnalysis}`,
      confidence: 100 // High confidence for the overall analysis
    });
    
    return comments;
  }
} 