'use client'

import { useEffect, useState } from 'react'

export function useConnectionParams() {
  const [params, setParams] = useState<{ gateway: string | null; token: string | null }>({
    gateway: null,
    token: null,
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    const gateway = url.searchParams.get('gateway')
    const token = url.searchParams.get('token') ?? (url.hash.replace('#token=', '') || null)

    setParams({ gateway, token })
  }, [])

  return params
}
