import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { JobService } from '@/lib/services/jobService';
import { logError, logInfo } from '@/lib/utils/serverLogger';

const jobService = JobService.getInstance();

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const jobStatus = await jobService.getJobStatus(params.jobId, session.user.id);
    
    logInfo('Job status retrieved successfully', {
      service: 'JobsAPI',
      action: 'GET',
      jobId: params.jobId,
      userId: session.user.id
    });

    return NextResponse.json({
      data: jobStatus,
      status: 200
    });
  } catch (error) {
    logError('Failed to get job status', error as Error, {
      service: 'JobsAPI',
      action: 'GET',
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