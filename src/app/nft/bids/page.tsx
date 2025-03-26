'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { toast } from 'sonner';

interface BidData {
  mintAddress: string;
  bids: Array<{
    marketplace: string;
    currency: string;
    totalBids: number;
    minBid: number;
    maxBid: number;
    avgBid: number;
    bids: Array<{
      bidder: string;
      amount: number;
      timestamp: Date;
    }>;
  }>;
  totalMarketplaces: number;
  totalBids: number;
}

export default function NFTBidsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mintAddress, setMintAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bidData, setBidData] = useState<BidData | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mintAddress.trim()) {
      toast.error('Please enter a valid NFT mint address');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/nft/bids?mintAddress=${encodeURIComponent(mintAddress)}`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch NFT bids');
      }

      const data = await response.json();
      setBidData(data);
      
      if (data.bids.length === 0) {
        toast.info('No active bids found for this NFT');
      } else {
        toast.success(`Found ${data.totalBids} active bids across ${data.totalMarketplaces} marketplaces`);
      }
    } catch (error) {
      console.error('Error fetching NFT bids:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch NFT bids');
      setBidData(null);
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
      <h1 className="text-2xl font-bold mb-6">NFT Bids Explorer</h1>
      
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-grow">
            <label htmlFor="mintAddress" className="block text-sm font-medium mb-1">
              NFT Mint Address
            </label>
            <input
              id="mintAddress"
              type="text"
              value={mintAddress}
              onChange={(e) => setMintAddress(e.target.value)}
              placeholder="Enter NFT mint address"
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              disabled={isLoading}
            />
          </div>
          <div className="self-end">
            <button
              type="submit"
              disabled={isLoading}
              className={`px-4 py-2 bg-blue-600 text-white rounded-md ${
                isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'
              }`}
            >
              {isLoading ? 'Loading...' : 'Get Bids'}
            </button>
          </div>
        </div>
      </form>

      {isLoading && (
        <div className="my-8 text-center">
          <LoadingSpinner size="md" />
          <p className="mt-2 text-gray-600">Fetching bids data...</p>
        </div>
      )}

      {bidData && bidData.bids.length > 0 ? (
        <div className="space-y-8">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-2">NFT: {bidData.mintAddress}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 p-3 rounded">
                <span className="text-gray-700">Total Marketplaces:</span> <span className="font-semibold">{bidData.totalMarketplaces}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <span className="text-gray-700">Total Bids:</span> <span className="font-semibold">{bidData.totalBids}</span>
              </div>
            </div>
          </div>

          {bidData.bids.map((marketplaceBids, index) => (
            <div key={index} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-blue-600 text-white p-4">
                <h3 className="text-lg font-semibold">{marketplaceBids.marketplace}</h3>
                <div className="flex flex-wrap gap-4 mt-2 text-sm">
                  <div>
                    <span className="opacity-80">Bids:</span> {marketplaceBids.totalBids}
                  </div>
                  <div>
                    <span className="opacity-80">Min Bid:</span> {marketplaceBids.minBid} {marketplaceBids.currency}
                  </div>
                  <div>
                    <span className="opacity-80">Max Bid:</span> {marketplaceBids.maxBid} {marketplaceBids.currency}
                  </div>
                  <div>
                    <span className="opacity-80">Avg Bid:</span> {marketplaceBids.avgBid.toFixed(2)} {marketplaceBids.currency}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bidder</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {marketplaceBids.bids.map((bid, bidIndex) => (
                      <tr key={bidIndex} className={bidIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {bid.bidder.slice(0, 6)}...{bid.bidder.slice(-4)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {bid.amount} {marketplaceBids.currency}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(bid.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : bidData ? (
        <div className="bg-yellow-50 border border-yellow-100 rounded-md p-4 text-yellow-800">
          No active bids found for this NFT.
        </div>
      ) : null}
    </div>
  );
} 