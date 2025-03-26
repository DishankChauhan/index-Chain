import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';
import { Job } from '@/lib/services/jobProcessor';

interface UseJobStatusOptions {
  jobId: string;
  wsUrl: string;
  onError?: (error: Error) => void;
}

export function useJobStatus({ jobId, wsUrl, onError }: UseJobStatusOptions) {
  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'JOB_UPDATED':
        if (message.data.id === jobId) {
          setJob(message.data);
        }
        break;
      case 'JOB_DELETED':
        if (message.data.jobId === jobId) {
          setJob(null);
        }
        break;
      case 'ERROR':
        onError?.(new Error(message.data));
        break;
    }
  }, [jobId, onError]);

  const { isConnected, error, sendMessage } = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
  });

  useEffect(() => {
    // Fetch initial job status
    const fetchJobStatus = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }
        const data = await response.json();
        setJob(data);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to fetch job status'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobStatus();
  }, [jobId, onError]);

  const retryJob = useCallback(() => {
    if (!job) return;
    sendMessage({
      type: 'JOB_UPDATE',
      data: {
        jobId: job.id,
        action: 'retry',
      },
    });
  }, [job, sendMessage]);

  const stopJob = useCallback(() => {
    if (!job) return;
    sendMessage({
      type: 'JOB_UPDATE',
      data: {
        jobId: job.id,
        action: 'stop',
      },
    });
  }, [job, sendMessage]);

  return {
    job,
    isLoading,
    isConnected,
    error,
    retryJob,
    stopJob,
  };
} 