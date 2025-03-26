import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixWebhookUrls() {
  try {
    // Find jobs with incorrect webhook URL (port 3001)
    const jobs = await prisma.indexingJob.findMany({
      where: {
        config: {
          path: ['webhook', 'url'],
          string_contains: '3001'
        }
      }
    });

    console.log(`Found ${jobs.length} jobs with incorrect webhook URLs`);

    // Update each job
    for (const job of jobs) {
      const config = job.config as any;
      
      if (config.webhook?.url?.includes('3001')) {
        console.log(`Fixing webhook URL for job ${job.id}: ${config.webhook.url}`);
        
        // Update the URL in the config
        config.webhook.url = config.webhook.url.replace('3001', '3000');
        
        // Update the job
        await prisma.indexingJob.update({
          where: { id: job.id },
          data: { config }
        });
        
        console.log(`Updated job ${job.id} with new webhook URL: ${config.webhook.url}`);
      }
    }

    console.log('Webhook URL fix completed');
  } catch (error) {
    console.error('Error fixing webhook URLs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixWebhookUrls(); 