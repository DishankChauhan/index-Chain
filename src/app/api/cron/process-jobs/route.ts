import { NextResponse } from 'next/server';
import { JobProcessor, JobStatus } from '@/lib/services/jobProcessor';
import prisma from '@/lib/db';
import { logError, logInfo } from '@/lib/utils/serverLogger';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    
    // Find pending jobs
    const pendingJobs = await prisma.indexingJob.findMany({
      where: {
        status: 'PENDING',
        OR: [
          {
            config: {
              path: ['nextRetryAt'],
              lte: now.toISOString()
            }
          },
          {
            config: {
              not: {
                path: ['nextRetryAt']
              }
            }
          }
        ]
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: 5 // Process 5 jobs at a time
    });

    if (pendingJobs.length === 0) {
      return NextResponse.json({ message: 'No pending jobs' });
    }

    // Process each job
    const processor = JobProcessor.getInstance();
    const results = await Promise.allSettled(
      pendingJobs.map(job => processor.startJob(job.id))
    );

    // Count successes and failures
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // Recover any interrupted jobs
    await processor.recoverInterruptedJobs();

    logInfo('Job processing completed', {
      component: 'JobProcessor',
      action: 'cronJob',
      totalJobs: pendingJobs.length,
      succeeded,
      failed
    });

    return NextResponse.json({
      processed: pendingJobs.length,
      succeeded,
      failed
    });
  } catch (error) {
    logError('Failed to process jobs', error as Error, {
      component: 'JobProcessor',
      action: 'cronJob'
    });

    return NextResponse.json(
      { error: 'Failed to process jobs' },
      { status: 500 }
    );
  }
} 