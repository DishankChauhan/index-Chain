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

    await jobService.resumeJob(params.jobId, session.user.id);
    
    logInfo('Job started successfully', {
      service: 'JobsAPI',
      action: 'POST',
      jobId: params.jobId,
      userId: session.user.id
    });

    return NextResponse.json({
      data: { status: 'started' },
      status: 200
    });
  } catch (error) {
    logError('Failed to start job', error as Error, {
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