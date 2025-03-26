import { Pool, PoolClient } from 'pg';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { AppError } from '@/lib/utils/errorHandling';
import { HeliusWebhookData, HeliusDASResponse, HeliusAsset } from '../types/helius';
import { RateLimiter } from 'limiter';

interface HeliusErrorResponse {
  error: {
    message: string;
    [key: string]: any;
  };
}

interface HeliusSuccessResponse {
  result: {
    items: HeliusAsset[];
  };
}

type HeliusResponse = HeliusErrorResponse | HeliusSuccessResponse;

export interface NFTBid {
  mintAddress: string;
  bidderAddress: string;
  bidAmount: number;
  marketplace: string;
  currency: string;
  status: 'active' | 'cancelled' | 'accepted' | 'expired';
  expiryTime?: Date;
  timestamp: Date;
  signature: string;
  rawData: any;
}

export interface ActiveBids {
  mintAddress: string;
  marketplace: string;
  currency: string;
  totalBids: number;
  minBid: number;
  maxBid: number;
  avgBid: number;
  bids: Array<{
    bidder: string;
    amount: number;
    timestamp: Date;
  }>;
}

export interface NFTBidEvent {
  nft: {
    mint: string;
    name?: string;
    collection?: string;
  };
  bidder: string;
  amount: number;
  type: string;
  expiryTime?: number;
  timestamp: number;
  signature: string;
  currency?: string;
}

export class NFTBidService {
  fetchAndStoreCurrentBids(dbPool: Pool) {
    throw new Error('Method not implemented.');
  }
  private static instance: NFTBidService | undefined;
  private readonly baseUrl: string;
  private readonly marketplacePrograms: Map<string, string>;

  private constructor() {
    this.baseUrl = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/';
    this.marketplacePrograms = new Map([
      ['M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', 'Magic Eden'],
      ['HYPERfwdTjyJ2SCaKHmpF2MtrXqWxrsotYDsTrshHWq8', 'HyperSpace'],
      ['TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', 'Tensor'],
      ['CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', 'Solanart']
    ]);
  }

  public static getInstance(): NFTBidService {
    if (!NFTBidService.instance) {
      NFTBidService.instance = new NFTBidService();
    }
    return NFTBidService.instance;
  }

  private async getApiKey(): Promise<string> {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new AppError('HELIUS_API_KEY not found in environment');
    }
    return apiKey;
  }

  public async fetchAndStoreData(client: Pool | PoolClient): Promise<void> {
    try {
      logInfo('Starting NFT bid data fetch', {
        component: 'NFTBidService',
        action: 'fetchAndStoreData'
      });

      const apiKey = await this.getApiKey();
      const url = `${this.baseUrl}/v0/token-metadata`;

      const query = {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'searchAssets',
        params: {
          ownerAddress: '',
          grouping: ['collection'],
          page: 1,
          limit: 100
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(query)
      });

      if (!response.ok) {
        throw new AppError(`Failed to fetch NFT events: ${response.statusText}`);
      }

      const responseData = await response.json() as HeliusResponse;

      if ('error' in responseData) {
        logError('Failed to fetch NFT events', new Error(responseData.error.message), {
          url,
          params: {
            query
          },
          responseText: JSON.stringify(responseData.error)
        });
        throw new AppError(`Failed to fetch NFT events: ${responseData.error.message}`);
      }

      const assets = responseData.result.items;
      await this.processAssets(assets, client);

      logInfo('NFT bid data fetch completed', {
        component: 'NFTBidService',
        action: 'fetchAndStoreData',
        assetsProcessed: assets.length
      });
    } catch (error) {
      logError('Failed to fetch and store NFT bid data', error as Error, {
        component: 'NFTBidService',
        action: 'fetchAndStoreData'
      });
      throw error;
    }
  }

  private getMarketplaceFromAsset(asset: HeliusAsset): string {
    // Extract marketplace from the asset data
    // The marketplace info might be in the asset's interface data
    if (asset.interface) {
      const marketplace = this.marketplacePrograms.get(asset.interface);
      if (marketplace) {
        return marketplace;
      }
    }
    return 'Unknown';
  }

  private async getLastProcessedTimestamp(pool: Pool): Promise<number | null> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT value::bigint as timestamp
        FROM indexer_state
        WHERE key = 'nft_bids_last_processed'
      `);
      return result.rows[0]?.timestamp || null;
    } finally {
      client.release();
    }
  }

  public async processBidEvent(
    webhookData: HeliusWebhookData,
    client: Pool
  ): Promise<void> {
    try {
      logInfo('Processing NFT bid events', {
        component: 'NFTBidService',
        action: 'processBidEvent',
        signature: webhookData.signature
      });

      // Extract bid data from webhook
      const bidData = this.extractBidData(webhookData);
      if (!bidData) return;

      // Insert or update bid data
      await this.upsertBid(bidData, client);

    } catch (error) {
      logError('Failed to process bid event', error as Error, {
        component: 'NFTBidService',
        action: 'processBidEvent',
        signature: webhookData.signature
      });
      throw error;
    }
  }

  private extractBidData(data: HeliusWebhookData | NFTBidEvent): NFTBid | null {
    try {
      if ('nft' in data && 'bidder' in data) {
        // Handle NFTBidEvent from API
        const event = data as NFTBidEvent;
        return {
          mintAddress: event.nft.mint,
          bidderAddress: event.bidder,
          bidAmount: event.amount,
          marketplace: 'Unknown', // API events don't include marketplace info
          currency: event.currency || 'SOL',
          status: this.getBidStatus(event.type),
          expiryTime: event.expiryTime ? new Date(event.expiryTime * 1000) : undefined,
          timestamp: new Date(event.timestamp * 1000),
          signature: event.signature,
          rawData: event
        };
      } else {
        // Handle HeliusWebhookData from webhook
        const webhook = data as HeliusWebhookData;
        if (!webhook.nft?.mint) return null;
        
        return {
          mintAddress: webhook.nft.mint,
          bidderAddress: webhook.sourceAddress,
          bidAmount: webhook.amount || 0,
          marketplace: this.getMarketplace(webhook),
          currency: 'SOL', // Webhook events are typically in SOL
          status: this.getBidStatus(webhook.type),
          timestamp: new Date(webhook.timestamp * 1000),
          signature: webhook.signature,
          rawData: webhook.raw
        };
      }
    } catch (error) {
      logError('Failed to extract bid data', error as Error, {
        component: 'NFTBidService',
        action: 'extractBidData',
        signature: data.signature
      });
      return null;
    }
  }

  public async getActiveBids(mintAddress: string, pool: Pool): Promise<ActiveBids[]> {
    try {
      // First check if the mint address is valid
      if (!mintAddress || !mintAddress.match(/^[A-Za-z0-9]{32,44}$/)) {
        throw new AppError('Invalid mint address');
      }

      // Query for active bids with all necessary details
      const result = await pool.query(`
        SELECT 
          mint_address, 
          marketplace,
          currency,
          status,
          bidder_address,
          bid_amount,
          expires_at,
          timestamp
        FROM nft_bids
        WHERE mint_address = $1 AND status = 'active'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY bid_amount DESC
      `, [mintAddress]);

      if (result.rows.length === 0) {
        return [];
      }

      // Group bids by marketplace
      const bidsByMarketplace: Record<string, {
        bids: Array<{ bidder: string; amount: number; timestamp: Date }>;
        currency: string;
      }> = {};

      // Process each bid
      for (const row of result.rows) {
        const marketplace = row.marketplace;
        const currency = row.currency || 'SOL';
        
        if (!bidsByMarketplace[marketplace]) {
          bidsByMarketplace[marketplace] = {
            bids: [],
            currency
          };
        }
        
        bidsByMarketplace[marketplace].bids.push({
          bidder: row.bidder_address,
          amount: parseFloat(row.bid_amount),
          timestamp: row.timestamp
        });
      }

      // Convert to array of ActiveBids objects with stats
      const activeBids: ActiveBids[] = Object.entries(bidsByMarketplace).map(([marketplace, data]) => {
        const bids = data.bids;
        const amounts = bids.map(b => b.amount);
        
        return {
          mintAddress,
          marketplace,
          currency: data.currency,
          totalBids: bids.length,
          minBid: Math.min(...amounts),
          maxBid: Math.max(...amounts),
          avgBid: amounts.reduce((sum, a) => sum + a, 0) / amounts.length,
          bids
        };
      });

      logInfo('Retrieved active bids', {
        component: 'NFTBidService',
        action: 'getActiveBids',
        mintAddress,
        bidCount: result.rows.length,
        marketplaces: Object.keys(bidsByMarketplace).join(', ')
      });

      return activeBids;
    } catch (error) {
      logError('Failed to get active bids', error as Error, {
        component: 'NFTBidService',
        action: 'getActiveBids',
        mintAddress
      });
      throw error;
    }
  }

  private async upsertBid(bid: NFTBid, client: Pool | PoolClient): Promise<void> {
    await client.query(`
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
        raw_data = EXCLUDED.raw_data
    `, [
      bid.signature,
      bid.mintAddress,
      bid.bidderAddress,
      bid.bidAmount,
      bid.marketplace,
      bid.status,
      bid.expiryTime,
      bid.timestamp,
      bid.rawData
    ]);
  }

  public async cleanup(): Promise<void> {
    NFTBidService.instance = undefined;
  }

  private getBidStatus(eventType: string): NFTBid['status'] {
    switch (eventType) {
      case 'BID_PLACED':
        return 'active';
      case 'BID_CANCELLED':
        return 'cancelled';
      case 'BID_ACCEPTED':
        return 'accepted';
      default:
        return 'expired';
    }
  }

  private getMarketplace(transaction: HeliusWebhookData): string {
    // Check program interactions to determine marketplace
    if (!transaction.accountData?.length) return 'Unknown';
    for (const account of transaction.accountData) {
      const marketplace = this.marketplacePrograms.get(account.program);
      if (marketplace) {
        return marketplace;
      }
    }
    return 'Unknown';
  }

  private async processAssets(assets: HeliusAsset[], client: Pool | PoolClient): Promise<void> {
    try {
      await client.query('BEGIN');

      for (const asset of assets) {
        // Only process assets with active bids
        if (asset.activeBids && asset.activeBids.length > 0) {
          for (const bid of asset.activeBids) {
            const bidData: NFTBid = {
              mintAddress: asset.id,
              bidderAddress: bid.bidder,
              bidAmount: bid.amount,
              marketplace: this.getMarketplaceFromAsset(asset),
              currency: bid.currency || 'SOL',
              status: 'active',
              expiryTime: bid.expiryTime ? new Date(bid.expiryTime * 1000) : undefined,
              timestamp: new Date(bid.time * 1000),
              signature: bid.signature,
              rawData: bid
            };

            await this.upsertBid(bidData, client);
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} 