import { Pool, PoolClient } from 'pg';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { AppError } from '@/lib/utils/errorHandling';
import { HeliusWebhookData, HeliusDASResponse, HeliusAsset } from '../types/helius';
import { RateLimiter } from 'limiter';

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    message: string;
    [key: string]: any;
  };
}

export interface NFTPrice {
  mintAddress: string;
  price: number;
  marketplace: string;
  sellerAddress?: string;
  status: 'listed' | 'sold' | 'cancelled';
  timestamp: Date;
  signature: string;
  rawData: any;
}

export interface NFTPriceEvent {
  nft: {
    mint: string;
    name?: string;
    collection?: string;
  };
  amount: number;
  type: string;
  seller?: string;
  timestamp: number;
  signature: string;
  raw: any;
  accountData?: Array<{
    program: string;
  }>;
}

export interface CurrentPrice {
  mintAddress: string;
  prices: Array<{
    marketplace: string;
    currency: string;
    listPrice: number;
    seller: string;
    listTimestamp: Date;
    lastSalePrice?: number;
    lastSaleTimestamp?: Date;
  }>;
}

export class NFTPriceService {
  fetchAndStoreCurrentPrices(dbPool: Pool) {
    throw new Error('Method not implemented.');
  }
  private static instance: NFTPriceService | null = null;
  private readonly baseUrl: string;
  private readonly marketplacePrograms: Map<string, string>;
  private readonly rateLimiter: RateLimiter;

  private constructor() {
    this.baseUrl = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/';
    this.marketplacePrograms = new Map([
      ['M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', 'Magic Eden'],
      ['HYPERfwdTjyJ2SCaKHmpF2MtrXqWxrsotYDsTrshHWq8', 'HyperSpace'],
      ['TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', 'Tensor'],
      ['CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', 'Solanart']
    ]);
    this.rateLimiter = new RateLimiter({
      tokensPerInterval: 50,
      interval: 'second'
    });
  }

  public static getInstance(): NFTPriceService {
    if (!NFTPriceService.instance) {
      NFTPriceService.instance = new NFTPriceService();
    }
    return NFTPriceService.instance;
  }

  public async fetchAndStoreData(dbPool: Pool): Promise<void> {
    try {
      logInfo('Starting NFT price data fetch', {
        component: 'NFTPriceService',
        action: 'fetchAndStoreData'
      });

      const apiKey = process.env.HELIUS_API_KEY;
      if (!apiKey) {
        throw new AppError('HELIUS_API_KEY not found in environment');
      }

      const lastProcessed = await this.getLastProcessedTimestamp(dbPool);
      const currentTime = Math.floor(Date.now() / 1000);
      const batchSize = 100;
      let startTime = lastProcessed || (currentTime - 24 * 60 * 60);

      while (startTime < currentTime) {
        await this.rateLimiter.removeTokens(1);
        const endTime = Math.min(startTime + 3600, currentTime);

        // Use DAS API getAssetsByGroup method to find NFT sales and listings
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'my-id',
            method: 'getProgramAccounts',
            params: [
              'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', // Magic Eden v2
              {
                encoding: 'jsonParsed',
                filters: [
                  {
                    dataSize: 245 // Size of listing account data
                  }
                ],
                commitment: 'confirmed'
              }
            ]
          })
        });

        const responseData = await response.json() as JsonRpcResponse<HeliusDASResponse>;

        // Check for JSON-RPC error response
        if (responseData.error) {
          logError('Failed to fetch NFT events', new Error(responseData.error.message), {
            component: 'NFTPriceService',
            action: 'fetchAndStoreData',
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            responseText: JSON.stringify(responseData.error)
          });
          throw new AppError(`Failed to fetch NFT events: ${responseData.error.message}`);
        }

        // Check for HTTP error
        if (!response.ok) {
          const errorText = JSON.stringify(responseData);
          logError('Failed to fetch NFT events', new Error(errorText), {
            component: 'NFTPriceService',
            action: 'fetchAndStoreData',
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            responseText: errorText
          });
          throw new AppError(`Failed to fetch NFT events: ${response.statusText} - ${errorText}`);
        }

        if (!responseData.result) {
          throw new AppError('No result in response');
        }

        const assets = responseData.result.items;
        
        const client = await dbPool.connect();
        try {
          await client.query('BEGIN');

          for (const asset of assets) {
            // Only process assets with recent sales or listings
            if (asset.lastSalePrice || asset.listingPrice) {
              const price: NFTPrice = {
                mintAddress: asset.id,
                price: asset.lastSalePrice || asset.listingPrice || 0,
                marketplace: this.getMarketplaceFromAsset(asset),
                sellerAddress: asset.ownership.owner,
                status: asset.lastSalePrice ? 'sold' : 'listed',
                timestamp: new Date((asset.lastSaleTime || asset.listingTime || 0) * 1000),
                signature: asset.lastSaleSignature || asset.listingSignature || '',
                rawData: asset
              };

              await this.insertPriceData(price, client);
            }
          }

          await client.query(`
            INSERT INTO indexer_state (key, value, updated_at)
            VALUES ('nft_prices_last_processed', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = EXCLUDED.updated_at
          `, [endTime.toString()]);

          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        startTime = endTime;

        logInfo('Processed NFT price batch', {
          component: 'NFTPriceService',
          action: 'fetchAndStoreData',
          startTime,
          endTime,
          assetsProcessed: assets.length
        });
      }

      logInfo('Completed NFT price data fetch', {
        component: 'NFTPriceService',
        action: 'fetchAndStoreData'
      });
    } catch (error) {
      logError('Failed to fetch and store NFT price data', error as Error, {
        component: 'NFTPriceService',
        action: 'fetchAndStoreData'
      });
      throw new AppError('Failed to fetch and store NFT price data');
    }
  }

  private getMarketplaceFromAsset(asset: any): string {
    // Extract marketplace from the asset data
    // The marketplace info might be in the asset's interface data
    if (asset.interface && asset.interface.marketplace) {
      const marketplace = this.marketplacePrograms.get(asset.interface.marketplace);
      if (marketplace) {
        return marketplace;
      }
    }
    return 'Unknown';
  }

  private async getLastProcessedTimestamp(dbPool: Pool): Promise<number | null> {
    try {
      const result = await dbPool.query(`
        SELECT value::bigint as timestamp
        FROM indexer_state
        WHERE key = 'nft_prices_last_processed'
      `);
      return result.rows[0]?.timestamp || null;
    } catch (error) {
      logError('Failed to get last processed timestamp', error as Error, {
        component: 'NFTPriceService',
        action: 'getLastProcessedTimestamp'
      });
      return null;
    }
  }

  public async processPriceEvent(
    data: HeliusWebhookData | NFTPriceEvent,
    client: Pool | PoolClient
  ): Promise<void> {
    try {
      logInfo('Processing NFT price event', {
        component: 'NFTPriceService',
        action: 'processPriceEvent',
        signature: data.signature
      });

      const price = this.extractPriceData(data);
      if (!price) return;

      await this.insertPriceData(price, client);

    } catch (error) {
      logError('Failed to process price event', error as Error, {
        component: 'NFTPriceService',
        action: 'processPriceEvent',
        signature: data.signature
      });
      throw error;
    }
  }

  private extractPriceData(data: HeliusWebhookData | NFTPriceEvent): NFTPrice | null {
    try {
      if ('nft' in data && data.nft && 'amount' in data) {
        // Handle NFTPriceEvent from API
        const event = data as NFTPriceEvent;
        return {
          mintAddress: event.nft.mint,
          price: event.amount,
          marketplace: this.getMarketplace(event),
          sellerAddress: event.seller,
          status: this.getPriceStatus(event.type),
          timestamp: new Date(event.timestamp * 1000),
          signature: event.signature,
          rawData: event.raw
        };
      } else if ('nft' in data && data.nft?.mint) {
        // Handle HeliusWebhookData from webhook
        const webhook = data as HeliusWebhookData;
        const nft = webhook.nft;
        
        if (!nft || !nft.mint) return null;
        
        return {
          mintAddress: nft.mint,
          price: webhook.amount || 0,
          marketplace: this.getMarketplace({
            nft: {
              mint: nft.mint,
              name: nft.name,
              collection: nft.collection
            },
            amount: webhook.amount || 0,
            type: webhook.type,
            seller: webhook.seller,
            timestamp: webhook.timestamp,
            signature: webhook.signature,
            raw: webhook.raw,
            accountData: webhook.accountData
          }),
          sellerAddress: webhook.seller,
          status: this.getPriceStatus(webhook.type),
          timestamp: new Date(webhook.timestamp * 1000),
          signature: webhook.signature,
          rawData: webhook.raw
        };
      }
      return null;
    } catch (error) {
      logError('Failed to extract price data', error as Error, {
        component: 'NFTPriceService',
        action: 'extractPriceData',
        signature: data.signature
      });
      return null;
    }
  }

  private async insertPriceData(price: NFTPrice, client: Pool | PoolClient): Promise<void> {
    await client.query(`
      INSERT INTO nft_prices (
        signature,
        mint_address,
        price,
        marketplace,
        seller_address,
        status,
        timestamp,
        raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (signature) DO UPDATE SET
        status = EXCLUDED.status,
        raw_data = EXCLUDED.raw_data
    `, [
      price.signature,
      price.mintAddress,
      price.price,
      price.marketplace,
      price.sellerAddress,
      price.status,
      price.timestamp,
      price.rawData
    ]);
  }

  public async cleanup(): Promise<void> {
    NFTPriceService.instance = null;
  }

  public async getCurrentPrices(mintAddress: string, dbPool: Pool): Promise<any> {
    try {
      const result = await dbPool.query(`
        SELECT * FROM current_nft_prices
        WHERE mint_address = $1
      `, [mintAddress]);

      return result.rows[0]?.prices || [];
    } catch (error) {
      logError('Failed to get current prices', error as Error, {
        component: 'NFTPriceService',
        action: 'getCurrentPrices',
        mintAddress
      });
      throw error;
    }
  }

  private async upsertPrice(priceData: any, client: Pool): Promise<void> {
    try {
      logInfo('Processed NFT price', {
        component: 'NFTPriceService',
        action: 'upsertPrice',
        mintAddress: priceData.mintAddress
      });

      // Implementation of price upsert logic
    } catch (error) {
      logError('Failed to upsert price', error as Error, {
        component: 'NFTPriceService',
        action: 'upsertPrice',
        mintAddress: priceData.mintAddress
      });
      throw error;
    }
  }

  private getMarketplace(event: NFTPriceEvent): string {
    for (const account of event.accountData || []) {
      const marketplace = this.marketplacePrograms.get(account.program);
      if (marketplace) {
        return marketplace;
      }
    }
    return 'Unknown';
  }

  private getPriceStatus(eventType: string): NFTPrice['status'] {
    switch (eventType) {
      case 'NFT_LISTING':
        return 'listed';
      case 'NFT_SALE':
        return 'sold';
      case 'NFT_LISTING_CANCELLED':
        return 'cancelled';
      default:
        return 'listed';
    }
  }
} 