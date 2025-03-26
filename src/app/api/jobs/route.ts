import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DatabaseService } from '@/lib/services/databaseService';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import indexingQueue from '@/lib/queue/worker';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const jobs = await prisma.indexingJob.findMany({
      where: {
        userId: session.user.id
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    logInfo('Successfully fetched jobs', {
      component: 'JobsAPI',
      action: 'GET',
      userId: session.user.id,
      jobCount: jobs.length
    });

    return NextResponse.json(jobs);
  } catch (error) {
    logError('Failed to fetch jobs', error as Error, {
      component: 'JobsAPI',
      action: 'GET'
    });
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { type, config } = await request.json();
    
    if (!type || !config) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify database connection exists and belongs to user
    const dbConnection = await prisma.databaseConnection.findFirst({
      where: {
        id: config.dbConnectionId,
        userId: session.user.id
      }
    });

    if (!dbConnection) {
      return NextResponse.json(
        { error: 'Database connection not found' },
        { status: 404 }
      );
    }

    // Create the job in "initializing" state
    const job = await prisma.indexingJob.create({
      data: {
        userId: session.user.id,
        dbConnectionId: config.dbConnectionId,
        type,
        status: 'initializing',
        progress: 0,
        config: {
          categories: config.categories,
          filters: config.filters,
          webhook: config.webhook
        }
      }
    });

    // Add job to queue - webhook creation will happen asynchronously
    // Make a copy of the database connection credentials to pass to the worker
    const dbConnectionForWorker = {
      host: dbConnection.host,
      port: dbConnection.port,
      database: dbConnection.database,
      username: dbConnection.username,
      password: dbConnection.password
    };
    
    await indexingQueue.add('indexing-job', {
      jobId: job.id,
      userId: session.user.id,
      config: job.config,
      dbConnection: dbConnectionForWorker
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });

    logInfo('Successfully created job', {
      component: 'JobsAPI',
      action: 'POST',
      userId: session.user.id,
      jobId: job.id
    });

    // Return immediately with the job ID
    return NextResponse.json({
      id: job.id,
      status: 'initializing',
      message: 'Job created and initialization started. Check job status for updates.'
    });
  } catch (error) {
    logError('Failed to create job', error as Error, {
      component: 'JobsAPI',
      action: 'POST'
    });
    return NextResponse.json(
      { error: 'Failed to create job: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
} 