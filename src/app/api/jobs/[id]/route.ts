import { NextResponse } from 'next/server';
import { JobProcessor } from '@/lib/services/jobProcessor';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const jobProcessor = JobProcessor.getInstance();
    const job = jobProcessor.getJob(params.id);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Failed to fetch job status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const jobProcessor = JobProcessor.getInstance();
    const job = jobProcessor.getJob(params.id);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const { action } = await request.json();

    switch (action) {
      case 'retry':
        jobProcessor.updateJobStatus(job.id, 'PENDING');
        break;
      case 'stop':
        jobProcessor.updateJobStatus(job.id, 'PAUSED');
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update job status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 