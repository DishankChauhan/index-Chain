import { HeliusWebhookService } from './heliusWebhookService';
import { HeliusDataService } from './heliusDataService';
import { DatabaseService } from './databaseService';
import { AppError, handleError } from '@/lib/utils/errorHandling';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@/lib/utils/logger';
import { IndexingConfig, IndexingJob, IndexingStatus } from '@/lib/types/indexing';

export class HeliusIndexingService {
  private static instances: Map<string, HeliusIndexingService> = new Map();
  private userId: string;
  private prisma: PrismaClient;
  private logger: Logger;
  private webhookService: HeliusWebhookService;
  private dataService: HeliusDataService;
  private databaseService: DatabaseService;

  private constructor(userId: string) {
    this.userId = userId;
    this.prisma = new PrismaClient();
    this.logger = new Logger('HeliusIndexingService');
    this.webhookService = HeliusWebhookService.getInstance(userId);
    this.dataService = HeliusDataService.getInstance(userId);
    this.databaseService = DatabaseService.getInstance();
  }

  public static getInstance(userId: string): HeliusIndexingService {
    if (!this.instances.has(userId)) {
      this.instances.set(userId, new HeliusIndexingService(userId));
    }
    return this.instances.get(userId)!;
  }

  public async setupIndexing(jobId: string, config: IndexingConfig): Promise<void> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId },
        include: {
          databaseConnection: true
        }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      // Create necessary tables based on job configuration
      await this.createIndexingTables(job.databaseConnection.id, config.categories);

      // Set up webhook if enabled
      if (config.webhook?.enabled) {
        const webhookUrl = config.webhook.url;
        const addresses = config.filters?.accountAddresses || [];

        if (!webhookUrl) {
          throw new AppError('Webhook URL is required when webhook is enabled');
        }

        await this.webhookService.createWebhook(jobId, webhookUrl, addresses);
      }

      // Update job metadata
      await this.updateJobMetadata(jobId, {
        tablesCreated: true,
        webhookSetup: config.webhook?.enabled || false
      });

      // Start data fetching if historical data is requested
      if (config.historical?.enabled) {
        await this.startDataFetching(jobId, config.historical.filters);
      }

      this.logger.info('Successfully set up indexing', { jobId });
    } catch (error) {
      this.logger.error('Failed to set up indexing', { error });
      
      // Update job status to failed
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          lastRunAt: new Date()
        }
      });

      throw handleError(error);
    }
  }

  private async createIndexingTables(connectionId: string, categories: string[]): Promise<void> {
    try {
      const connection = await this.prisma.databaseConnection.findUnique({
        where: { id: connectionId }
      });

      if (!connection) {
        throw new AppError('Database connection not found');
      }

      const pool = await this.databaseService.getConnection(connectionId, this.userId);

      // Create NFT-related tables
      if (categories.includes('NFT_BIDS') || categories.includes('NFT_SALES')) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS nft_events (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) UNIQUE NOT NULL,
            mint_address TEXT NOT NULL,
            event_type TEXT NOT NULL,
            price NUMERIC,
            buyer TEXT,
            seller TEXT,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_nft_events_signature ON nft_events(signature);
          CREATE INDEX IF NOT EXISTS idx_nft_events_mint ON nft_events(mint_address);
          CREATE INDEX IF NOT EXISTS idx_nft_events_timestamp ON nft_events(timestamp);
        `);
      }

      // Create token transfer tables
      if (categories.includes('TOKEN_TRANSFERS')) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS token_transfers (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) NOT NULL,
            token_address TEXT NOT NULL,
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            amount NUMERIC NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(signature, token_address)
          );
          CREATE INDEX IF NOT EXISTS idx_token_transfers_signature ON token_transfers(signature);
          CREATE INDEX IF NOT EXISTS idx_token_transfers_token ON token_transfers(token_address);
          CREATE INDEX IF NOT EXISTS idx_token_transfers_timestamp ON token_transfers(timestamp);
        `);
      }

      // Create transaction tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id SERIAL PRIMARY KEY,
          signature VARCHAR(100) UNIQUE NOT NULL,
          slot BIGINT NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          success BOOLEAN NOT NULL,
          fee BIGINT NOT NULL,
          program_ids TEXT[],
          raw_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
        CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
      `);

      this.logger.info('Successfully created indexing tables', { connectionId, categories });
    } catch (error) {
      this.logger.error('Failed to create indexing tables', { error });
      throw handleError(error);
    }
  }

  private async updateJobMetadata(jobId: string, metadata: any): Promise<void> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          config: {
            ...job.config as any,
            metadata
          }
        }
      });
    } catch (error) {
      this.logger.error('Failed to update job metadata', { error });
      throw handleError(error);
    }
  }

  private async startDataFetching(jobId: string, filters: any): Promise<void> {
    try {
      // Update job status to running
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          status: 'RUNNING',
          lastRunAt: new Date()
        }
      });

      // Start fetching historical data
      await this.dataService.fetchHistoricalData(jobId, filters);
    } catch (error) {
      this.logger.error('Failed to start data fetching', { error });
      throw handleError(error);
    }
  }

  public async stopIndexing(jobId: string): Promise<void> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId },
        include: {
          webhooks: true
        }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      // Delete all associated webhooks
      for (const webhook of job.webhooks) {
        await this.webhookService.deleteWebhook(webhook.heliusWebhookId);
      }

      // Update job status
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          status: 'STOPPED',
          lastRunAt: new Date()
        }
      });

      this.logger.info('Successfully stopped indexing', { jobId });
    } catch (error) {
      this.logger.error('Failed to stop indexing', { error });
      throw handleError(error);
    }
  }

  public async getIndexingStatus(jobId: string): Promise<IndexingStatus> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId },
        include: {
          webhooks: true,
          processedData: {
            orderBy: {
              timestamp: 'desc'
            },
            take: 1
          }
        }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      return {
        status: job.status,
        progress: job.progress,
        lastRunAt: job.lastRunAt || undefined,
        webhooks: job.webhooks.map(w => ({
          id: w.heliusWebhookId,
          url: w.url,
          status: w.status
        })),
        lastProcessedData: job.processedData[0]?.timestamp || undefined
      };
    } catch (error) {
      this.logger.error('Failed to get indexing status', { error });
      throw handleError(error);
    }
  }
} 