'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { JobStatus } from '@/components/JobStatus';
import { useJobStatus } from '@/hooks/useJobStatus';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function JobPage() {
  const params = useParams();
  const jobId = params?.id as string;

  const {
    job,
    isLoading,
    isConnected,
    error,
    retryJob,
    stopJob,
  } = useJobStatus({
    jobId,
    wsUrl: `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000'}/ws`,
    onError: (error) => {
      console.error('Job status error:', error);
    },
  });

  if (!jobId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Invalid job ID</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Job not found</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-2">Job Details</h1>
        {!isConnected && (
          <Alert variant="destructive">
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Real-time updates are currently unavailable. Please check your connection.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <JobStatus
        job={job}
        onRetry={retryJob}
        onStop={stopJob}
      />

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
} 