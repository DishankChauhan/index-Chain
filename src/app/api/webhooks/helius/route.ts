import { NextResponse } from 'next/server';
import { logError, logInfo, logWarn } from '@/lib/utils/serverLogger';
import { validateWebhookSignature } from './webhookValidation';
import { WebhookHandler } from '@/lib/services/webhookHandler';
import { HeliusWebhookData } from '@/lib/types/helius';
import prisma from '@/lib/db';
import { AppError } from '@/lib/utils/errorHandling';
import { RateLimiter } from '@/lib/utils/rateLimiter';

const rateLimiter = RateLimiter.getInstance();

export async function POST(req: Request) {
  const startTime = Date.now();
  try {
    const body = await req.json() as HeliusWebhookData | HeliusWebhookData[];
    const signature = req.headers.get('x-signature');
    const webhookId = req.headers.get('x-webhook-id');
    
    // Validate webhook signature
    if (!signature || !webhookId) {
      throw new AppError('Missing required headers', 401);
    }

    // Apply rate limiting
    const rateLimitKey = `webhook:${webhookId}`;
    const isAllowed = await rateLimiter.checkRate(rateLimitKey);
    if (!isAllowed) {
      throw new AppError('Rate limit exceeded', 429);
    }

    // Find webhook in database
    const webhook = await prisma.webhook.findFirst({
      where: {
        heliusWebhookId: webhookId,
        status: 'active'
      },
      include: {
        indexingJob: true
      }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    // Validate signature
    if (!validateWebhookSignature(body, signature, webhook.secret)) {
      throw new AppError('Invalid signature', 401);
    }

    // Process webhook data
    const webhookHandler = WebhookHandler.getInstance(webhook.userId);
    await webhookHandler.handleWebhookData(
      webhook.indexingJob.id,
      webhook.userId,
      Array.isArray(body) ? body : [body],
      webhook.id
    );

    const processingTime = Date.now() - startTime;
    logInfo('Webhook processed successfully', {
      component: 'WebhookAPI',
      action: 'POST',
      webhookId,
      jobId: webhook.indexingJob.id,
      processingTime
    });

    return NextResponse.json({ success: true, processingTime });
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    if (error instanceof AppError) {
      logWarn('Webhook processing failed with known error', {
        component: 'WebhookAPI',
        action: 'POST',
        error: error.message,
        statusCode: error.statusCode,
        processingTime
      });
      
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    logError('Webhook processing failed with unknown error', error as Error, {
      component: 'WebhookAPI',
      action: 'POST',
      processingTime
    });

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
} 