'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import IndexingConfigForm from '@/components/IndexingConfigForm';
import { toast } from 'sonner';

export default function NewJobPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  // Poll for job status if we have a job ID
  useEffect(() => {
    if (!jobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/status`);
        if (!response.ok) {
          toast.error('Failed to get job status');
          clearInterval(pollInterval);
          return;
        }

        const data = await response.json();
        setJobStatus(data.data.status);
        
        // Show progress toast
        toast(data.message || `Job status: ${data.data.status}`);
        
        // If job is complete or failed, stop polling
        if (['completed', 'failed', 'cancelled'].includes(data.data.status)) {
          clearInterval(pollInterval);
          
          if (data.data.status === 'completed') {
            toast.success('Job created successfully!');
            router.push('/jobs');
          } else if (data.data.status === 'failed') {
            toast.error('Job creation failed. Please try again.');
          }
        }
      } catch (error) {
        console.error('Error polling job status:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [jobId, router]);

  const handleSubmit = async (config: any) => {
    try {
      setIsLoading(true);
      
      // Show toast notification
      toast.loading('Creating job...');
      
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'solana',
          config
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        toast.error(data.error || 'Failed to create job');
        throw new Error(data.error || 'Failed to create job');
      }

      // Store job ID and start polling
      if (data.id) {
        setJobId(data.id);
        toast.success('Job created! Setting up webhooks and indexing...');
      } else {
        router.push('/jobs');
      }
    } catch (error) {
      console.error('Job creation error:', error);
      toast.error(error instanceof Error ? error.message : 'Job creation failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  if (status === 'unauthenticated') {
    router.push('/auth/signin');
    return null;
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create New Indexing Job</h1>
      
      {jobId && jobStatus !== 'completed' ? (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <h2 className="text-lg font-semibold">Job Creation in Progress</h2>
          <p className="mb-2">Your job is being set up. This may take a few moments.</p>
          <div className="flex items-center">
            <LoadingSpinner size="sm" />
            <span className="ml-2">Current status: {jobStatus || 'Initializing'}</span>
          </div>
        </div>
      ) : null}
      
      <IndexingConfigForm onSubmit={handleSubmit} isLoading={isLoading || !!jobId} />
    </div>
  );
} 