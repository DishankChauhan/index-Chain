import { PrismaClient } from '@prisma/client';
import { HeliusService } from '../src/lib/services/heliusService';

const prisma = new PrismaClient();

async function createWebhook(jobId: string) {
  try {
    // Get the job
    const job = await prisma.indexingJob.findUnique({
      where: { id: jobId },
      include: { user: true }
    });

    if (!job) {
      throw new Error('Job not found');
    }

    // Create webhook in Helius
    const heliusService = HeliusService.getInstance(job.userId);
    const heliusWebhook = await heliusService.createWebhook({
      accountAddresses: [],
      programIds: [
        'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', // Magic Eden v2
        'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', // Tensor
        '3o9d13qUvEuuauhFrVom1vuCzgNsJifeaBYDPquaT73Y', // OpenSea
        'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Solanart
        'hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu'  // Hadeswap
      ],
      webhookURL: 'http://localhost:3000/api/webhook/helius',
      webhookSecret: 'blockchain_indexer_webhook_secret_key_123456789_abcdef'
    });

    // Create webhook in database
    const webhook = await prisma.webhook.create({
      data: {
        userId: job.userId,
        indexingJobId: job.id,
        url: 'http://localhost:3000/api/webhook/helius',
        secret: 'blockchain_indexer_webhook_secret_key_123456789_abcdef',
        heliusWebhookId: heliusWebhook.webhookId,
        filters: JSON.stringify({
          programIds: [
            'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',
            'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
            '3o9d13qUvEuuauhFrVom1vuCzgNsJifeaBYDPquaT73Y',
            'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz',
            'hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu'
          ]
        }),
        status: 'active'
      }
    });

    console.log('Webhook created successfully:', webhook);
  } catch (error) {
    console.error('Failed to create webhook:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get the job ID from command line arguments
const jobId = process.argv[2];
if (!jobId) {
  console.error('Please provide a job ID');
  process.exit(1);
}

createWebhook(jobId); 