'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { GraphData } from '../types'

export const graphKey = ['graph'] as const

export function useGraph(enabled = true) {
  return useQuery({ queryKey: graphKey, queryFn: () => api<GraphData>('/api/graph'), enabled })
}
