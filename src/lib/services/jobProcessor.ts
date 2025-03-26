import { logError, logInfo, logWarn } from '@/lib/utils/serverLogger';
import prisma from '@/lib/db';
import { AppError } from '@/lib/utils/errorHandling';
import { DatabaseService } from './databaseService';
import { HeliusWebhookService } from './heliusWebhookService';
import { WebSocketService } from './websocketService';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';

export interface JobConfig {
  lastProcessedBlock?: number;
  lastProcessedTimestamp?: Date;
  checkpoints?: Array<{
    block: number;
    timestamp: Date;
  }>;
  error?: string;
}

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  lastRunAt?: Date;
  error?: string;
  config: JobConfig;
}

export class JobProcessor {
  private static instance: JobProcessor;
  private jobs: Map<string, Job>;
  private wsService: WebSocketService;
  private isProcessing: boolean = false;
  private activeJobs: Set<string> = new Set();
  private readonly maxRetries: number = 3;
  private readonly checkpointInterval: number = 1000; // Save checkpoint every 1000 blocks
  private readonly jobTimeout: number = 30 * 60 * 1000; // 30 minutes
  private readonly cleanupInterval: number = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {
    this.jobs = new Map();
    this.wsService = WebSocketService.getInstance();
    // Start the cleanup process
    this.startCleanupProcess();
  }

  public static getInstance(): JobProcessor {
    if (!JobProcessor.instance) {
      JobProcessor.instance = new JobProcessor();
    }
    return JobProcessor.instance;
  }

  private async startCleanupProcess(): Promise<void> {
    setInterval(async () => {
      try {
        await this.cleanupFailedJobs();
      } catch (error) {
        logError('Failed to cleanup jobs', error as Error, {
          component: 'JobProcessor',
          action: 'startCleanupProcess'
        });
      }
    }, this.cleanupInterval);
  }

  public createJob(type: string, config: JobConfig = {}): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      type,
      status: 'PENDING',
      progress: 0,
      config,
      lastRunAt: new Date(),
    };

    this.jobs.set(job.id, job);
    this.broadcastJobUpdate(job);
    return job;
  }

  public updateJobProgress(jobId: string, progress: number, config?: Partial<JobConfig>): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    job.progress = progress;
    if (config) {
      job.config = { ...job.config, ...config };
    }
    job.lastRunAt = new Date();

    this.broadcastJobUpdate(job);
  }

  public updateJobStatus(jobId: string, status: JobStatus, error?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    job.status = status;
    if (error) {
      job.error = error;
      job.config.error = error;
    }
    job.lastRunAt = new Date();

    this.broadcastJobUpdate(job);
  }

  public getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  public getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  public deleteJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (deleted) {
      this.wsService.broadcastToAll({
        type: 'JOB_DELETED',
        data: { jobId },
      });
    }
    return deleted;
  }

  private broadcastJobUpdate(job: Job): void {
    this.wsService.broadcastToAll({
      type: 'JOB_UPDATED',
      data: job,
    });
  }

  public async startJob(jobId: string): Promise<void> {
    if (this.activeJobs.has(jobId)) {
      throw new AppError('Job is already running', 400);
    }

    const job = await prisma.indexingJob.findUnique({
      where: { id: jobId },
      include: { webhooks: true }
    });

    if (!job) {
      throw new AppError('Job not found', 404);
    }

    this.activeJobs.add(jobId);

    try {
      await this.updateJobStatus(jobId, 'RUNNING');
      
      // Start processing with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), this.jobTimeout);
      });

      await Promise.race([
        this.processJob(job),
        timeoutPromise
      ]);

      await this.updateJobStatus(jobId, 'COMPLETED');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      await this.updateJobStatus(jobId, 'FAILED', errorMessage);

      if ((job.config as any).retryCount < this.maxRetries) {
        await this.scheduleRetry(job);
      }

      throw error;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async processJob(job: any): Promise<void> {
    const metadata = job.config as JobConfig;
    let lastProcessedBlock = metadata.lastProcessedBlock || 0;

    try {
      // Process data in chunks
      while (this.shouldContinueProcessing(job)) {
        const data = await this.fetchNextDataChunk(job, lastProcessedBlock);
        if (!data || data.length === 0) break;

        await this.processDataChunk(job, data);
        lastProcessedBlock = data[data.length - 1].block;

        // Save checkpoint if needed
        if (lastProcessedBlock % this.checkpointInterval === 0) {
          await this.saveCheckpoint(job.id, lastProcessedBlock, data[data.length - 1]);
        }

        // Update progress
        await this.updateProgress(job.id, this.calculateProgress(lastProcessedBlock));
      }
    } catch (error) {
      await this.handleProcessingError(job, error as Error, lastProcessedBlock);
      throw error;
    }
  }

  private async saveCheckpoint(
    jobId: string,
    block: number,
    data: any
  ): Promise<void> {
    try {
      const config = await this.getJobConfig(jobId);
      const checkpoints = config.checkpoints || [];
      
      checkpoints.push({
        block,
        timestamp: new Date(),
        data
      });

      // Keep only last 5 checkpoints
      if (checkpoints.length > 5) {
        checkpoints.shift();
      }

      await prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          config: {
            ...config,
            checkpoints,
            lastProcessedBlock: block,
            lastProcessedTimestamp: new Date()
          }
        }
      });
    } catch (error) {
      logError('Failed to save checkpoint', error as Error, {
        component: 'JobProcessor',
        action: 'saveCheckpoint',
        jobId,
        block
      });
    }
  }

  private async scheduleRetry(job: any): Promise<void> {
    const retryCount = (job.config as any).retryCount || 0;
    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        config: {
          ...job.config,
          retryCount: retryCount + 1,
          nextRetryAt: new Date(Date.now() + delay)
        }
      }
    });

    logInfo('Scheduled job retry', {
      component: 'JobProcessor',
      action: 'scheduleRetry',
      jobId: job.id,
      retryCount: retryCount + 1,
      delay
    });
  }

  private shouldContinueProcessing(job: any): boolean {
    return !job.config.endBlock || job.config.lastProcessedBlock < job.config.endBlock;
  }

  private async fetchNextDataChunk(job: any, lastProcessedBlock: number): Promise<any[]> {
    // Implementation depends on your data source
    // This is a placeholder
    return [];
  }

  private async processDataChunk(job: any, data: any[]): Promise<void> {
    // Implementation depends on your data processing logic
    // This is a placeholder
  }

  private calculateProgress(currentBlock: number): number {
    // Implementation depends on your progress calculation logic
    // This is a placeholder
    return 0;
  }

  private async handleProcessingError(
    job: any,
    error: Error,
    lastProcessedBlock: number
  ): Promise<void> {
    await this.handleJobError(job, error, lastProcessedBlock);
  }

  private async handleJobError(job: Job, error: Error, lastProcessedBlock: number): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.updateJobStatus(job.id, 'FAILED', errorMessage);
    this.updateJobProgress(job.id, job.progress, {
      lastProcessedBlock,
      lastProcessedTimestamp: new Date(),
    });
  }

  private async handleJobRecovery(job: Job): Promise<void> {
    const config = job.config;
    if (config.checkpoints && config.checkpoints.length > 0) {
      const lastCheckpoint = config.checkpoints[config.checkpoints.length - 1];
      this.updateJobStatus(job.id, 'PENDING');
      this.updateJobProgress(job.id, job.progress, {
        lastProcessedBlock: lastCheckpoint.block,
        lastProcessedTimestamp: lastCheckpoint.timestamp,
      });
    } else {
      this.updateJobStatus(job.id, 'FAILED', 'No valid checkpoint found for recovery');
    }
  }

  private async cleanupFailedJobs(): Promise<void> {
    try {
      // Find failed jobs older than 7 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      const failedJobs = await prisma.indexingJob.findMany({
        where: {
          status: 'FAILED',
          updatedAt: {
            lt: cutoffDate
          }
        },
        include: {
          webhooks: true
        }
      });

      for (const job of failedJobs) {
        try {
          // Delete associated webhooks
          for (const webhook of job.webhooks) {
            await HeliusWebhookService.getInstance(job.userId).deleteWebhook(webhook.id);
          }

          // Delete the job
          await prisma.indexingJob.delete({
            where: { id: job.id }
          });

          logInfo('Cleaned up failed job', {
            component: 'JobProcessor',
            action: 'cleanupFailedJobs',
            jobId: job.id
          });
        } catch (error) {
          logError('Failed to cleanup job', error as Error, {
            component: 'JobProcessor',
            action: 'cleanupFailedJobs',
            jobId: job.id
          });
        }
      }
    } catch (error) {
      logError('Failed to cleanup failed jobs', error as Error, {
        component: 'JobProcessor',
        action: 'cleanupFailedJobs'
      });
    }
  }

  public async recoverInterruptedJobs(): Promise<void> {
    try {
      const interruptedJobs = await prisma.indexingJob.findMany({
        where: {
          status: {
            in: ['RUNNING', 'INTERRUPTED']
          }
        }
      });

      for (const job of interruptedJobs) {
        try {
          // Check if job has a valid checkpoint to resume from
          const config = job.config as JobConfig;
          if (config.checkpoints && config.checkpoints.length > 0) {
            const lastCheckpoint = config.checkpoints[config.checkpoints.length - 1];
            
            await this.updateJobStatus(job.id, 'PENDING');
            await this.updateJobProgress(job.id, job.progress, {
              lastProcessedBlock: lastCheckpoint.block,
              lastProcessedTimestamp: lastCheckpoint.timestamp
            });

            // Schedule the job for processing
            await this.startJob(job.id);
          } else {
            // No valid checkpoint, mark as failed
            await this.updateJobStatus(job.id, 'FAILED', 'No valid checkpoint found for recovery');
          }
        } catch (error) {
          logError('Failed to recover job', error as Error, {
            component: 'JobProcessor',
            action: 'recoverInterruptedJobs',
            jobId: job.id
          });
        }
      }
    } catch (error) {
      logError('Failed to recover interrupted jobs', error as Error, {
        component: 'JobProcessor',
        action: 'recoverInterruptedJobs'
      });
    }
  }

  private async updateProgress(jobId: string, progress: number): Promise<void> {
    try {
      await prisma.indexingJob.update({
        where: { id: jobId },
        data: { progress: Math.min(100, Math.max(0, progress)) }
      });
    } catch (error) {
      logError('Failed to update job progress', error as Error, {
        component: 'JobProcessor',
        action: 'updateProgress',
        jobId,
        progress
      });
    }
  }

  private async getJobConfig(jobId: string): Promise<any> {
    const job = await prisma.indexingJob.findUnique({
      where: { id: jobId },
      select: { config: true }
    });
    return job?.config || {};
  }
} 