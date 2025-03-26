import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { JobService } from '@/lib/services/jobService';
import { AppError } from '@/lib/utils/errorHandling';
import { logError, logInfo, logWarn } from '@/lib/utils/serverLogger';
import prisma from '@/lib/db';

const jobService = JobService.getInstance();

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await auth();
    
    if (!session?.user) {
      logWarn('Unauthorized access attempt to job details', {
        message: 'Unauthorized access attempt to job details',
        service: 'JobsAPI',
        action: 'GET',
        jobId: params.jobId
      });
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const job = await prisma.indexingJob.findFirst({
      where: {
        id: params.jobId,
        userId: session.user.id
      }
    });

    if (!job) {
      return new NextResponse('Job not found', { status: 404 });
    }

    return NextResponse.json({
      data: job,
      status: 200
    });
  } catch (error) {
    logError('Failed to fetch job details', error as Error, {
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

export async function PATCH(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  let session;
  try {
    session = await auth();
    if (!session?.user) {
      logWarn('Unauthorized access attempt to job update', {
        message: 'Unauthorized access attempt to job update',
        service: 'JobsAPI',
        action: 'PATCH',
        jobId: params.jobId
      });
      throw new AppError('Unauthorized');
    }

    const body = await req.json();
    const { action } = body;

    if (!action || !['pause', 'resume', 'cancel'].includes(action)) {
      logWarn('Invalid job action requested', {
        message: 'Invalid job action requested',
        service: 'JobsAPI',
        action: 'PATCH',
        jobId: params.jobId,
        requestedAction: action,
        userId: session.user.email
      });
      throw new AppError('Invalid action');
    }

    // Get job to verify ownership
    const job = await prisma.indexingJob.findFirst({
      where: {
        id: params.jobId,
        userId: session.user.id
      }
    });

    if (!job) {
      throw new AppError('Job not found');
    }

    // Update job status based on action
    const status = action === 'pause' ? 'paused' :
                  action === 'resume' ? 'active' :
                  'cancelled';

    const updatedJob = await prisma.indexingJob.update({
      where: { id: params.jobId },
      data: { status }
    });

    logInfo(`Job ${action}d successfully`, {
      message: `Job ${action}d successfully`,
      service: 'JobsAPI',
      action: action.toUpperCase(),
      jobId: params.jobId,
      userId: session.user.email
    });

    return NextResponse.json(updatedJob);
  } catch (error) {
    const err = error as Error;
    logError('Failed to update job', {
      message: err.message,
      name: err.name,
      stack: err.stack
    }, {
      service: 'JobsAPI',
      action: 'PATCH',
      jobId: params.jobId,
      userId: session?.user?.email || undefined,
      path: `/api/jobs/${params.jobId}`
    });

    if (error instanceof AppError) {
      const statusCode = error.message.includes('Unauthorized') ? 401 :
                        error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { jobId } = params;

    // Verify job exists and belongs to user
    const job = await prisma.indexingJob.findFirst({
      where: {
        id: jobId,
        userId: session.user.id
      }
    });

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Delete the job
    await prisma.indexingJob.delete({
      where: {
        id: jobId
      }
    });

    logInfo('Successfully deleted job', {
      component: 'JobsAPI',
      action: 'DELETE',
      userId: session.user.id,
      jobId
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logError('Failed to delete job', error as Error, {
      component: 'JobsAPI',
      action: 'DELETE'
    });
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    );
  }
} 