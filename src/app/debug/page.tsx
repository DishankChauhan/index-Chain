'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { toast } from 'react-hot-toast';

export default function DebugPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState('nft_bids');
  const [limit, setLimit] = useState(10);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [jobLoading, setJobLoading] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/debug/data?table=${selectedTable}&limit=${limit}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch data');
      }
      
      const result = await response.json();
      setData(result);
      toast.success(`Loaded ${result.recordsReturned} records`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchJobStatus = async () => {
    if (!jobId) {
      toast.error('Please enter a job ID');
      return;
    }
    
    try {
      setJobLoading(true);
      setError(null);
      
      const response = await fetch(`/api/jobs/${jobId}/status`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch job status');
      }
      
      const result = await response.json();
      setJobStatus(result);
      toast.success('Job status loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      toast.error('Failed to load job status');
    } finally {
      setJobLoading(false);
    }
  };

  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Debug Tools</h1>
      
      <div className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Job Status Checker</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">
                  Job ID
                </label>
                <Input 
                  placeholder="Enter job ID" 
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                />
              </div>
              <Button 
                onClick={fetchJobStatus} 
                disabled={jobLoading || !jobId}
              >
                {jobLoading ? 'Loading...' : 'Check Status'}
              </Button>
            </div>
            
            {jobStatus && (
              <div className="mt-4 bg-slate-800 p-4 rounded-md overflow-auto max-h-96">
                <pre className="text-green-400 text-sm">
                  {JSON.stringify(jobStatus, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Database Explorer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Table
              </label>
              <Select
                value={selectedTable}
                onValueChange={setSelectedTable}
              >
                <SelectTrigger>
                  <SelectValue>Select a table</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nft_bids">NFT Bids</SelectItem>
                  <SelectItem value="nft_prices">NFT Prices</SelectItem>
                  <SelectItem value="token_prices">Token Prices</SelectItem>
                  <SelectItem value="lending_rates">Lending Rates</SelectItem>
                  <SelectItem value="processed_data">Processed Data</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Limit
              </label>
              <Input 
                type="number" 
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                className="w-24"
              />
            </div>
            
            <Button 
              onClick={fetchData} 
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Fetch Data'}
            </Button>
          </div>
          
          {error && (
            <div className="bg-red-100 text-red-700 p-3 rounded-md mb-4">
              {error}
            </div>
          )}
          
          {data && (
            <div>
              <div className="mb-4">
                <p><strong>Table:</strong> {data.table}</p>
                <p><strong>Total Records:</strong> {data.totalRecords}</p>
                <p><strong>Records Shown:</strong> {data.recordsReturned}</p>
              </div>
              
              <div className="bg-slate-800 p-4 rounded-md overflow-auto max-h-96">
                <pre className="text-green-400 text-sm">
                  {JSON.stringify(data.data, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 