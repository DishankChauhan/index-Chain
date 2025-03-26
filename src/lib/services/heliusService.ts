import { Pool, PoolClient } from 'pg';
import { IndexingJob, IndexingConfig } from '@/types';
import { AppError } from '@/lib/utils/errorHandling';
import { DatabaseService } from './databaseService';
import { JobService } from './jobService';
import { logError, logInfo, logDebug, logWarn } from '@/lib/utils/serverLogger';
import { SecretsManager } from '@/lib/utils/secrets';
import { RateLimiter } from '@/lib/utils/rateLimiter';
import { CircuitBreaker } from '@/lib/utils/circuitBreaker';
import {
  HeliusTransaction,
  HeliusWebhookData,
  HeliusWebhookRequest,
  HeliusWebhookResponse,
  HeliusErrorResponse,
  HeliusWebhook
} from '@/lib/types/helius';
import { NFTBidService } from './nftBidService';
import { NFTPriceService } from './nftPriceService';
import { LendingService } from './lendingService';
import { TokenPriceService } from './tokenPriceService';
import { PrismaClient } from '@prisma/client';
import prisma from '@/lib/db';
import { WebhookHandler } from './webhookHandler';

class HeliusError extends Error {
  constructor(message: string, public readonly details?: any) {
    super(message);
    this.name = 'HeliusError';
  }
}

const HELIUS_API_URL = 'https://api.helius.xyz';

interface JobMetadata {
  lastProcessedTimestamp: number;
  processedCount: number;
  errorCount: number;
}

export class HeliusService {
  private static instances: Map<string, HeliusService> = new Map();
  private readonly dbService: DatabaseService;
  private readonly userId: string;
  private jobService: JobService;
  private secretsManager: SecretsManager;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private baseUrl: string;
  private nftBidService: NFTBidService;
  private nftPriceService: NFTPriceService;
  private lendingService: LendingService;
  private tokenPriceService: TokenPriceService;
  private prisma: PrismaClient;
  private webhookHandler: WebhookHandler;

  private constructor(userId: string) {
    if (!userId) {
      throw new Error('User ID is required');
    }
    this.dbService = DatabaseService.getInstance();
    this.userId = userId;
    this.jobService = JobService.getInstance();
    this.secretsManager = SecretsManager.getInstance();
    this.rateLimiter = RateLimiter.getInstance();
    this.circuitBreaker = CircuitBreaker.getInstance();
    this.baseUrl = HELIUS_API_URL;
    this.nftBidService = NFTBidService.getInstance();
    this.nftPriceService = NFTPriceService.getInstance();
    this.lendingService = LendingService.getInstance();
    this.tokenPriceService = TokenPriceService.getInstance();
    this.prisma = new PrismaClient();
    this.webhookHandler = WebhookHandler.getInstance(userId);
  }

  public static getInstance(userId: string): HeliusService {
    if (!this.instances.has(userId)) {
      this.instances.set(userId, new HeliusService(userId));
    }
    return this.instances.get(userId)!;
  }

  /**
   * Cleans up resources and connections
   */
  public async cleanup(): Promise<void> {
    try {
      // Reset the singleton instance
      HeliusService.instances.clear();
      
      // Clean up any open database connections
      await this.dbService.cleanup();
      
      // Clean up any open resources in other services
      await this.jobService.cleanup();
    } catch (error) {
      logError('Failed to cleanup HeliusService', error as Error, {
        component: 'HeliusService',
        action: 'cleanup',
        userId: this.userId
      });
      // Don't throw the error as this is cleanup code
    }
  }

  private async getApiKey(): Promise<string> {
    try {
      return await this.secretsManager.getSecret('HELIUS_API_KEY');
    } catch (error) {
      const apiKey = process.env.HELIUS_API_KEY;
      if (!apiKey) {
        throw new AppError('Helius API key not found');
      }
      await this.secretsManager.setSecret('HELIUS_API_KEY', apiKey);
      return apiKey;
    }
  }

  private async makeRequest<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    // Check rate limit
    if (!(await this.rateLimiter.waitForToken('helius'))) {
      logWarn('Rate limit exceeded for Helius API', {
        component: 'HeliusService',
        action: 'makeRequest',
        endpoint,
        userId: this.userId
      });
      throw new AppError('Rate limit exceeded for Helius API');
    }

    return this.circuitBreaker.executeWithRetry('helius', async () => {
      try {
        const apiKey = await this.getApiKey();
        const url = new URL(endpoint, this.baseUrl);
        url.searchParams.append('api-key', apiKey);

        logDebug('Making request to Helius API', {
          component: 'HeliusService',
          action: 'makeRequest',
          endpoint,
          method,
          userId: this.userId
        });

        const response = await fetch(url.toString(), {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
          const errorData = await response.json() as HeliusErrorResponse;
          logError('Helius API request failed', new HeliusError(errorData.message || 'API request failed'), {
            component: 'HeliusService',
            action: 'makeRequest',
            endpoint,
            method,
            statusCode: response.status,
            statusText: response.statusText,
            errorMessage: errorData.message,
            userId: this.userId
          });
          throw new HeliusError(errorData.message || 'API request failed', {
            status: response.status,
            statusText: response.statusText,
          });
        }

        return await response.json() as T;
      } catch (error) {
        if (error instanceof HeliusError) {
          throw error;
        }
        
        logError('Unexpected error in Helius API request', error as Error, {
          component: 'HeliusService',
          action: 'makeRequest',
          endpoint,
          method,
          userId: this.userId
        });
        
        throw new HeliusError(
          (error as Error).message || 'Unexpected error in API request',
          { originalError: error }
        );
      }
    });
  }

  /**
   * Cleans up inactive webhooks and ensures we're under the limit
   */
  private async cleanupWebhooks(): Promise<void> {
    try {
      // Use the makeRequest method for better error handling and rate limiting
      interface HeliusWebhooksResponse {
        webhooks: HeliusWebhook[];
      }
      
      const webhooksResponse = await this.makeRequest<HeliusWebhooksResponse>('/webhooks', 'GET');
      const webhooks = webhooksResponse.webhooks;
      
      logInfo('Retrieved webhooks for cleanup', {
        component: 'HeliusService',
        action: 'cleanupWebhooks',
        webhookCount: webhooks.length,
        userId: this.userId
      });

      // Get all webhooks from our database
      const dbWebhooks = await this.prisma.webhook.findMany({
        where: {
          userId: this.userId
        }
      });

      // Find webhooks to delete (inactive or not in our DB)
      const webhooksToDelete = webhooks.filter(webhook => {
        const dbWebhook = dbWebhooks.find(dbw => dbw.heliusWebhookId === webhook.webhookId);
        
        // Delete if not in our DB or if it's inactive and older than 1 day
        const notInOurDb = !dbWebhook;
        const isInactive = dbWebhook?.status !== 'active';
        const isOld = dbWebhook && new Date(dbWebhook.updatedAt).getTime() < Date.now() - 86400000; // 24 hours
        
        return notInOurDb || (isInactive && isOld);
      });

      // Delete webhooks
      for (const webhook of webhooksToDelete) {
        try {
          await this.deleteWebhook(webhook.webhookId);
          logInfo('Deleted inactive webhook', {
            component: 'HeliusService',
            action: 'cleanupWebhooks',
            webhookId: webhook.webhookId,
            userId: this.userId
          });
        } catch (error) {
          logError('Failed to delete webhook', error as Error, {
            component: 'HeliusService',
            action: 'cleanupWebhooks',
            webhookId: webhook.webhookId,
            userId: this.userId
          });
          // Continue with other webhooks
          continue;
        }
      }
    } catch (error) {
      logError('Failed to cleanup webhooks', error as Error, {
        component: 'HeliusService',
        action: 'cleanupWebhooks',
        userId: this.userId
      });
      throw error;
    }
  }

  /**
   * Creates a webhook for transaction monitoring
   */
  async createWebhook(params: {
    accountAddresses: string[];
    programIds: string[];
    webhookURL: string;
    webhookSecret: string;
  }): Promise<{ webhookId: string }> {
    const { accountAddresses, programIds, webhookURL, webhookSecret } = params;

    try {
      // Validate webhook URL
      if (!webhookURL || !webhookURL.startsWith('http')) {
        throw new HeliusError('Invalid webhook URL. Must be a valid HTTP(S) URL');
      }

      // First try to find an existing webhook we can reuse
      const existingWebhook = await this.prisma.webhook.findFirst({
        where: {
          userId: this.userId,
          status: 'active',
          filters: {
            path: ['programIds'],
            array_contains: programIds[0]
          }
        }
      });

      if (existingWebhook) {
        logInfo('Reusing existing webhook', {
          component: 'HeliusService',
          action: 'createWebhook',
          webhookId: existingWebhook.heliusWebhookId
        });
        return { webhookId: existingWebhook.heliusWebhookId };
      }

      // Check rate limit
      if (!(await this.rateLimiter.waitForToken('helius'))) {
        throw new AppError('Rate limit exceeded');
      }

      // Clean up inactive webhooks before creating new one
      await this.cleanupWebhooks();

      // Use circuit breaker for retries
      return await this.circuitBreaker.executeWithRetry('helius', async () => {
        // Get API key
        const apiKey = await this.getApiKey();

        // Combine programIds and accountAddresses for monitoring
        const allAddresses = [...accountAddresses, ...programIds];

        // Prepare request body according to Helius docs
        const webhookRequest: HeliusWebhookRequest = {
          webhookURL,
          transactionTypes: ['NFT_SALE', 'NFT_LISTING', 'NFT_BID', 'NFT_BID_CANCELLED'],
          accountAddresses: allAddresses,
          webhookType: 'enhanced',
          authHeader: webhookSecret
        };

        logInfo('Creating webhook with request', {
          component: 'HeliusService',
          action: 'createWebhook',
          webhookURL,
          accountAddressesCount: allAddresses.length,
          transactionTypes: webhookRequest.transactionTypes
        });

        // Make API request
        const response = await fetch(`${this.baseUrl}/v0/webhooks?api-key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(webhookRequest)
        });

        // Handle error responses
        if (!response.ok) {
          const errorText = await response.text();
          let errorData: HeliusErrorResponse;
          
          try {
            errorData = JSON.parse(errorText) as HeliusErrorResponse;
          } catch (e) {
            errorData = { error: errorText };
          }
          
          // If we hit webhook limit, try to reuse an existing webhook
          if (errorData.error?.toLowerCase().includes('webhook limit')) {
            const existingWebhooks = await this.listWebhooks();
            if (existingWebhooks.length > 0) {
              logInfo('Webhook limit reached, reusing existing webhook', {
                component: 'HeliusService',
                action: 'createWebhook',
                webhookId: existingWebhooks[0].webhookId
              });
              
              return { webhookId: existingWebhooks[0].webhookId };
            }
          }
          
          throw new HeliusError(
            `Webhook creation failed: ${errorData.error || response.statusText}`,
            { status: response.status, error: errorData }
          );
        }

        // Parse successful response
        const responseData = await response.text();
        let data: HeliusWebhookResponse;
        
        try {
          data = JSON.parse(responseData) as HeliusWebhookResponse;
          
          // Ensure the response contains a webhookId
          if (!data.webhookId) {
            throw new Error('Response missing webhookId');
          }
        } catch (e) {
          logError('Failed to parse webhook response', e as Error, {
            component: 'HeliusService',
            action: 'createWebhook',
            responseData
          });
          
          throw new HeliusError(
            `Failed to parse webhook response: ${e instanceof Error ? e.message : 'Unknown error'}`,
            { responseData, error: e }
          );
        }
        
        logInfo('Successfully created webhook', {
          component: 'HeliusService',
          action: 'createWebhook',
          webhookId: data.webhookId
        });
        
        return { webhookId: data.webhookId };
      });
    } catch (error) {
      if (error instanceof HeliusError) {
        const message = error.message.toLowerCase();
        if (message.includes('webhook limit')) {
          // If we hit the limit, force cleanup all webhooks
          await this.forceCleanupAllWebhooks();
          // And try one more time
          return this.createWebhook(params);
        }
        throw error;
      }
      throw new HeliusError(
        `Failed to create webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Force cleanup all webhooks when we hit the limit
   */
  private async forceCleanupAllWebhooks(): Promise<void> {
    try {
      const apiKey = await this.getApiKey();
      
      // Get all webhooks from Helius
      const response = await fetch(`${this.baseUrl}/v0/webhooks?api-key=${apiKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json() as HeliusErrorResponse;
        throw new HeliusError(`Failed to fetch webhooks: ${errorData.error || response.statusText}`);
      }

      interface HeliusWebhooksResponse {
        webhooks: HeliusWebhook[];
      }

      const data = await response.json() as HeliusWebhooksResponse;
      const webhooks = data.webhooks || [];
      
      // Delete all webhooks except the most recent one
      const sortedWebhooks = webhooks.sort((a, b) => {
        // If we don't have createdAt, we'll just keep the first one in the array
        return -1; // Keep first webhook, delete all others
      });

      for (let i = 1; i < sortedWebhooks.length; i++) {
        try {
          await this.deleteWebhook(sortedWebhooks[i].webhookId);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between deletions
        } catch (error) {
          logError('Failed to delete webhook during force cleanup', error as Error, {
            component: 'HeliusService',
            action: 'forceCleanupAllWebhooks',
            webhookId: sortedWebhooks[i].webhookId
          });
        }
      }

      // Update our database
      await this.prisma.webhook.updateMany({
        where: {
          userId: this.userId,
          status: 'active'
        },
        data: {
          status: 'inactive'
        }
      });

      logInfo('Force cleaned up all webhooks', {
        component: 'HeliusService',
        action: 'forceCleanupAllWebhooks',
        deletedCount: sortedWebhooks.length - 1
      });
    } catch (error) {
      logError('Failed to force cleanup webhooks', error as Error, {
        component: 'HeliusService',
        action: 'forceCleanupAllWebhooks'
      });
      throw error;
    }
  }

  /**
   * Deletes a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    try {
      // Check rate limit
      if (!(await this.rateLimiter.waitForToken('helius'))) {
        throw new AppError('Rate limit exceeded');
      }

      // Use circuit breaker for retries
      await this.circuitBreaker.executeWithRetry('helius', async () => {
        // Get API key
        const apiKey = await this.getApiKey();

        // Make API request
        const response = await fetch(`${this.baseUrl}/v0/webhooks/${webhookId}?api-key=${apiKey}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        // Handle error responses
        if (!response.ok) {
          const errorText = await response.text();
          let errorData: HeliusErrorResponse;
          
          try {
            errorData = JSON.parse(errorText) as HeliusErrorResponse;
          } catch (e) {
            errorData = { error: errorText };
          }
          
          // 404 means webhook doesn't exist, which is fine when deleting
          if (response.status === 404) {
            return;
          }
          
          throw new HeliusError(
            `Webhook deletion failed: ${errorData.error || response.statusText}`,
            { status: response.status, error: errorData }
          );
        }
      });

      logInfo('Successfully deleted webhook', {
        component: 'HeliusService',
        action: 'deleteWebhook',
        webhookId
      });
    } catch (error) {
      if (error instanceof HeliusError) {
        throw error;
      }
      throw new HeliusError(
        `Failed to delete webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Sets up indexing for a job by creating necessary database tables and webhook
   */
  async setupIndexing(job: IndexingJob, pool: Pool): Promise<void> {
    try {
      // Create necessary tables
      await this.createIndexingTables(pool, job.config);

      // Setup webhook if enabled
      if (job.config.webhook?.enabled && job.config.webhook?.url) {
        // Ensure webhook URL uses port 3000
        const webhookURL = job.config.webhook.url.replace(':3001/', ':3000/');
        
        // First check for any existing webhooks we can reuse
        const existingWebhooks = await this.listWebhooks();
        
        if (existingWebhooks.length > 0) {
          // If we already have webhooks, reuse the first one
          const webhookId = existingWebhooks[0].webhookId;
          
          logInfo('Reusing existing webhook', {
            component: 'HeliusService',
            action: 'setupIndexing',
            webhookId
          });
          
          // Update job metadata with webhook ID
          await this.updateJobMetadata(job.id, {
            webhookId,
            setupAt: new Date().toISOString()
          });
          
          return;
        }
        
        // If no webhooks exist, create a new one
        const { webhookId } = await this.createWebhook({
          accountAddresses: job.config.filters?.accounts || [],
          programIds: job.config.filters?.programIds || [],
          webhookURL,
          webhookSecret: job.config.webhook.secret || ''
        });

        // Update job metadata with webhook ID
        await this.updateJobMetadata(job.id, {
          webhookId,
          setupAt: new Date().toISOString()
        });
      }
    } catch (error) {
      throw new HeliusError(
        `Failed to setup indexing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Creates necessary database tables for indexing based on job configuration
   */
  private async createIndexingTables(pool: Pool, config: IndexingConfig): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (config.categories.nftBids) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS nft_bids (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) NOT NULL,
            mint_address TEXT NOT NULL,
            bidder_address TEXT NOT NULL,
            bid_amount NUMERIC NOT NULL,
            marketplace TEXT NOT NULL,
            status TEXT NOT NULL,
            expires_at TIMESTAMP,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_nft_bids_signature ON nft_bids(signature);
          CREATE INDEX IF NOT EXISTS idx_nft_bids_mint ON nft_bids(mint_address);
        `);
      }

      if (config.categories.nftPrices) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS nft_prices (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) NOT NULL,
            mint_address TEXT NOT NULL,
            price NUMERIC NOT NULL,
            marketplace TEXT NOT NULL,
            seller_address TEXT,
            status TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_nft_prices_signature ON nft_prices(signature);
          CREATE INDEX IF NOT EXISTS idx_nft_prices_mint ON nft_prices(mint_address);
        `);
      }

      if (config.categories.tokenPrices) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS token_prices (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) NOT NULL,
            token_address TEXT NOT NULL,
            price_usd NUMERIC NOT NULL,
            volume_24h NUMERIC,
            platform TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_token_prices_signature ON token_prices(signature);
          CREATE INDEX IF NOT EXISTS idx_token_prices_token ON token_prices(token_address);
        `);
      }

      if (config.categories.tokenBorrowing) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS lending_rates (
            id SERIAL PRIMARY KEY,
            signature VARCHAR(100) NOT NULL,
            token_address TEXT NOT NULL,
            protocol TEXT NOT NULL,
            borrow_rate NUMERIC NOT NULL,
            supply_rate NUMERIC NOT NULL,
            total_supply NUMERIC NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            raw_data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_lending_rates_signature ON lending_rates(signature);
          CREATE INDEX IF NOT EXISTS idx_lending_rates_token ON lending_rates(token_address);
        `);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Updates job metadata with webhook information
   */
  private async updateJobMetadata(
    jobId: string,
    metadata: { webhookId: string; setupAt: string }
  ): Promise<void> {
    // Implementation depends on your job storage mechanism
    // This is a placeholder that should be implemented based on your needs
    logInfo('Updating job metadata', {
      component: 'HeliusService',
      action: 'updateJobMetadata',
      jobId,
      metadata: JSON.stringify(metadata)
    });
  }

  /**
   * Processes webhook data by inserting it into appropriate tables
   */
  async processWebhookData(pool: Pool, data: any[], config: IndexingConfig): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const transaction of data) {
        if (config.categories.nftBids) {
          await this.nftBidService.processBidEvent(transaction, pool);
        }
        if (config.categories.nftPrices) {
          await this.nftPriceService.processPriceEvent(transaction, pool);
        }
        if (config.categories.tokenPrices) {
          await this.tokenPriceService.processPriceEvent(transaction, pool);
        }
        if (config.categories.tokenBorrowing) {
          await this.lendingService.processLendingEvent(transaction, pool);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new HeliusError('Failed to process webhook data', error);
    } finally {
      client.release();
    }
  }

  private async processNFTTransaction(transaction: HeliusWebhookData, connectionId: string): Promise<void> {
    try {
      // Try to get database connection from the job
      let pool: Pool | null = null;
      let usingPrimary = false;
      
      try {
        // Try to get the connection for the job
        pool = await this.dbService.getConnection(connectionId, this.userId);
      } catch (error) {
        logWarn('Failed to get job database connection, trying primary database', {
          component: 'HeliusService',
          action: 'processNFTTransaction',
          signature: transaction.signature,
          connectionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Fallback to primary database using DATABASE_URL
        try {
          // Use the primary database connection from env
          const primaryPool = new Pool({
            connectionString: process.env.DATABASE_URL
          });
          
          // Test the connection
          await primaryPool.query('SELECT NOW()');
          pool = primaryPool;
          usingPrimary = true;
          
          logInfo('Using primary database as fallback', {
            component: 'HeliusService',
            action: 'processNFTTransaction',
            signature: transaction.signature
          });
        } catch (dbError) {
          logError('Failed to connect to primary database', dbError as Error, {
            component: 'HeliusService',
            action: 'processNFTTransaction',
            signature: transaction.signature
          });
          throw new Error('No available database connection');
        }
      }
      
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Process NFT bids and prices
        try {
          // Only try specialized services with the job's database
          if (!usingPrimary) {
            // Process NFT bids
            const bidService = NFTBidService.getInstance();
            await bidService.processBidEvent(transaction, pool);

            // Process NFT prices
            const priceService = NFTPriceService.getInstance();
            await priceService.processPriceEvent(transaction, pool);
          }
        } catch (error) {
          logWarn('Failed to process with specialized services, falling back to direct insert', {
            component: 'HeliusService',
            action: 'processNFTTransaction',
            signature: transaction.signature,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // Direct insertion for NFT_SALE events to ensure data is captured
        if (transaction.type === 'NFT_SALE' && transaction.nft?.mint) {
          await this.insertNFTEvent(client, {
            signature: transaction.signature,
            mint_address: transaction.nft.mint,
            event_type: transaction.type,
            price: transaction.amount ? transaction.amount / 1e9 : 0, // Convert lamports to SOL
            buyer: transaction.buyer || '',
            seller: transaction.seller || '',
            timestamp: new Date(transaction.timestamp),
            raw_data: transaction as unknown as Record<string, unknown> // Proper type conversion
          });
          
          logInfo('Inserted NFT sale event directly', {
            component: 'HeliusService',
            action: 'processNFTTransaction',
            signature: transaction.signature,
            mint: transaction.nft.mint,
            usingPrimary
          });
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
        
        // If we created a new pool for primary DB, close it
        if (usingPrimary && pool) {
          try {
            await pool.end();
          } catch (endError) {
            logWarn('Error closing primary pool', {
              component: 'HeliusService',
              action: 'processNFTTransaction'
            });
          }
        }
      }
    } catch (error) {
      logError('Failed to process NFT transaction', error as Error, {
        component: 'HeliusService',
        action: 'processNFTTransaction',
        signature: transaction.signature
      });
      throw error;
    }
  }

  /**
   * Directly inserts an NFT event into the nft_events table
   */
  private async insertNFTEvent(client: PoolClient, event: {
    signature: string;
    mint_address: string;
    event_type: string;
    price: number;
    buyer: string;
    seller: string;
    timestamp: Date;
    raw_data: any;
  }): Promise<void> {
    try {
      await client.query(`
        INSERT INTO nft_events (
          signature, mint_address, event_type, price, buyer, seller, timestamp, raw_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (signature) DO NOTHING
      `, [
        event.signature,
        event.mint_address,
        event.event_type,
        event.price,
        event.buyer,
        event.seller, 
        event.timestamp,
        event.raw_data
      ]);
    } catch (error) {
      logError('Failed to insert NFT event', error as Error, {
        component: 'HeliusService',
        action: 'insertNFTEvent',
        signature: event.signature
      });
      throw error;
    }
  }

  public async handleWebhookData(
    jobId: string,
    userId: string,
    data: HeliusWebhookData[]
  ): Promise<void> {
    const webhook = await prisma.webhook.findFirst({
      where: { indexingJobId: jobId }
    });
    if (!webhook) {
      throw new Error('No webhook found for job');
    }
    await this.webhookHandler.handleWebhookData(jobId, userId, data, webhook.id);
  }

  /**
   * Starts data fetching process for a job
   */
  public async startDataFetching(jobId: string, config: any, dbPool: Pool): Promise<void> {
    try {
      // Update job status to running
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: { 
          status: 'running',
          progress: 10
        }
      });

      logInfo('Starting data fetching for job', {
        component: 'HeliusService',
        action: 'startDataFetching',
        jobId
      });

      // Create webhook if enabled in config
      if (config.webhook?.enabled) {
        try {
          // Generate webhook URL - if the URL contains localhost but we're in production, 
          // replace it with the actual deployed URL
          let webhookURL = config.webhook.url;
          if (process.env.NODE_ENV === 'production' && webhookURL.includes('localhost')) {
            const deployedUrl = process.env.NEXTAUTH_URL || 'https://your-app-domain.vercel.app';
            webhookURL = webhookURL.replace(/http:\/\/localhost(:\d+)?/, deployedUrl);
            logInfo('Replaced localhost URL with deployed URL', {
              component: 'HeliusService',
              action: 'startDataFetching',
              original: config.webhook.url,
              replaced: webhookURL
            });
          }

          // Create the webhook in Helius
          const { webhookId } = await this.createWebhook({
            accountAddresses: config.filters?.accounts || [],
            programIds: config.filters?.programIds || [],
            webhookURL,
            webhookSecret: config.webhook.secret
          });

          // Save webhook details to database
          await this.prisma.webhook.create({
            data: {
              userId: this.userId,
              heliusWebhookId: webhookId,
              url: webhookURL,
              secret: config.webhook.secret,
              indexingJobId: jobId,
              status: 'active',
              filters: {
                accounts: config.filters?.accounts || [],
                programIds: config.filters?.programIds || []
              }
            }
          });

          logInfo('Webhook created and saved to database', {
            component: 'HeliusService',
            action: 'startDataFetching',
            jobId,
            webhookId
          });
        } catch (error) {
          logError('Failed to create webhook, continuing with job', error as Error, {
            component: 'HeliusService',
            action: 'startDataFetching',
            jobId
          });
          
          // Update job status to reflect webhook creation failure
          await this.prisma.indexingJob.update({
            where: { id: jobId },
            data: { 
              status: 'running',
              progress: 20
            }
          });

          // Log the message instead
          logInfo('Webhook creation failed, but job is running. Data collection may be delayed.', {
            component: 'HeliusService',
            action: 'startDataFetching',
            jobId
          });
        }
      }

      // Continue with data fetching based on config
      try {
        // Extract categories and filters from config
        const { categories, filters } = config;
        
        // Determine what needs to be fetched
        const needsNftBids = categories.nftBids;
        const needsNftPrices = categories.nftPrices;
        const needsTokenPrices = categories.tokenPrices;
        const needsLendingData = categories.tokenBorrowing;
        
        // Use specialized services to fetch and store data in the database
        if (needsNftBids) {
          const nftBidService = NFTBidService.getInstance();
          await nftBidService.fetchAndStoreCurrentBids(dbPool);
        }
        
        if (needsNftPrices) {
          const nftPriceService = NFTPriceService.getInstance();
          await nftPriceService.fetchAndStoreCurrentPrices(dbPool);
        }
        
        if (needsTokenPrices) {
          const tokenPriceService = TokenPriceService.getInstance();
          await tokenPriceService.fetchAndStoreCurrentPrices(dbPool);
        }
        
        if (needsLendingData) {
          const lendingService = LendingService.getInstance();
          await lendingService.getAvailableTokens(dbPool, {
            protocolName: undefined,
            minLiquidity: undefined,
            maxBorrowRate: undefined
          });
        }
        
        // If historical transactions are needed
        if (filters?.programIds?.length || filters?.accounts?.length) {
          await this.fetchHistoricalData(jobId, config, dbPool);
        }

        // Update job status to completed
        await this.prisma.indexingJob.update({
          where: { id: jobId },
          data: { 
            status: 'completed',
            progress: 100
          }
        });

        // Log the message instead
        logInfo('Initial data fetch completed. Real-time updates will continue through webhook if enabled.', {
          component: 'HeliusService',
          action: 'startDataFetching',
          jobId
        });
      } catch (error) {
        logError('Error during data fetching', error as Error, {
          component: 'HeliusService',
          action: 'startDataFetching',
          jobId
        });
        
        // Update job status to failed
        await this.prisma.indexingJob.update({
          where: { id: jobId },
          data: { 
            status: 'failed'
          }
        });
        
        // Log the error message
        logError(`Error during data fetching: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error, {
          component: 'HeliusService',
          action: 'startDataFetching',
          jobId
        });
        
        throw error;
      }
    } catch (error) {
      logError('Failed to start data fetching', error as Error, {
        component: 'HeliusService',
        action: 'startDataFetching',
        jobId
      });
      
      // Ensure job is marked as failed
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: { 
          status: 'failed'
        }
      });
      
      // Log the failure message
      logError(`Failed to start data fetching: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error, {
        component: 'HeliusService',
        action: 'startDataFetching',
        jobId
      });
      
      throw error;
    }
  }

  /**
   * Fetches historical data based on job configuration
   */
  public async fetchHistoricalData(jobId: string, config: any, dbPool: Pool): Promise<void> {
    try {
      logInfo('Starting historical data fetch', {
        component: 'HeliusService',
        action: 'fetchHistoricalData',
        jobId
      });
      
      // Update job status
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: { 
          progress: 10
        }
      });
      
      // Extract categories and filters from config
      const { categories, filters } = config;
      const programIds = filters?.programIds || [];
      const accounts = filters?.accounts || [];
      
      // Fetch NFT bids, prices, token prices, and lending data if needed
      if (categories.nftBids || categories.nftPrices || categories.tokenPrices || categories.tokenBorrowing) {
        // Update job progress
        await this.prisma.indexingJob.update({
          where: { id: jobId },
          data: { 
            progress: 50
          }
        });
      }
      
      // If we need historical transactions, fetch them
      if (programIds.length > 0 || accounts.length > 0) {
        await this.fetchHistoricalTransactions(jobId, programIds, accounts, dbPool);
      }
      
      // Update job progress
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: { 
          progress: 100
        }
      });
      
      // Log the message
      logInfo('Historical data fetch completed', {
        component: 'HeliusService',
        action: 'fetchHistoricalData',
        jobId
      });
    } catch (error) {
      logError('Failed to fetch historical data', error as Error, {
        component: 'HeliusService',
        action: 'fetchHistoricalData',
        jobId
      });
      
      // Update job status
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: { 
          status: 'failed'
        }
      });
      
      // Log the message
      logError(`Failed to fetch historical data: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error, {
        component: 'HeliusService',
        action: 'fetchHistoricalData',
        jobId
      });
      
      throw error;
    }
  }
  
  /**
   * Fetches historical transactions for specified programs and accounts
   */
  private async fetchHistoricalTransactions(jobId: string, programIds: string[], accounts: string[], dbPool: Pool): Promise<void> {
    try {
      logInfo('Fetching historical transactions', {
        component: 'HeliusService',
        action: 'fetchHistoricalTransactions',
        jobId,
        programIds,
        accounts
      });
      
      // API parameters
      const batchSize = 100;
      const maxTransactions = 5000; // Limit total transactions to avoid overloading
      
      // Combine program IDs and accounts as targets
      const targets = [...programIds, ...accounts];
      
      // Process each target
      let processedTransactions = 0;
      let currentProgress = 50; // Start at 50% progress
      
      for (const target of targets) {
        if (processedTransactions >= maxTransactions) break;
        
        // Check rate limit
        await this.rateLimiter.waitForToken('helius');
        
        // Fetch transactions for this target
        const transactions = await this.fetchTransactions(target, batchSize);
        
        // Process transactions
        for (const transaction of transactions) {
          // Store transaction in database
          await this.storeTransaction(transaction, dbPool);
          
          processedTransactions++;
          
          // Update progress every 100 transactions
          if (processedTransactions % 100 === 0) {
            currentProgress = Math.min(90, 50 + Math.floor((processedTransactions / maxTransactions) * 40));
            await this.prisma.indexingJob.update({
              where: { id: jobId },
              data: { 
                progress: currentProgress
              }
            });
          }
          
          if (processedTransactions >= maxTransactions) break;
        }
      }
      
      // Log the message
      logInfo(`Processed ${processedTransactions} historical transactions`, {
        component: 'HeliusService',
        action: 'fetchHistoricalTransactions',
        jobId,
        processedTransactions
      });
    } catch (error) {
      logError('Failed to fetch historical transactions', error as Error, {
        component: 'HeliusService',
        action: 'fetchHistoricalTransactions',
        jobId
      });
      throw error;
    }
  }

  /**
   * Fetches transactions for a specified address or program ID
   */
  private async fetchTransactions(address: string, limit: number): Promise<HeliusTransaction[]> {
    try {
      // Get API key
      const apiKey = await this.getApiKey();
      
      // Make API request to get transactions
      const url = `${this.baseUrl}/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }
      
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logError('Failed to fetch transactions', error as Error, {
        component: 'HeliusService',
        action: 'fetchTransactions',
        address
      });
      return [];
    }
  }

  /**
   * Stores transaction data in the database
   */
  private async storeTransaction(transaction: HeliusTransaction, dbPool: Pool): Promise<void> {
    try {
      const client = await dbPool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Store basic transaction data
        await client.query(
          `INSERT INTO transactions (
            signature,
            slot,
            timestamp,
            success,
            fee,
            program_ids,
            raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (signature) DO NOTHING`,
          [
            transaction.signature,
            transaction.slot,
            new Date(transaction.timestamp),
            true, // Assume success for historical transactions
            transaction.fee,
            transaction.accountData?.map((acc: { program: string }) => acc.program) || [],
            transaction as unknown as Record<string, unknown> // Proper type conversion
          ]
        );
        
        // Process based on transaction type if available
        if (transaction.type) {
          // Create a normalized webhook data object
          const webhookData: HeliusWebhookData = {
            signature: transaction.signature,
            timestamp: transaction.timestamp,
            type: transaction.type,
            fee: transaction.fee,
            slot: transaction.slot,
            nativeTransfers: transaction.nativeTransfers || [],
            tokenTransfers: transaction.tokenTransfers || [],
            accountData: transaction.accountData || [],
            events: [],
            sourceAddress: '',
            status: 'success',
            nft: transaction.type?.startsWith('NFT_') ? { mint: '' } : undefined, // Provide minimal nft object if needed
            amount: 0,
            seller: '',
            buyer: '',
            raw_data: transaction as unknown as Record<string, unknown> // Proper type conversion
            ,
            raw: undefined
          };
          
          // Process NFT data if present
          if (transaction.type?.startsWith('NFT_')) {
            const nftBidService = NFTBidService.getInstance();
            await nftBidService.processBidEvent(webhookData, dbPool);
            
            const nftPriceService = NFTPriceService.getInstance();
            await nftPriceService.processPriceEvent(webhookData, dbPool);
          }
          
          // Process token data if present
          if (transaction.type === 'TOKEN_TRANSFER') {
            const tokenPriceService = TokenPriceService.getInstance();
            await tokenPriceService.processPriceEvent(webhookData, dbPool);
          }
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logError('Failed to store transaction', error as Error, {
        component: 'HeliusService',
        action: 'storeTransaction',
        signature: transaction.signature
      });
    }
  }

  /**
   * List all webhooks
   */
  async listWebhooks(): Promise<HeliusWebhook[]> {
    try {
      // Get API key
      const apiKey = await this.getApiKey();
      
      // Make API request
      const response = await fetch(`${this.baseUrl}/v0/webhooks?api-key=${apiKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: HeliusErrorResponse;
        
        try {
          errorData = JSON.parse(errorText) as HeliusErrorResponse;
        } catch (e) {
          errorData = { error: errorText };
        }
        
        throw new HeliusError(
          `Failed to list webhooks: ${errorData.error || response.statusText}`,
          { status: response.status, error: errorData }
        );
      }

      const webhooks = await response.json();
      // Helius API may return the data directly as an array or nested in a webhooks field
      return Array.isArray(webhooks) 
        ? (webhooks as HeliusWebhook[]) 
        : ((webhooks as {webhooks?: HeliusWebhook[]}).webhooks || []);
    } catch (error) {
      logError('Failed to list webhooks', error as Error, {
        component: 'HeliusService',
        action: 'listWebhooks'
      });
      return [];
    }
  }
} 