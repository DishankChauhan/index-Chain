import { logError, logInfo } from '@/lib/utils/serverLogger';
import prisma from '@/lib/db';
import { DatabaseService } from './databaseService';
import { Pool } from 'pg';
import { HeliusWebhookData } from '@/lib/types/helius';
import { AppError } from '@/lib/utils/errorHandling';

export class WebhookHandler {
  private static instances: Map<string, WebhookHandler> = new Map();
  private userId: string;
  private dbService: DatabaseService;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // Base delay in ms

  private constructor(userId: string) {
    this.userId = userId;
    this.dbService = DatabaseService.getInstance();
  }

  public static getInstance(userId: string): WebhookHandler {
    if (!this.instances.has(userId)) {
      this.instances.set(userId, new WebhookHandler(userId));
    }
    return this.instances.get(userId)!;
  }

  public async handleWebhookData(
    jobId: string,
    userId: string,
    data: HeliusWebhookData[],
    webhookId: string
  ): Promise<void> {
    try {
      // Get job configuration
      const job = await prisma.indexingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        throw new AppError(`Job ${jobId} not found`, 404);
      }

      // Process each webhook data item with retries
      for (const item of data) {
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount < this.maxRetries) {
          try {
            await this.processWebhookItem(item, job.dbConnectionId);
            
            // Log successful processing
            await this.logWebhookAttempt(webhookId, {
              status: 'success',
              attempt: retryCount + 1,
              payload: item,
              error: null
            });
            
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error as Error;
            retryCount++;
            
            // Log failed attempt
            await this.logWebhookAttempt(webhookId, {
              status: 'failed',
              attempt: retryCount,
              payload: item,
              error: error instanceof Error ? error.message : 'Unknown error'
            });

            if (retryCount === this.maxRetries) {
              logError('Max retries reached for webhook item', lastError, {
                component: 'WebhookHandler',
                action: 'handleWebhookData',
                jobId,
                userId,
                signature: item.signature,
                retryCount
              });
              continue; // Move to next item after max retries
            }

            // Exponential backoff
            await new Promise(resolve => 
              setTimeout(resolve, this.retryDelay * Math.pow(2, retryCount - 1))
            );
          }
        }
      }

      logInfo('Successfully processed webhook data', {
        component: 'WebhookHandler',
        action: 'handleWebhookData',
        jobId,
        userId,
        itemCount: data.length
      });
    } catch (error) {
      logError('Failed to handle webhook data', error as Error, {
        component: 'WebhookHandler',
        action: 'handleWebhookData',
        jobId,
        userId
      });
      throw error;
    }
  }

  private async logWebhookAttempt(
    webhookId: string,
    data: {
      status: string;
      attempt: number;
      payload: any;
      error: string | null;
    }
  ): Promise<void> {
    try {
      await prisma.webhookLog.create({
        data: {
          webhookId,
          status: data.status,
          attempt: data.attempt,
          payload: data.payload,
          error: data.error,
          response: {} // Empty object instead of null
        }
      });
    } catch (error) {
      logError('Failed to log webhook attempt', error as Error, {
        component: 'WebhookHandler',
        action: 'logWebhookAttempt',
        webhookId
      });
    }
  }

  private async processWebhookItem(
    item: HeliusWebhookData,
    connectionId: string
  ): Promise<void> {
    let client;
    try {
      const pool = await this.dbService.getConnection(connectionId, this.userId);
      client = await pool.connect();

      await client.query('BEGIN');

      if (item.type === 'NFT_BID' && item.nft?.mint) {
        const bidEvent = item.events.find(event => event.type === 'NFT_BID');
        if (!bidEvent) {
          throw new AppError('No NFT_BID event found in webhook data', 400);
        }

        const bidData = bidEvent.data as {
          bidder: string;
          amount: number;
          marketplace: string;
          status: string;
          expiresAt?: number;
        };

        await client.query(
          `
          INSERT INTO nft_bids (
            signature,
            mint_address,
            bidder_address,
            bid_amount,
            marketplace,
            status,
            expires_at,
            timestamp,
            raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (signature) DO UPDATE SET
            status = EXCLUDED.status,
            expires_at = EXCLUDED.expires_at
          `,
          [
            item.signature,
            item.nft.mint,
            bidData.bidder,
            bidData.amount,
            bidData.marketplace || 'unknown',
            bidData.status || 'active',
            bidData.expiresAt ? new Date(bidData.expiresAt) : null,
            new Date(item.timestamp),
            JSON.stringify(item)
          ]
        );
      }

      await client.query('COMMIT');

      logInfo('Processed webhook item', {
        component: 'WebhookHandler',
        action: 'processWebhookItem',
        signature: item.signature,
        type: item.type
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }
} 