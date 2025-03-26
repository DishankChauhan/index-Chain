import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { JobService } from '@/lib/services/jobService';
import { logError, logInfo } from '@/lib/utils/serverLogger';

const jobService = JobService.getInstance();

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    await jobService.cancelJob(params.jobId, session.user.id);
    
    logInfo('Job stopped successfully', {
      service: 'JobsAPI',
      action: 'POST',
      jobId: params.jobId,
      userId: session.user.id
    });

    return NextResponse.json({
      data: { status: 'stopped' },
      status: 200
    });
  } catch (error) {
    logError('Failed to stop job', error as Error, {
      service: 'JobsAPI',
      action: 'POST',
      jobId: params.jobId
    });
    return NextResponse.json({
      data: null,
      status: 500,
      error: 'Internal Server Error'
    }, {
      status: 500
    });
  }
} 