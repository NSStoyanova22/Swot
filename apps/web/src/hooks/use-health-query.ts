import { useQuery } from '@tanstack/react-query'

import { getHealth } from '@/api/health'

export const healthQueryKey = ['health'] as const

export function useHealthQuery(enabled = true) {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled,
  })
}
