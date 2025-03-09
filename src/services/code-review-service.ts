import * as core from '@actions/core';
import { CodeReviewConfig } from '../config/default-config';
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
      
      // Create in-progress check run
      const checkRunId = await this.githubService.createInProgressCheckRun();
      core.info(`Created check run with ID: ${checkRunId}`);
      
      // Get changed files with context
      const changedFiles = await this.githubService.getChangedFiles(prNumber);
      core.info(`Found ${changedFiles.length} changed files to review.`);
      core.info(`Changed files: ${JSON.stringify(changedFiles, null, 2)}`);
      
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
   * Reviews an enhanced file with changes and context
   * @param file The enhanced file to review
   * @returns Comments for the file
   */
  private async reviewEnhancedFile(file: EnhancedPRFile): Promise<CodeReviewComment[]> {
    try {
      // Initial analysis using the enhanced file
      core.info(`Analyzing changes in file ${file.filename}...`);
      const initialAnalysis = await this.openaiService.analyzeCodeChanges(file);
      
      // Start conversation for agentic review
      const conversation = [
        { role: 'user' as const, content: `Please review the changes to ${file.filename}` },
        { role: 'assistant' as const, content: initialAnalysis }
      ];
      
      // Make follow-up inquiries (agentic mode)
      core.info(`Making follow-up inquiries for ${file.filename}...`);
      const followUpAnalysis = await this.openaiService.makeFollowUpInquiry(
        initialAnalysis,
        file,
        conversation
      );
      
      // Parse comments and feedback
      core.info(`Parsing review results for ${file.filename}...`);
      const comments = this.parseReviewFeedback(file, initialAnalysis, followUpAnalysis);
      
      return comments;
    } catch (error) {
      core.error(`Error reviewing file ${file.filename}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  // For backward compatibility
  private async reviewFile(file: EnhancedPRFile): Promise<CodeReviewComment[]> {
    return this.reviewEnhancedFile(file);
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
   * @param file The file being reviewed
   * @param initialAnalysis Initial analysis from the AI
   * @param followUpAnalysis Follow-up analysis from the AI
   * @returns Extracted comments
   */
  private parseReviewFeedback(
    file: EnhancedPRFile, 
    initialAnalysis: string, 
    followUpAnalysis: string
  ): CodeReviewComment[] {
    const comments: CodeReviewComment[] = [];
    
    // Process initial analysis to extract line-specific comments
    if (initialAnalysis && initialAnalysis.trim() !== '') {
      // Look for lines that indicate issues with specific line numbers
      // Common formats: "Line X:", "Line X -", "At line X:", etc.
      const lineIssueRegex = /(?:Line|At line|In line|On line)\s+(\d+)(?:\s*[-:]\s*|\s*[:,]\s*|\s+)(.*)/gi;
      let match;
      
      // Extract line-specific comments from initial analysis
      while ((match = lineIssueRegex.exec(initialAnalysis)) !== null) {
        const lineNumber = parseInt(match[1], 10);
        const issueComment = match[2].trim();
        
        if (issueComment) {
          comments.push({
            path: file.filename,
            line: lineNumber,
            body: issueComment,
            confidence: 100
          });
        }
      }
      
      // If no line-specific comments were found, add the entire initial analysis as a general comment
      if (comments.length === 0) {
        comments.push({
          path: file.filename,
          body: initialAnalysis,
          confidence: 100
        });
      }
    }
    
    // Process follow-up analysis if it contains content
    if (followUpAnalysis && 
        followUpAnalysis.trim() !== '' && 
        followUpAnalysis !== 'No further inquiries.' &&
        followUpAnalysis !== 'No additional issues identified.') {
      
      // Extract line-specific comments from follow-up analysis
      const lineIssueRegex = /(?:Line|At line|In line|On line)\s+(\d+)(?:\s*[-:]\s*|\s*[:,]\s*|\s+)(.*)/gi;
      let match;
      
      while ((match = lineIssueRegex.exec(followUpAnalysis)) !== null) {
        const lineNumber = parseInt(match[1], 10);
        const issueComment = match[2].trim();
        
        if (issueComment) {
          comments.push({
            path: file.filename,
            line: lineNumber,
            body: issueComment,
            confidence: 100
          });
        }
      }
      
      // If no line-specific comments were found in follow-up, add it as a general comment
      if (!lineIssueRegex.test(followUpAnalysis)) {
        comments.push({
          path: file.filename,
          body: followUpAnalysis,
          confidence: 100
        });
      }
    }
    
    return comments;
  }
} 