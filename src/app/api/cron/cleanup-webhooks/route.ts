import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { HeliusService } from '@/lib/services/heliusService';
import { logError, logInfo } from '@/lib/utils/serverLogger';

const prisma = new PrismaClient();

// Vercel cron job to clean up inactive webhooks
export async function GET(req: Request) {
  try {
    // Check for authorization - in production you would want to secure this endpoint
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true
      }
    });

    logInfo('Starting webhook cleanup cron job', {
      component: 'CronJob',
      action: 'CleanupWebhooks',
      userCount: users.length
    });

    let totalCleaned = 0;

    // For each user, clean up their webhooks
    for (const user of users) {
      try {
        const heliusService = HeliusService.getInstance(user.id);
        
        // Get all Helius webhooks
        const heliusWebhooks = await heliusService.listWebhooks();
        
        // Get all webhooks from our database
        const dbWebhooks = await prisma.webhook.findMany({
          where: {
            userId: user.id
          }
        });

        // Find inactive webhooks (those in Helius but not active in our DB)
        const activeWebhookIds = new Set(
          dbWebhooks
            .filter(w => w.status === 'active')
            .map(w => w.heliusWebhookId)
        );
        
        const inactiveWebhooks = heliusWebhooks.filter(w => !activeWebhookIds.has(w.webhookId));
        
        // Delete inactive webhooks
        for (const webhook of inactiveWebhooks) {
          try {
            await heliusService.deleteWebhook(webhook.webhookId);
            
            // Update status in our database if it exists
            await prisma.webhook.updateMany({
              where: {
                heliusWebhookId: webhook.webhookId
              },
              data: {
                status: 'deleted',
                updatedAt: new Date()
              }
            });
            
            totalCleaned++;
          } catch (error) {
            logError('Failed to delete webhook', error as Error, {
              component: 'CronJob',
              action: 'CleanupWebhooks',
              webhookId: webhook.webhookId,
              userId: user.id
            });
            // Continue with other webhooks even if one fails
          }
        }
        
        logInfo('Cleaned up inactive webhooks for user', {
          component: 'CronJob',
          action: 'CleanupWebhooks',
          userId: user.id,
          deletedCount: inactiveWebhooks.length
        });
      } catch (error) {
        logError('Failed to clean up webhooks for user', error as Error, {
          component: 'CronJob',
          action: 'CleanupWebhooks',
          userId: user.id
        });
      }
    }

    logInfo('Webhook cleanup completed', {
      component: 'CronJob',
      action: 'CleanupWebhooks',
      totalCleaned
    });

    return NextResponse.json({
      success: true,
      totalCleaned
    });
  } catch (error) {
    logError('Failed to run webhook cleanup cron job', error as Error, {
      component: 'CronJob',
      action: 'CleanupWebhooks'
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
} 