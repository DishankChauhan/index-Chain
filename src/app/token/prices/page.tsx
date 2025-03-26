'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { toast } from 'sonner';

interface TokenPrice {
  platform: string;
  tokenSymbol: string;
  tokenName: string;
  mintAddress: string;
  price: number;
  currency: string;
  lastUpdated: Date;
}

interface PriceStats {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  totalPlatforms: number;
}

interface TokenPriceResponse {
  token: {
    symbol: string;
    name: string | null;
    mintAddress: string | null;
  };
  prices: TokenPrice[];
  stats: PriceStats | null;
}

export default function TokenPricesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [mintAddress, setMintAddress] = useState('');
  const [priceData, setPriceData] = useState<TokenPriceResponse | null>(null);
  const [searchType, setSearchType] = useState<'symbol' | 'address'>('symbol');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (searchType === 'symbol' && !tokenSymbol.trim()) {
      toast.error('Please enter a valid token symbol');
      return;
    }
    
    if (searchType === 'address' && !mintAddress.trim()) {
      toast.error('Please enter a valid token mint address');
      return;
    }

    setIsLoading(true);
    try {
      let url = '/api/token/prices?';
      
      if (searchType === 'symbol') {
        url += `symbol=${encodeURIComponent(tokenSymbol.trim())}`;
      } else {
        url += `mintAddress=${encodeURIComponent(mintAddress.trim())}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch token prices');
      }

      const data = await response.json();
      setPriceData(data);
      
      if (data.prices.length === 0) {
        toast.info('No prices found for this token');
      } else {
        toast.success(`Found ${data.prices.length} prices from ${data.stats.totalPlatforms} platforms`);
      }
    } catch (error) {
      console.error('Error fetching token prices:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch token prices');
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

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Token Price Explorer</h1>
      
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="mb-4">
            <div className="flex space-x-4">
              <div className="flex items-center">
                <input
                  id="searchBySymbol"
                  type="radio"
                  name="searchType"
                  checked={searchType === 'symbol'}
                  onChange={() => setSearchType('symbol')}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="searchBySymbol" className="ml-2 block text-sm font-medium text-gray-700">
                  Search by Symbol
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="searchByAddress"
                  type="radio"
                  name="searchType"
                  checked={searchType === 'address'}
                  onChange={() => setSearchType('address')}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="searchByAddress" className="ml-2 block text-sm font-medium text-gray-700">
                  Search by Mint Address
                </label>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4">
            {searchType === 'symbol' ? (
              <div className="flex-grow">
                <label htmlFor="tokenSymbol" className="block text-sm font-medium mb-1">
                  Token Symbol
                </label>
                <input
                  id="tokenSymbol"
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                  placeholder="Enter token symbol (e.g. SOL, USDC)"
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  disabled={isLoading}
                />
              </div>
            ) : (
              <div className="flex-grow">
                <label htmlFor="mintAddress" className="block text-sm font-medium mb-1">
                  Token Mint Address
                </label>
                <input
                  id="mintAddress"
                  type="text"
                  value={mintAddress}
                  onChange={(e) => setMintAddress(e.target.value)}
                  placeholder="Enter token mint address"
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  disabled={isLoading}
                />
              </div>
            )}
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
        </div>
      </form>

      {isLoading && (
        <div className="my-8 text-center">
          <LoadingSpinner size="md" />
          <p className="mt-2 text-gray-600">Fetching token prices...</p>
        </div>
      )}

      {priceData && (
        <div className="space-y-8">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-2">
              {priceData.token.symbol}
              {priceData.token.name && ` (${priceData.token.name})`}
            </h2>
            
            {priceData.token.mintAddress && (
              <div className="text-sm text-gray-500 mb-4">
                Mint Address: {priceData.token.mintAddress}
              </div>
            )}
            
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
                  <div className="text-sm text-gray-500">Total Platforms</div>
                  <div className="font-semibold text-lg">{priceData.stats.totalPlatforms}</div>
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
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Currency</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {priceData.prices.map((price, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {price.platform}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatCurrency(price.price)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {price.currency}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(price.lastUpdated).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-100 rounded-md p-4 text-yellow-800">
              No prices found for this token.
            </div>
          )}
        </div>
      )}
    </div>
  );
} 