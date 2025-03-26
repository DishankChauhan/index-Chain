import { NextRequest, NextResponse } from 'next/server';
import { HeliusService } from '@/lib/services/heliusService';
import { logError, logInfo, logWarn } from '@/lib/utils/serverLogger';
import { PrismaClient, Webhook } from '@prisma/client';
import { RateLimiter } from '@/lib/utils/rateLimiter';

const prisma = new PrismaClient();
const rateLimiter = RateLimiter.getInstance();

// Validate webhook payload structure
function isValidWebhookData(data: any): boolean {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.webhookId === 'string' &&
    Array.isArray(data.events) 
  );
}

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
    if (!(await rateLimiter.checkLimit('helius'))) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const authHeader = request.headers.get('authorization');
    const body = await request.json();

    // Validate webhook data structure
    if (!isValidWebhookData(body)) {
      logWarn('Invalid webhook data structure', {
        component: 'HeliusWebhook',
        action: 'ValidateData'
      });
      return NextResponse.json({ error: 'Invalid webhook data structure' }, { status: 400 });
    }

    // Log incoming webhook data
    logInfo('Received webhook data', {
      component: 'HeliusWebhook',
      action: 'ProcessWebhook',
      signature: body.signature,
      webhookId: body.webhookId,
      eventCount: body.events?.length || 0
    });

    // Find the webhook configuration
    const webhook = await prisma.webhook.findFirst({
      where: {
        heliusWebhookId: body.webhookId,
        status: 'active'
      },
      include: {
        indexingJob: true
      }
    });

    if (!webhook || !webhook.indexingJob) {
      logWarn('No active webhook or job found', {
        component: 'HeliusWebhook',
        action: 'FindWebhook',
        webhookId: body.webhookId
      });
      return NextResponse.json({ error: 'Webhook not found or inactive' }, { status: 404 });
    }

    // Verify webhook secret
    const providedSecret = authHeader?.replace('Bearer ', '');
    if (providedSecret !== webhook.secret) {
      logWarn('Invalid webhook secret', {
        component: 'HeliusWebhook',
        action: 'ValidateSecret',
        webhookId: webhook.id
      });
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
    }

    // Process the webhook data
    const heliusService = HeliusService.getInstance(webhook.userId);
    await heliusService.handleWebhookData(webhook.indexingJob.id, webhook.userId, body.events);

    // Update webhook stats and log the event
    await prisma.$transaction(async (tx) => {
      // Update webhook stats
      await tx.webhook.update({
        where: { id: webhook.id },
        data: {
          updatedAt: new Date()
        }
      });

      // Log the webhook event
      await tx.webhookLog.create({
        data: {
          webhookId: webhook.id,
          status: 'success',
          attempt: 1,
          payload: body
        }
      });
    });

    logInfo('Webhook data processed successfully', {
      component: 'HeliusWebhook',
      action: 'ProcessData',
      webhookId: webhook.id,
      jobId: webhook.indexingJob.id
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Failed to process webhook data', error as Error, {
      component: 'HeliusWebhook',
      action: 'ProcessWebhook'
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
} 