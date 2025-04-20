import * as core from '@actions/core';
import { CodeReviewConfig, ReviewRule } from '../config/default-config';
import { GitHubService, CodeReviewComment, EnhancedPRFile } from './github-service';
import { OpenAIService } from './openai-service';

export class CodeReviewService {
  private config: CodeReviewConfig;
  private githubService: GitHubService;
  private openaiService: OpenAIService;
  
  constructor(config: CodeReviewConfig) {
    // Ensure we have a valid config object
    this.config = this.validateConfig(config);
    this.openaiService = new OpenAIService(this.config);
    this.githubService = new GitHubService(this.config, this.openaiService);
  }
  
  /**
   * Validates and ensures config has required properties
   * @param config Input configuration
   * @returns Validated configuration
   */
  private validateConfig(config: any): CodeReviewConfig {
    const validatedConfig = { ...config };
    
    // Ensure we have default values for required properties
    if (!Array.isArray(validatedConfig.rules)) {
      validatedConfig.rules = [];
    }
    
    if (!Array.isArray(validatedConfig.excludeFiles)) {
      validatedConfig.excludeFiles = [];
    }
    
    return validatedConfig as CodeReviewConfig;
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
      
      // Get changed files with context
      const changedFiles = await this.githubService.getChangedFiles(prNumber);
      core.info(`Found ${changedFiles.length} changed files to review.`);
      core.info(`Changed files: ${JSON.stringify(changedFiles, null, 2)}`);
      
      if (changedFiles.length === 0) {
        core.info('No files to review based on configuration filters.');
        return;
      }
      
      // Review each file
      const allComments: CodeReviewComment[] = [];
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

      core.info(`All comments: ${JSON.stringify(allComments, null, 2)}`);
      
      // Add review comments to PR
      await this.githubService.addReviewComments(prNumber, allComments);
      
      core.info(`Completed AI code review with ${allComments.length} comments.`);
    } catch (error) {
      core.error(`Error running code review: ${error instanceof Error ? error.message : String(error)}`);
      core.setFailed(`Code review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Reviews an enhanced file with changes and context
   * @param file The enhanced file to review
   * @returns Comments for the file
   */
  private async reviewEnhancedFile(file: EnhancedPRFile): Promise<CodeReviewComment[]> {
    try {
      // Initial analysis using the enhanced file
      core.info(`Analyzing changes in file ${file.filename}...`);
      
            
      const initialAnalysis = await this.openaiService.analyzeCodeChanges(file);
      
      // Parse comments and feedback
      core.info(`Parsing review results for ${file.filename}...`);
      return initialAnalysis.map(comment => ({
        path: file.filename,
        line: comment.startLine,
        endLine: comment.endLine,
        body: comment.comment,
        confidence: 100
      }));
    } catch (error) {
      core.error(`Error reviewing file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
} 