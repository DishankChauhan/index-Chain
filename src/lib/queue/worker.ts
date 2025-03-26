import { Queue, Worker, Job } from 'bullmq';
import { DatabaseService } from '../services/databaseService';
import { HeliusService } from '../services/heliusService';
import serverLogger from '../utils/serverLogger';

interface WebhookJobData {
  webhookId: string;
  payload: any;
  userId: string;
}

interface IndexingJobData {
  jobId: string;
  config: any;
  dbConnection: any;
  userId: string;
}

const indexingQueue = new Queue('indexing-jobs', {
  connection: {
    port: parseInt(process.env.REDIS_PORT || '6379'),
    host: process.env.REDIS_HOST || 'localhost',
  }
});

serverLogger.info('Blockchain Indexer Worker initialized', {
  component: 'Worker',
  action: 'Initialize',
  message: '🚀 Blockchain Indexer Worker started and ready to process jobs'
});

// Process jobs
const worker = new Worker<IndexingJobData>('indexing-jobs', async (job) => {
  const jobId = job.id || 'unknown';
  
  serverLogger.info('Processing indexing job', {
    component: 'Worker',
    action: 'ProcessJob',
    jobId,
    data: job.data
  });
  
  try {
    const { jobId: dataJobId, config, dbConnection, userId } = job.data;
    
    // Initialize services
    const dbService = DatabaseService.getInstance();
    const heliusService = HeliusService.getInstance(userId);

    // Check if job was cancelled
    const jobData = await indexingQueue.getJob(jobId);
    if (!jobData) {
      serverLogger.warn('Job cancelled - job not found', {
        component: 'Worker',
        action: 'CheckJobStatus',
        jobId
      });
      return;
    }
    const jobState = await jobData.getState();
    if (jobState === 'failed') {
      serverLogger.warn('Job cancelled - job failed', {
        component: 'Worker',
        action: 'CheckJobStatus',
        jobId,
        state: jobState
      });
      return;
    }

    // Set up database tables
    await dbService.initializeTables(dbConnection, config.categories);
    
    // Check if job was cancelled
    if (!await indexingQueue.getJob(jobId)) {
      serverLogger.warn('Job cancelled during table initialization', {
        component: 'Worker',
        action: 'CheckJobStatus',
        jobId
      });
      return;
    }
    
    // Start indexing
    let webhook;
    if (config.webhook?.enabled) {
      webhook = await heliusService.createWebhook({
        accountAddresses: config.filters?.accounts || [],
        programIds: config.filters?.programIds || [],
        webhookURL: config.webhook.url || '',
        webhookSecret: config.webhook.secret || ''
      });

      serverLogger.info('Webhook created for job', {
        component: 'Worker',
        action: 'CreateWebhook',
        jobId: dataJobId,
        webhookId: webhook.webhookId
      });
    } else {
      serverLogger.info('Starting direct data fetching', {
        component: 'Worker',
        action: 'ProcessJob',
        jobId: dataJobId
      });

      // Create a database pool for data insertion
      const pool = await dbService.getPoolForApi(dbConnection);

      try {
        // Start fetching and processing data
        await heliusService.startDataFetching(dataJobId, config, pool);

        serverLogger.info('Data fetching completed', {
          component: 'Worker',
          action: 'ProcessJob',
          jobId: dataJobId
        });
      } finally {
        // Close the database pool
        await pool.end();
      }
    }

    // Update progress
    await job.updateProgress(100);
    
    return { status: 'success', webhook };
  } catch (error) {
    serverLogger.error('Failed to process indexing job', error as Error, {
      component: 'Worker',
      action: 'ProcessJob',
      jobId
    });
    throw error;
  }
}, {
  connection: {
    port: parseInt(process.env.REDIS_PORT || '6379'),
    host: process.env.REDIS_HOST || 'localhost',
  }
});

// Log job events
worker.on('completed', (job: Job<IndexingJobData, any, string>) => {
  if (job) {
    serverLogger.info('Job completed', {
      component: 'Worker',
      action: 'JobCompleted',
      jobId: job.id || 'unknown'
    });
  }
});

worker.on('failed', (job: Job<IndexingJobData, any, string> | undefined, error: Error) => {
  if (job) {
    serverLogger.error('Job failed', error, {
      component: 'Worker',
      action: 'JobFailed',
      jobId: job.id || 'unknown'
    });
  }
});

worker.on('progress', (job: Job<IndexingJobData, any, string>, progress: number | object) => {
  if (job && typeof progress === 'number') {
    serverLogger.info('Job progress updated', {
      component: 'Worker',
      action: 'JobProgress',
      jobId: job.id || 'unknown',
      progress: `${progress}%`
    });
  }
});

export default indexingQueue;

export async function processWebhookJob(job: Job<WebhookJobData>) {
  try {
    const { webhookId, userId, payload } = job.data;

    // Validate job data
    if (!webhookId || !userId || !payload) {
      throw new Error('Invalid job data');
    }

    serverLogger.info('Processing webhook job', {
      component: 'Worker',
      action: 'ProcessWebhookJob',
      jobId: job.id,
      webhookId,
      userId
    });

    const heliusService = HeliusService.getInstance(userId);
    const result = await heliusService.handleWebhookData(webhookId, userId, [payload]);

    if (!result.success) {
      serverLogger.warn('Webhook processing completed with errors', {
        component: 'Worker',
        action: 'ProcessWebhookJob',
        jobId: job.id,
        webhookId,
        errors: result.errors
      });
    } else {
      serverLogger.info('Webhook processing completed successfully', {
        component: 'Worker',
        action: 'ProcessWebhookJob',
        jobId: job.id,
        webhookId,
        transactionsProcessed: result.transactionsProcessed
      });
    }

    return result;
  } catch (error) {
    serverLogger.error('Failed to process webhook job', error as Error, {
      component: 'Worker',
      action: 'ProcessWebhookJob',
      jobId: job.id,
      webhookId: job.data.webhookId
    });
    throw error;
  }
} 