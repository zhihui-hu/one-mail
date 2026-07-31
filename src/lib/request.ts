export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

export async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new RequestError(response.statusText || 'Request failed', response.status)
  }
  return response.json() as Promise<T>
}
