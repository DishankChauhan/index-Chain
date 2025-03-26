import { Pool } from 'pg';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { AppError } from '@/lib/utils/errorHandling';
import { RateLimiter } from '@/lib/utils/rateLimiter';
import { CircuitBreaker } from '@/lib/utils/circuitBreaker';
import { SecretsManager } from '@/lib/utils/secrets';
import {
  HeliusTransaction,
  HeliusWebhookData,
  HeliusErrorResponse
} from '@/lib/types/helius';
import { NFTBidService } from './nftBidService';
import { NFTPriceService } from './nftPriceService';
import { LendingService } from './lendingService';
import { TokenPriceService } from './tokenPriceService';
import prisma from '@/lib/db';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@/lib/utils/logger';

const HELIUS_API_URL = process.env.HELIUS_API_URL || 'https://api.helius.xyz';

export class HeliusDataService {
  private static instances: Map<string, HeliusDataService> = new Map();
  private readonly userId: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly secretsManager: SecretsManager;
  private readonly nftBidService: NFTBidService;
  private readonly nftPriceService: NFTPriceService;
  private readonly lendingService: LendingService;
  private readonly tokenPriceService: TokenPriceService;
  private readonly prisma: PrismaClient;
  private readonly logger: Logger;

  private constructor(userId: string) {
    if (!userId) throw new Error('User ID is required');
    this.userId = userId;
    this.rateLimiter = RateLimiter.getInstance();
    this.circuitBreaker = CircuitBreaker.getInstance();
    this.secretsManager = SecretsManager.getInstance();
    this.nftBidService = NFTBidService.getInstance();
    this.nftPriceService = NFTPriceService.getInstance();
    this.lendingService = LendingService.getInstance();
    this.tokenPriceService = TokenPriceService.getInstance();
    this.prisma = new PrismaClient();
    this.logger = new Logger('HeliusDataService');
  }

  public static getInstance(userId: string): HeliusDataService {
    if (!this.instances.has(userId)) {
      this.instances.set(userId, new HeliusDataService(userId));
    }
    return this.instances.get(userId)!;
  }

  private async getApiKey(): Promise<string> {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new AppError('Helius API key not found');
    }
    return apiKey;
  }

  public async processWebhookData(webhookData: HeliusWebhookData, indexingJobId: string): Promise<void> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: indexingJobId }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      // Begin transaction
      await this.prisma.$transaction(async (tx) => {
        // Process each event in the webhook data
        for (const event of webhookData.events) {
          switch (event.type) {
            case 'NFT_BID':
              await this.processNFTBid(event, tx);
              break;
            case 'NFT_SALE':
              await this.processNFTSale(event, tx);
              break;
            case 'TOKEN_TRANSFER':
              await this.processTokenTransfer(event, tx);
              break;
            default:
              this.logger.warn('Unknown event type', { type: event.type });
          }
        }

        // Update job progress
        await tx.indexingJob.update({
          where: { id: indexingJobId },
          data: {
            status: 'RUNNING',
            progress: job.progress + (1 / (job.config as any).totalTransactions),
            lastRunAt: new Date()
          }
        });

        // Store processed data
        await tx.processedData.create({
          data: {
            jobId: indexingJobId,
            data: webhookData as any,
            timestamp: new Date()
          }
        });
      });

      this.logger.info('Successfully processed webhook data', {
        signature: webhookData.signature,
        events: webhookData.events.length
      });
    } catch (error) {
      this.logger.error('Failed to process webhook data', { error });
      throw error;
    }
  }

  private async processNFTBid(event: any, tx: any): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO nft_events (
        signature,
        type,
        mint,
        owner,
        price,
        timestamp,
        created_at
      ) VALUES (
        ${event.id},
        'NFT_BID',
        ${event.mint},
        ${event.sourceAddress},
        ${event.amount},
        ${new Date(event.timestamp)},
        NOW()
      )
      ON CONFLICT (signature) DO NOTHING
    `;
  }

  private async processNFTSale(event: any, tx: any): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO nft_events (
        signature,
        type,
        mint,
        owner,
        price,
        timestamp,
        created_at
      ) VALUES (
        ${event.id},
        'NFT_SALE',
        ${event.mint},
        ${event.destinationAddress},
        ${event.amount},
        ${new Date(event.timestamp)},
        NOW()
      )
      ON CONFLICT (signature) DO NOTHING
    `;
  }

  private async processTokenTransfer(event: any, tx: any): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO token_transfers (
        signature,
        type,
        mint,
        from_address,
        to_address,
        amount,
        timestamp,
        created_at
      ) VALUES (
        ${event.id},
        'TOKEN_TRANSFER',
        ${event.mint},
        ${event.sourceAddress},
        ${event.destinationAddress},
        ${event.amount},
        ${new Date(event.timestamp)},
        NOW()
      )
      ON CONFLICT (signature) DO NOTHING
    `;
  }

  public async fetchHistoricalData(indexingJobId: string, filters: any): Promise<void> {
    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: indexingJobId }
      });

      if (!job) {
        throw new AppError('Indexing job not found');
      }

      const apiKey = await this.getApiKey();
      const response = await fetch('https://api.helius.xyz/v0/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          query: {
            accounts: filters.accountAddresses,
            startSlot: filters.startSlot,
            endSlot: filters.endSlot,
            transactionTypes: filters.transactionTypes
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(`Failed to fetch historical data: ${error.message}`);
      }

      const transactions: HeliusTransaction[] = await response.json();
      let processedCount = 0;

      for (const transaction of transactions) {
        await this.processWebhookData({
          events: transaction.events,
          sourceAddress: transaction.events[0]?.sourceAddress || '',
          status: 'success',
          timestamp: transaction.timestamp,
          signature: transaction.signature,
          type: transaction.type,
          raw_data: transaction.raw_data,
          nft: undefined,
          seller: '',
          buyer: '',
          amount: undefined,
          raw: undefined
        }, indexingJobId);

        processedCount++;
        
        // Update progress every 100 transactions
        if (processedCount % 100 === 0) {
          await this.prisma.indexingJob.update({
            where: { id: indexingJobId },
            data: {
              progress: (processedCount / transactions.length) * 100
            }
          });
        }
      }

      // Final progress update
      await this.prisma.indexingJob.update({
        where: { id: indexingJobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          lastRunAt: new Date()
        }
      });

      this.logger.info('Successfully fetched and processed historical data', {
        indexingJobId,
        transactionsProcessed: transactions.length
      });
    } catch (error) {
      this.logger.error('Failed to fetch historical data', { error });
      
      // Update job status to failed
      await this.prisma.indexingJob.update({
        where: { id: indexingJobId },
        data: {
          status: 'FAILED',
          lastRunAt: new Date()
        }
      });

      throw error;
    }
  }
} 