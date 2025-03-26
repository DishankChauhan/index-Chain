'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { toast } from 'sonner';

interface PriceData {
  marketplace: string;
  price: number;
  currency: string;
  lastUpdated: Date;
  isListed: boolean;
}

interface PriceStats {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  totalListings: number;
}

interface NFTPriceResponse {
  mintAddress: string;
  prices: PriceData[];
  stats: PriceStats | null;
  totalMarketplaces: number;
}

export default function NFTPricesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mintAddress, setMintAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [priceData, setPriceData] = useState<NFTPriceResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mintAddress.trim()) {
      toast.error('Please enter a valid NFT mint address');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/nft/prices?mintAddress=${encodeURIComponent(mintAddress)}`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch NFT prices');
      }

      const data = await response.json();
      setPriceData(data);
      
      if (data.prices.length === 0) {
        toast.info('No listings found for this NFT');
      } else {
        toast.success(`Found ${data.prices.length} listings across ${data.totalMarketplaces} marketplaces`);
      }
    } catch (error) {
      console.error('Error fetching NFT prices:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch NFT prices');
      setPriceData(null);
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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">NFT Price Explorer</h1>
      
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
              {isLoading ? 'Loading...' : 'Get Prices'}
            </button>
          </div>
        </div>
      </form>

      {isLoading && (
        <div className="my-8 text-center">
          <LoadingSpinner size="md" />
          <p className="mt-2 text-gray-600">Fetching price data...</p>
        </div>
      )}

      {priceData && (
        <div className="space-y-8">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-2">NFT: {priceData.mintAddress}</h2>
            
            {priceData.stats ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Min Price</div>
                  <div className="font-semibold text-lg">{formatCurrency(priceData.stats.minPrice)}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Max Price</div>
                  <div className="font-semibold text-lg">{formatCurrency(priceData.stats.maxPrice)}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Avg Price</div>
                  <div className="font-semibold text-lg">{formatCurrency(priceData.stats.avgPrice)}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Total Listings</div>
                  <div className="font-semibold text-lg">{priceData.stats.totalListings}</div>
                </div>
              </div>
            ) : null}
          </div>

          {priceData.prices.length > 0 ? (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Marketplace</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Currency</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {priceData.prices.map((listing, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {listing.marketplace}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatCurrency(listing.price)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {listing.currency}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(listing.lastUpdated).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-100 rounded-md p-4 text-yellow-800">
              No active listings found for this NFT.
            </div>
          )}
        </div>
      )}
    </div>
  );
} 