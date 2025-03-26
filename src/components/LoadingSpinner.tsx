import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

export function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };
  
  const spinnerSize = sizeClasses[size];
  
  return (
    <div className={`flex justify-center items-center ${size === 'md' ? 'min-h-[200px]' : ''}`}>
      <div className={`animate-spin rounded-full ${spinnerSize} border-b-2 border-primary`}></div>
    </div>
  );
} 