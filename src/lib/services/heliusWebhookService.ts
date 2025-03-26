import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { logError, logInfo, logDebug } from '@/lib/utils/serverLogger';
import { AppError } from '@/lib/utils/errorHandling';
import { RateLimiter } from '@/lib/utils/rateLimiter';
import { CircuitBreaker } from '@/lib/utils/circuitBreaker';
import { SecretsManager } from '@/lib/utils/secrets';
import {
  HeliusWebhookData,
  HeliusWebhookRequest,
  HeliusWebhookResponse,
  HeliusErrorResponse,
  HeliusWebhook
} from '@/lib/types/helius';
import prisma from '@/lib/db';
import { Logger } from '@/lib/utils/logger';
import { validateWebhookSignature } from '@/app/api/webhooks/helius/webhookValidation';

const HELIUS_API_URL = process.env.HELIUS_API_URL || 'https://api.helius.xyz';

export class HeliusWebhookService {
  private static instances: Map<string, HeliusWebhookService> = new Map();
  private readonly userId: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly secretsManager: SecretsManager;
  private readonly prisma: PrismaClient;
  private readonly logger: Logger;

  private constructor(userId: string) {
    if (!userId) throw new Error('User ID is required');
    this.userId = userId;
    this.rateLimiter = RateLimiter.getInstance();
    this.circuitBreaker = CircuitBreaker.getInstance();
    this.secretsManager = SecretsManager.getInstance();
    this.prisma = new PrismaClient();
    this.logger = new Logger('HeliusWebhookService');
  }

  public static getInstance(userId: string): HeliusWebhookService {
    if (!this.instances.has(userId)) {
      this.instances.set(userId, new HeliusWebhookService(userId));
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

  public async createWebhook(indexingJobId: string, webhookUrl: string, addresses: string[]): Promise<HeliusWebhook> {
    try {
      const apiKey = await this.getApiKey();
      const webhookRequest: HeliusWebhookRequest = {
        webhookURL: webhookUrl,
        transactionTypes: ['NFT_SALE', 'NFT_BID', 'TOKEN_TRANSFER'],
        accountAddresses: addresses,
        webhookType: 'enhanced',
        authHeader: apiKey
      };

      const response = await fetch(`https://api.helius.xyz/v0/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(webhookRequest)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(`Failed to create Helius webhook: ${error.message}`);
      }

      const webhookResponse: HeliusWebhookResponse = await response.json();

      const webhook = await this.prisma.webhook.create({
        data: {
          indexingJobId,
          url: webhookUrl,
          heliusWebhookId: webhookResponse.webhookId,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: this.userId,
          secret: apiKey,
          retryCount: 3,
          retryDelay: 1000,
          filters: JSON.stringify({
            accountAddresses: addresses,
            transactionTypes: ['NFT_SALE', 'NFT_BID', 'TOKEN_TRANSFER']
          }),
          config: JSON.stringify({
            rateLimit: {
              windowMs: 60000,
              maxRequests: 60
            }
          })
        }
      });

      return {
        webhookId: webhook.heliusWebhookId,
        webhookURL: webhook.url,
        accountAddresses: addresses,
        transactionTypes: ['NFT_SALE', 'NFT_BID', 'TOKEN_TRANSFER'],
        webhookType: 'enhanced',
        createdAt: webhook.createdAt.toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to create webhook', { error });
      throw error;
    }
  }

  public async deleteWebhook(webhookId: string): Promise<void> {
    try {
      const apiKey = await this.getApiKey();
      const webhook = await this.prisma.webhook.findFirst({
        where: {
          heliusWebhookId: webhookId,
          userId: this.userId
        }
      });

      if (!webhook) {
        throw new AppError('Webhook not found');
      }

      const response = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(`Failed to delete Helius webhook: ${error.message}`);
      }

      await this.prisma.webhook.delete({
        where: {
          id: webhook.id
        }
      });

      this.logger.info('Successfully deleted webhook', { webhookId });
    } catch (error) {
      this.logger.error('Failed to delete webhook', { error, webhookId });
      throw error;
    }
  }

  public async listWebhooks(): Promise<HeliusWebhook[]> {
    try {
      const apiKey = await this.getApiKey();
      const response = await fetch('https://api.helius.xyz/v0/webhooks', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(`Failed to list Helius webhooks: ${error.message}`);
      }

      const webhooks = await this.prisma.webhook.findMany({
        where: {
          userId: this.userId,
          status: 'ACTIVE'
        }
      });

      return webhooks.map(webhook => ({
        webhookId: webhook.heliusWebhookId,
        webhookURL: webhook.url,
        accountAddresses: JSON.parse(webhook.filters as string).accountAddresses,
        transactionTypes: JSON.parse(webhook.filters as string).transactionTypes,
        webhookType: 'enhanced',
        createdAt: webhook.createdAt.toISOString()
      }));
    } catch (error) {
      this.logger.error('Failed to list webhooks', { error });
      throw error;
    }
  }

  public async validateWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
    try {
      return validateWebhookSignature(body, signature, secret);
    } catch (error) {
      this.logger.error('Failed to validate webhook signature', { error });
      return false;
    }
  }

  public async updateWebhookStatus(webhookId: string, status: string): Promise<void> {
    try {
      const webhook = await this.prisma.webhook.findFirst({
        where: {
          heliusWebhookId: webhookId,
          userId: this.userId
        }
      });

      if (!webhook) {
        throw new AppError('Webhook not found');
      }

      await this.prisma.webhook.update({
        where: {
          id: webhook.id
        },
        data: {
          status,
          updatedAt: new Date()
        }
      });

      this.logger.info('Successfully updated webhook status', { webhookId, status });
    } catch (error) {
      this.logger.error('Failed to update webhook status', { error, webhookId, status });
      throw error;
    }
  }

  public async logWebhookEvent(webhookId: string, status: string, payload: any, response?: any, error?: string): Promise<void> {
    try {
      await this.prisma.webhookLog.create({
        data: {
          webhookId,
          status,
          attempt: 1,
          payload: payload as any,
          response: response || undefined,
          error,
          timestamp: new Date()
        }
      });
    } catch (error) {
      this.logger.error('Failed to log webhook event', { error, webhookId });
      // Don't throw here as this is a non-critical operation
    }
  }

  private async cleanupWebhooks(): Promise<void> {
    try {
      const webhooks = await this.listWebhooks();
      const dbWebhooks = await prisma.webhook.findMany({
        where: { userId: this.userId }
      });

      for (const webhook of webhooks) {
        const dbWebhook = dbWebhooks.find(dbw => dbw.heliusWebhookId === webhook.webhookId);
        const notInOurDb = !dbWebhook;
        const isInactive = dbWebhook?.status !== 'active';
        const isOld = dbWebhook && new Date(dbWebhook.updatedAt).getTime() < Date.now() - 86400000;

        if (notInOurDb || (isInactive && isOld)) {
          await this.deleteWebhook(webhook.webhookId);
        }
      }
    } catch (error) {
      logError('Failed to cleanup webhooks', error as Error, {
        component: 'HeliusWebhookService',
        action: 'cleanupWebhooks'
      });
    }
  }
} 