import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { JobStatus as JobStatusType } from '@/lib/services/jobProcessor';
import { formatDistanceToNow } from 'date-fns';

interface JobData {
  id: string;
  type: string;
  status: JobStatusType;
  progress: number;
  lastRunAt?: Date;
  error?: string;
  config: {
    lastProcessedBlock?: number;
    lastProcessedTimestamp?: Date;
    checkpoints?: Array<{
      block: number;
      timestamp: Date;
    }>;
  };
}

interface Props {
  job: JobData;
  onRetry?: (jobId: string) => void;
  onStop?: (jobId: string) => void;
}

export function JobStatus({ job, onRetry, onStop }: Props) {
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    // Update the "last updated" time every minute
    const interval = setInterval(() => {
      setLastUpdate(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: JobStatusType) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-500';
      case 'FAILED':
        return 'bg-red-500';
      case 'RUNNING':
        return 'bg-blue-500';
      case 'PAUSED':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 90) return 'bg-green-500';
    if (progress >= 60) return 'bg-blue-500';
    if (progress >= 30) return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-bold">{job.type}</CardTitle>
        <Badge className={getStatusColor(job.status)}>{job.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{job.progress}%</span>
          </div>
          <Progress value={job.progress} className={getProgressColor(job.progress)} />
        </div>

        {/* Processing Details */}
        <div className="space-y-2 text-sm">
          {job.config.lastProcessedBlock && (
            <div className="flex justify-between">
              <span>Last Block</span>
              <span>{job.config.lastProcessedBlock.toLocaleString()}</span>
            </div>
          )}
          {job.config.lastProcessedTimestamp && (
            <div className="flex justify-between">
              <span>Last Update</span>
              <span>
                {formatDistanceToNow(new Date(job.config.lastProcessedTimestamp), { addSuffix: true })}
              </span>
            </div>
          )}
          {job.lastRunAt && (
            <div className="flex justify-between">
              <span>Last Run</span>
              <span>{formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}</span>
            </div>
          )}
        </div>

        {/* Checkpoints */}
        {job.config.checkpoints && job.config.checkpoints.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold">Recent Checkpoints</h4>
            <div className="space-y-1">
              {job.config.checkpoints.slice(-3).map((checkpoint, index) => (
                <div key={index} className="text-sm flex justify-between">
                  <span>Block {checkpoint.block.toLocaleString()}</span>
                  <span>{formatDistanceToNow(new Date(checkpoint.timestamp), { addSuffix: true })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {job.error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{job.error}</AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2 pt-2">
          {job.status === 'FAILED' && onRetry && (
            <button
              onClick={() => onRetry(job.id)}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Retry
            </button>
          )}
          {job.status === 'RUNNING' && onStop && (
            <button
              onClick={() => onStop(job.id)}
              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Stop
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
} 