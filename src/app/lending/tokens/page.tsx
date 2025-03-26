'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { toast } from 'sonner';

interface LendingToken {
  protocolName: string;
  poolName: string;
  tokenSymbol: string;
  tokenName: string;
  mintAddress: string;
  decimals: number;
  borrowRate: number;
  supplyRate: number;
  totalSupply: number;
  availableLiquidity: number;
  borrowedAmount: number;
  utilizationRate: number;
  collateralFactor: number;
  lastUpdated: Date;
}

interface TokensResponse {
  tokens: LendingToken[];
  stats: {
    totalProtocols: number;
    totalPools: number;
    totalTokens: number;
    avgBorrowRate: number;
    avgSupplyRate: number;
  };
  params: {
    protocol: string;
    sortBy: string;
    sortOrder: string;
  };
}

export default function LendingTokensPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [tokenData, setTokenData] = useState<TokensResponse | null>(null);
  const [protocol, setProtocol] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('borrow_rate');
  const [sortOrder, setSortOrder] = useState<string>('asc');

  const fetchTokens = async () => {
    setIsLoading(true);
    try {
      let url = '/api/lending/available-tokens?';
      
      if (protocol) {
        url += `protocol=${encodeURIComponent(protocol)}&`;
      }
      
      url += `sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch lending tokens');
      }

      const data = await response.json();
      setTokenData(data);
      
      if (data.tokens.length === 0) {
        toast.info('No lending tokens found with the current filters');
      } else {
        toast.success(`Found ${data.tokens.length} lending tokens from ${data.stats.totalProtocols} protocols`);
      }
    } catch (error) {
      console.error('Error fetching lending tokens:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch lending tokens');
      setTokenData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchTokens();
    }
  }, [status]);

  const handleFilterChange = () => {
    fetchTokens();
  };

  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  if (status === 'unauthenticated') {
    router.push('/auth/signin');
    return null;
  }

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
  };

  const formatCurrency = (value: number, decimals: number) => {
    const divisor = Math.pow(10, decimals);
    const formattedValue = value / divisor;
    
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(formattedValue);
  };

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Available Lending Tokens</h1>
      
      <div className="bg-white rounded-lg shadow p-4 mb-8">
        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-grow">
            <label htmlFor="protocol" className="block text-sm font-medium mb-1">
              Protocol Filter (optional)
            </label>
            <input
              id="protocol"
              type="text"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              placeholder="Enter protocol name"
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              disabled={isLoading}
            />
          </div>
          
          <div>
            <label htmlFor="sortBy" className="block text-sm font-medium mb-1">
              Sort By
            </label>
            <select
              id="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              disabled={isLoading}
            >
              <option value="borrow_rate">Borrow Rate</option>
              <option value="supply_rate">Supply Rate</option>
              <option value="available_liquidity">Available Liquidity</option>
              <option value="utilization_rate">Utilization Rate</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="sortOrder" className="block text-sm font-medium mb-1">
              Order
            </label>
            <select
              id="sortOrder"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              disabled={isLoading}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          
          <button
            onClick={handleFilterChange}
            disabled={isLoading}
            className={`px-4 py-2 bg-blue-600 text-white rounded-md ${
              isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'
            }`}
          >
            {isLoading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="my-8 text-center">
          <LoadingSpinner size="md" />
          <p className="mt-2 text-gray-600">Fetching lending tokens...</p>
        </div>
      ) : tokenData ? (
        <div className="space-y-8">
          {tokenData.stats && (
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Total Protocols</div>
                  <div className="font-semibold text-lg">{tokenData.stats.totalProtocols}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Total Pools</div>
                  <div className="font-semibold text-lg">{tokenData.stats.totalPools}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Total Tokens</div>
                  <div className="font-semibold text-lg">{tokenData.stats.totalTokens}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Avg Borrow Rate</div>
                  <div className="font-semibold text-lg">{formatPercent(tokenData.stats.avgBorrowRate)}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-500">Avg Supply Rate</div>
                  <div className="font-semibold text-lg">{formatPercent(tokenData.stats.avgSupplyRate)}</div>
                </div>
              </div>
            </div>
          )}

          {tokenData.tokens.length > 0 ? (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protocol</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pool</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mint Address</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Borrow Rate</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supply Rate</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Available Liquidity</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {tokenData.tokens.map((token, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {token.protocolName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {token.poolName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {token.tokenSymbol} <span className="text-xs text-gray-400">({token.tokenName})</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {shortenAddress(token.mintAddress)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatPercent(token.borrowRate)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatPercent(token.supplyRate)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatCurrency(token.availableLiquidity, token.decimals)} {token.tokenSymbol}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatPercent(token.utilizationRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-100 rounded-md p-4 text-yellow-800">
              No lending tokens found with the current filters.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-red-50 border border-red-100 rounded-md p-4 text-red-800">
          Failed to load lending tokens. Please try again later.
        </div>
      )}
    </div>
  );
} 