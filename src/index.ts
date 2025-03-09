import * as core from '@actions/core';
import { loadConfig } from './utils/config';
import { CodeReviewService } from './services/code-review-service';

async function run(): Promise<void> {
  try {
    core.info('Starting AI code review action');
    
    // Load configuration
    core.info('Loading configuration');
    const config = await loadConfig();
    
    // Initialize code review service
    const codeReviewService = new CodeReviewService(config);
    
    // Run the code review
    core.info('Running code review');
    await codeReviewService.runCodeReview();
    
    core.info('Code review completed successfully');
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run().catch(error => {
  core.setFailed(`Action failed with unhandled error: ${error instanceof Error ? error.message : String(error)}`);
}); 